// ============================================================
// 目录列表工具 — 列出目录内容，支持截断和条目数限制
// 基于 Pi ls.ts 移植，删除所有 TUI 渲染代码
// ============================================================

import type { AgentTool } from '@scout-agent/agent';
import { readdir as fsReaddir, stat as fsStat } from 'node:fs/promises';
import nodePath from 'node:path';
import { type Static, Type } from '@sinclair/typebox';
import { pathExists, resolveToCwd } from './shared/path-utils.ts';
import {
  DEFAULT_MAX_BYTES,
  formatSize,
  type TruncationResult,
  truncateHead,
} from './shared/truncate.ts';

// ---------- Schema ----------

const lsSchema = Type.Object({
  path: Type.Optional(
    Type.String({ description: 'Directory to list (default: current directory)' }),
  ),
  limit: Type.Optional(
    Type.Number({ description: 'Maximum number of entries to return (default: 500)' }),
  ),
});

export type LsToolInput = Static<typeof lsSchema>;

const DEFAULT_LIMIT = 500;

// ---------- Details ----------

export interface LsToolDetails {
  truncation?: TruncationResult;
  entryLimitReached?: number;
}

// ---------- Operations ----------

/**
 * 可插拔的目录列表操作接口。
 * 覆盖这些方法可将目录列表委托给远程系统（例如 SSH）。
 */
export interface LsOperations {
  /** 检查路径是否存在 */
  exists: (absolutePath: string) => Promise<boolean> | boolean;
  /** 获取文件/目录状态，不存在时抛出异常 */
  stat: (
    absolutePath: string,
  ) => Promise<{ isDirectory: () => boolean }> | { isDirectory: () => boolean };
  /** 读取目录条目 */
  readdir: (absolutePath: string) => Promise<string[]> | string[];
}

const defaultLsOperations: LsOperations = {
  exists: pathExists,
  stat: fsStat,
  readdir: fsReaddir,
};

// ---------- Options ----------

export interface LsToolOptions {
  /** 自定义目录列表操作，默认使用本地文件系统 */
  operations?: LsOperations;
}

// ---------- 工厂函数 ----------

export function createLsTool(
  cwd: string,
  options?: LsToolOptions,
): AgentTool<typeof lsSchema, LsToolDetails | undefined> {
  const ops = options?.operations ?? defaultLsOperations;

  return {
    name: 'ls',
    label: 'ls',
    description: `List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to ${DEFAULT_LIMIT} entries or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    promptSnippet: 'List directory contents',
    parameters: lsSchema,

    async execute(
      _toolCallId: string,
      { path, limit }: { path?: string; limit?: number },
      signal?: AbortSignal,
      _onUpdate?: (update: any) => void, // eslint-disable-line @typescript-eslint/no-explicit-any,
    ) {
      return new Promise<{
        content: Array<{ type: 'text'; text: string }>;
        details: LsToolDetails | undefined;
      }>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error('Operation aborted'));
          return;
        }

        const onAbort = () => reject(new Error('Operation aborted'));
        signal?.addEventListener('abort', onAbort, { once: true });

        // 异步执行主体
        (async () => {
          try {
            const dirPath = resolveToCwd(path || '.', cwd);
            const effectiveLimit = limit ?? DEFAULT_LIMIT;

            // 检查路径是否存在
            if (!(await ops.exists(dirPath))) {
              reject(new Error(`Path not found: ${dirPath}`));
              return;
            }

            // 检查路径是否为目录
            const stat = await ops.stat(dirPath);
            if (!stat.isDirectory()) {
              reject(new Error(`Not a directory: ${dirPath}`));
              return;
            }

            // 读取目录条目
            let entries: string[];
            try {
              entries = await ops.readdir(dirPath);
            } catch (e: unknown) {
              reject(
                new Error(`Cannot read directory: ${e instanceof Error ? e.message : String(e)}`),
              );
              return;
            }

            // 按字母顺序排序（不区分大小写）
            entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

            // 格式化条目，目录添加 '/' 后缀
            const results: string[] = [];
            let entryLimitReached = false;

            for (const entry of entries) {
              if (results.length >= effectiveLimit) {
                entryLimitReached = true;
                break;
              }

              const fullPath = nodePath.join(dirPath, entry);
              let suffix = '';
              try {
                const entryStat = await ops.stat(fullPath);
                if (entryStat.isDirectory()) suffix = '/';
              } catch {
                // 无法 stat 的条目跳过
                continue;
              }
              results.push(entry + suffix);
            }

            signal?.removeEventListener('abort', onAbort);

            if (results.length === 0) {
              resolve({
                content: [{ type: 'text', text: '(empty directory)' }],
                details: undefined,
              });
              return;
            }

            const rawOutput = results.join('\n');
            // 应用字节截断。由于条目数已有上限，此处不需要单独的行数限制
            const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
            let output = truncation.content;
            const details: LsToolDetails = {};

            // 构建截断和条目限制提示
            const notices: string[] = [];
            if (entryLimitReached) {
              notices.push(
                `${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more`,
              );
              details.entryLimitReached = effectiveLimit;
            }
            if (truncation.truncated) {
              notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
              details.truncation = truncation;
            }
            if (notices.length > 0) {
              output += `\n\n[${notices.join('. ')}]`;
            }

            resolve({
              content: [{ type: 'text', text: output }],
              details: Object.keys(details).length > 0 ? details : undefined,
            });
          } catch (e: unknown) {
            signal?.removeEventListener('abort', onAbort);
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        })();
      });
    },
  };
}
