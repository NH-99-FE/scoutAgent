// ============================================================
// find 工具 — 基于 fd 的文件搜索
// 从 Pi find.ts 移植，删除 TUI 渲染代码
// ============================================================

import { createInterface } from 'node:readline';
import type { AgentTool, AgentToolResult } from '@scout-agent/agent';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { type Static, Type } from '@sinclair/typebox';
import type { ToolDefinition } from '../extensions/types.ts';
import { wrapToolDefinition } from './tool-definition-wrapper.ts';
import { pathExists, resolveToCwd } from './shared/path-utils.ts';
import { ensureTool } from './shared/tools-manager.ts';
import {
  DEFAULT_MAX_BYTES,
  formatSize,
  type TruncationResult,
  truncateHead,
} from './shared/truncate.ts';

// ---------- Schema ----------

const findSchema = Type.Object({
  pattern: Type.String({
    description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
  }),
  path: Type.Optional(
    Type.String({ description: 'Directory to search in (default: current directory)' }),
  ),
  limit: Type.Optional(Type.Number({ description: 'Maximum number of results (default: 1000)' })),
});

export type FindToolInput = Static<typeof findSchema>;

const DEFAULT_LIMIT = 1000;

// ---------- 类型 ----------

export interface FindToolDetails {
  truncation?: TruncationResult;
  resultLimitReached?: number;
}

/**
 * 可插拔的 find 操作。
 * 覆盖这些操作以将文件搜索委托给远程系统（如 SSH）。
 */
export interface FindOperations {
  /** 检查路径是否存在 */
  exists: (absolutePath: string) => Promise<boolean> | boolean;
  /** 查找匹配 glob 模式的文件。返回相对或绝对路径。 */
  glob: (
    pattern: string,
    cwd: string,
    options: { ignore: string[]; limit: number },
  ) => Promise<string[]> | string[];
}

const defaultFindOperations: FindOperations = {
  exists: pathExists,
  // 占位符。当未提供自定义 glob 时，实际 fd 执行在 execute() 中进行。
  glob: () => [],
};

export interface FindToolOptions {
  /** 自定义 find 操作。默认：本地文件系统 + fd */
  operations?: FindOperations;
}

// ---------- 辅助函数 ----------

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

// ---------- 工厂函数 ----------

export function createFindToolDefinition(
  cwd: string,
  options?: FindToolOptions,
): ToolDefinition<typeof findSchema, FindToolDetails> {
  const customOps = options?.operations;

  return {
    name: 'find',
    label: 'find',
    description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    promptSnippet: 'Find files by glob pattern (respects .gitignore)',
    parameters: findSchema,

    async execute(
      _toolCallId: string,
      { pattern, path: searchDir, limit }: FindToolInput,
      signal?: AbortSignal,
      _onUpdate?: (update: any) => void, // eslint-disable-line @typescript-eslint/no-explicit-any,
    ): Promise<AgentToolResult<FindToolDetails>> {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error('Operation aborted'));
          return;
        }

        let settled = false;
        let stopChild: (() => void) | undefined;
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          stopChild = undefined;
          fn();
        };
        const onAbort = () => {
          stopChild?.();
          settle(() => reject(new Error('Operation aborted')));
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        (async () => {
          try {
            const searchPath = resolveToCwd(searchDir || '.', cwd);
            const effectiveLimit = limit ?? DEFAULT_LIMIT;
            const ops = customOps ?? defaultFindOperations;

            // ---------- 自定义 glob 分支 ----------

            if (customOps?.glob) {
              (async () => {
                try {
                  if (!(await ops.exists(searchPath))) {
                    settle(() => reject(new Error(`Path not found: ${searchPath}`)));
                    return;
                  }
                  if (signal?.aborted) {
                    settle(() => reject(new Error('Operation aborted')));
                    return;
                  }
                  const results = await ops.glob(pattern, searchPath, {
                    ignore: ['**/node_modules/**', '**/.git/**'],
                    limit: effectiveLimit,
                  });
                  if (signal?.aborted) {
                    settle(() => reject(new Error('Operation aborted')));
                    return;
                  }
                  if (results.length === 0) {
                    settle(() =>
                      resolve({
                        content: [
                          { type: 'text' as const, text: 'No files found matching pattern' },
                        ],
                        details: {} as FindToolDetails,
                      }),
                    );
                    return;
                  }

                  // 将路径相对化到搜索根目录，保持输出稳定
                  const relativized = results.map((p) => {
                    if (p.startsWith(searchPath))
                      return toPosixPath(p.slice(searchPath.length + 1));
                    return toPosixPath(path.relative(searchPath, p));
                  });
                  const resultLimitReached = relativized.length >= effectiveLimit;
                  const rawOutput = relativized.join('\n');
                  const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
                  let resultOutput = truncation.content;
                  const details: FindToolDetails = {};
                  const notices: string[] = [];
                  if (resultLimitReached) {
                    notices.push(`${effectiveLimit} results limit reached`);
                    details.resultLimitReached = effectiveLimit;
                  }
                  if (truncation.truncated) {
                    notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
                    details.truncation = truncation;
                  }
                  if (notices.length > 0) {
                    resultOutput += `\n\n[${notices.join('. ')}]`;
                  }
                  settle(() =>
                    resolve({
                      content: [{ type: 'text' as const, text: resultOutput }],
                      details,
                    }),
                  );
                } catch (e) {
                  if (signal?.aborted) {
                    settle(() => reject(new Error('Operation aborted')));
                    return;
                  }
                  const error = e instanceof Error ? e : new Error(String(e));
                  settle(() => reject(error));
                }
              })();
              return;
            }

            // ---------- 默认 fd 分支 ----------

            const fdPath = await ensureTool('fd', true, { signal });
            if (signal?.aborted) {
              settle(() => reject(new Error('Operation aborted')));
              return;
            }
            if (!fdPath) {
              settle(() => reject(new Error('fd is not available and could not be downloaded')));
              return;
            }

            // 构建 fd 参数。--no-require-git 使 fd 在搜索路径不在 git 仓库内时
            // 也应用层级 .gitignore 语义，而不会像 --ignore-file（全局来源）那样
            // 泄漏兄弟目录规则。
            const args: string[] = [
              '--glob',
              '--color=never',
              '--hidden',
              '--no-require-git',
              '--max-results',
              String(effectiveLimit),
            ];

            // fd --glob 默认匹配 basename；在 --full-path 模式下匹配绝对候选路径，
            // 因此包含路径的 pattern 如 'src/**/*.spec.ts' 需要前导 '**/' 才能匹配
            let effectivePattern = pattern;
            if (pattern.includes('/')) {
              args.push('--full-path');
              if (!pattern.startsWith('/') && !pattern.startsWith('**/') && pattern !== '**') {
                effectivePattern = `**/${pattern}`;
              }
            }
            args.push('--', effectivePattern, searchPath);

            const child = spawn(fdPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            const rl = createInterface({ input: child.stdout });
            let stderr = '';
            const lines: string[] = [];

            stopChild = () => {
              if (!child.killed) {
                child.kill();
              }
            };

            const cleanup = () => {
              rl.close();
            };

            child.stderr?.on('data', (chunk: Buffer) => {
              stderr += chunk.toString();
            });

            rl.on('line', (line: string) => {
              lines.push(line);
            });

            child.on('error', (error: Error) => {
              cleanup();
              settle(() => reject(new Error(`Failed to run fd: ${error.message}`)));
            });

            child.on('close', (code: number | null) => {
              cleanup();
              if (signal?.aborted) {
                settle(() => reject(new Error('Operation aborted')));
                return;
              }
              const output = lines.join('\n');
              if (code !== 0) {
                const errorMsg = stderr.trim() || `fd exited with code ${code}`;
                if (!output) {
                  settle(() => reject(new Error(errorMsg)));
                  return;
                }
              }
              if (!output) {
                settle(() =>
                  resolve({
                    content: [{ type: 'text' as const, text: 'No files found matching pattern' }],
                    details: {} as FindToolDetails,
                  }),
                );
                return;
              }

              const relativized: string[] = [];
              for (const rawLine of lines) {
                const line = rawLine.replace(/\r$/, '').trim();
                if (!line) continue;
                const hadTrailingSlash = line.endsWith('/') || line.endsWith('\\');
                let relativePath: string;
                if (line.startsWith(searchPath)) {
                  relativePath = line.slice(searchPath.length + 1);
                } else {
                  relativePath = path.relative(searchPath, line);
                }
                if (hadTrailingSlash && !relativePath.endsWith('/')) relativePath += '/';
                relativized.push(toPosixPath(relativePath));
              }

              const resultLimitReached = relativized.length >= effectiveLimit;
              const rawOutput = relativized.join('\n');
              const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
              let resultOutput = truncation.content;
              const details: FindToolDetails = {};
              const notices: string[] = [];
              if (resultLimitReached) {
                notices.push(
                  `${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
                );
                details.resultLimitReached = effectiveLimit;
              }
              if (truncation.truncated) {
                notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
                details.truncation = truncation;
              }
              if (notices.length > 0) {
                resultOutput += `\n\n[${notices.join('. ')}]`;
              }
              settle(() =>
                resolve({
                  content: [{ type: 'text' as const, text: resultOutput }],
                  details,
                }),
              );
            });
          } catch (e) {
            if (signal?.aborted) {
              settle(() => reject(new Error('Operation aborted')));
              return;
            }
            const error = e instanceof Error ? e : new Error(String(e));
            settle(() => reject(error));
          }
        })();
      });
    },
  };
}

export function createFindTool(
  cwd: string,
  options?: FindToolOptions,
): AgentTool<typeof findSchema, FindToolDetails> {
  return wrapToolDefinition(createFindToolDefinition(cwd, options));
}
