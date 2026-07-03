// ============================================================
// 读取工具 — 读取文件内容，支持文本截断和图片检测
// 基于 Pi read.ts 移植，删除所有 TUI 渲染代码
// ============================================================

import type { AgentTool } from '@scout-agent/agent';
import { constants } from 'node:fs';
import { access as fsAccess, readFile as fsReadFile } from 'node:fs/promises';
import { type Static, Type } from '@sinclair/typebox';
import type { ToolDefinition } from '../extensions/types.ts';
import { wrapToolDefinition } from './tool-definition-wrapper.ts';
import { resolveReadPathAsync } from './shared/path-utils.ts';
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
  truncateHead,
} from './shared/truncate.ts';
import { detectSupportedImageMimeTypeFromFile } from './shared/mime.ts';

// ---------- Schema ----------

const readSchema = Type.Object({
  path: Type.String({ description: 'Path to the file to read (relative or absolute)' }),
  offset: Type.Optional(
    Type.Number({ description: 'Line number to start reading from (1-indexed)' }),
  ),
  limit: Type.Optional(Type.Number({ description: 'Maximum number of lines to read' })),
});

export type ReadToolInput = Static<typeof readSchema>;

// ---------- Details ----------

export interface ReadToolDetails {
  truncation?: TruncationResult;
}

// ---------- Operations ----------

/**
 * 可插拔的读取操作接口。
 * 覆盖这些方法可将文件读取委托给远程系统（例如 SSH）。
 */
export interface ReadOperations {
  /** 读取文件内容为 Buffer */
  readFile: (absolutePath: string) => Promise<Buffer>;
  /** 检查文件是否可读（不可读时抛出异常） */
  access: (absolutePath: string) => Promise<void>;
  /** 检测图片 MIME 类型，非图片返回 null 或 undefined */
  detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
}

const defaultReadOperations: ReadOperations = {
  readFile: (path) => fsReadFile(path),
  access: (path) => fsAccess(path, constants.R_OK),
  detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};

// ---------- Options ----------

export interface ReadToolOptions {
  /** 是否自动调整图片大小（Scout 简化：暂不支持，保留接口） */
  autoResizeImages?: boolean;
  /** 自定义读取操作，默认使用本地文件系统 */
  operations?: ReadOperations;
  /** 判断当前模型是否支持 vision。返回 false 时，图片内容替换为文本 note */
  isVisionModel?: () => boolean;
}

// ---------- 工厂函数 ----------

export function createReadToolDefinition(
  cwd: string,
  options?: ReadToolOptions,
): ToolDefinition<typeof readSchema, ReadToolDetails | undefined> {
  const ops = options?.operations ?? defaultReadOperations;
  const isVisionModel = options?.isVisionModel;

  return {
    name: 'read',
    label: 'read',
    description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
    promptSnippet: 'Read file contents',
    promptGuidelines: ['Use read to examine files instead of cat or sed.'],
    presentation: { pathArguments: ['path'] },
    parameters: readSchema,

    async execute(
      _toolCallId: string,
      { path, offset, limit }: { path: string; offset?: number; limit?: number },
      signal?: AbortSignal,
      _onUpdate?: (update: any) => void, // eslint-disable-line @typescript-eslint/no-explicit-any,
    ) {
      return new Promise<{
        content: Array<
          { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
        >;
        details: ReadToolDetails | undefined;
      }>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error('Operation aborted'));
          return;
        }

        let aborted = false;
        const onAbort = () => {
          aborted = true;
          reject(new Error('Operation aborted'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        // 异步执行主体，fire-and-forget IIFE 模式
        (async () => {
          try {
            const absolutePath = await resolveReadPathAsync(path, cwd);
            if (aborted) return;

            // 检查文件是否存在且可读
            await ops.access(absolutePath);
            if (aborted) return;

            // 检测是否为图片
            const mimeType = ops.detectImageMimeType
              ? await ops.detectImageMimeType(absolutePath)
              : undefined;

            let content: Array<
              { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
            >;
            let details: ReadToolDetails | undefined;

            if (mimeType) {
              // ---------- 图片处理 ----------
              if (isVisionModel?.() === false) {
                // 非 vision 模型：不发送图片，返回文本提示
                content = [
                  {
                    type: 'text',
                    text: `[Current model does not support images. The image at ${path} will be omitted from this request.]`,
                  },
                ];
              } else {
                // vision 模型：读取图片返回 base64
                const buffer = await ops.readFile(absolutePath);
                if (aborted) return;

                content = [
                  { type: 'text', text: `Read image file [${mimeType}]` },
                  { type: 'image', data: buffer.toString('base64'), mimeType },
                ];
              }
            } else {
              // ---------- 文本处理 ----------
              const buffer = await ops.readFile(absolutePath);
              if (aborted) return;

              const textContent = buffer.toString('utf-8');
              const allLines = textContent.split('\n');
              const totalFileLines = allLines.length;

              // 将 1-indexed offset 转为 0-indexed 数组下标
              const startLine = offset ? Math.max(0, offset - 1) : 0;
              const startLineDisplay = startLine + 1;

              // 检查 offset 是否越界
              if (startLine >= allLines.length) {
                throw new Error(
                  `Offset ${offset} is beyond end of file (${allLines.length} lines total)`,
                );
              }

              let selectedContent: string;
              let userLimitedLines: number | undefined;

              // 若用户指定了 limit，优先使用；否则由 truncateHead 决定
              if (limit !== undefined) {
                const endLine = Math.min(startLine + limit, allLines.length);
                selectedContent = allLines.slice(startLine, endLine).join('\n');
                userLimitedLines = endLine - startLine;
              } else {
                selectedContent = allLines.slice(startLine).join('\n');
              }

              // 应用截断，同时遵守行数和字节限制
              const truncation = truncateHead(selectedContent);
              let outputText: string;

              if (truncation.firstLineExceedsLimit) {
                // 首行即超过字节限制，提示使用 bash 回退
                const firstLineSize = formatSize(Buffer.byteLength(allLines[startLine], 'utf-8'));
                outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${path} | head -c ${DEFAULT_MAX_BYTES}]`;
                details = { truncation };
              } else if (truncation.truncated) {
                // 发生截断，构建可操作的续读提示
                const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
                const nextOffset = endLineDisplay + 1;
                outputText = truncation.content;
                if (truncation.truncatedBy === 'lines') {
                  outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`;
                } else {
                  outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
                }
                details = { truncation };
              } else if (
                userLimitedLines !== undefined &&
                startLine + userLimitedLines < allLines.length
              ) {
                // 用户 limit 提前截止，但文件仍有剩余内容
                const remaining = allLines.length - (startLine + userLimitedLines);
                const nextOffset = startLine + userLimitedLines + 1;
                outputText = `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
              } else {
                // 无截断且无剩余用户限定内容
                outputText = truncation.content;
              }

              content = [{ type: 'text', text: outputText }];
            }

            if (aborted) return;
            signal?.removeEventListener('abort', onAbort);
            resolve({ content, details });
          } catch (error: unknown) {
            signal?.removeEventListener('abort', onAbort);
            if (!aborted) reject(error instanceof Error ? error : new Error(String(error)));
          }
        })();
      });
    },
  };
}

export function createReadTool(
  cwd: string,
  options?: ReadToolOptions,
): AgentTool<typeof readSchema, ReadToolDetails | undefined> {
  return wrapToolDefinition(createReadToolDefinition(cwd, options));
}
