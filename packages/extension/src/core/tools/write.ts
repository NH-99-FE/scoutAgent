// ============================================================
// 写入工具 — 写入文件内容，自动创建父目录
// 基于 Pi write.ts 移植，删除所有 TUI 渲染代码
// ============================================================

import type { AgentTool } from '@scout-agent/agent';
import {
  readFile as fsReadFile,
  mkdir as fsMkdir,
  stat as fsStat,
  writeFile as fsWriteFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { type Static, Type } from '@sinclair/typebox';
import type { ToolDefinition } from '../extensions/types.ts';
import {
  decodeReviewContent,
  FILE_REVIEW_PAYLOAD_KIND,
  type FileReviewPayload,
} from '../review/file-review.ts';
import { MAX_REVIEW_TEXT_BYTES } from '../text-size.ts';
import { wrapToolDefinition } from './tool-definition-wrapper.ts';
import { withFileMutationQueue } from './shared/file-mutation-queue.ts';
import { formatPathRelativeToCwd, resolveToCwd } from './shared/path-utils.ts';

// ---------- Schema ----------

const writeSchema = Type.Object({
  path: Type.String({ description: 'Path to the file to write (relative or absolute)' }),
  content: Type.String({ description: 'Content to write to the file' }),
});

export type WriteToolInput = Static<typeof writeSchema>;

export interface WriteToolDetails {
  /** 内部 review payload。AgentSession 会捕获并替换为轻量 file_change details。 */
  kind: typeof FILE_REVIEW_PAYLOAD_KIND;
  operation: 'write';
  path: string;
  absolutePath: string;
  displayPath?: string;
  originalContent: string | null;
  modifiedContent: string | null;
  unavailableReason?: FileReviewPayload['unavailableReason'];
}

// ---------- Operations ----------

/**
 * 可插拔的写入操作接口。
 * 覆盖这些方法可将文件写入委托给远程系统（例如 SSH）。
 */
export interface WriteOperations {
  /** 获取写入前文件大小；本地文件系统用于避免为 review 读取超大文件。 */
  stat?: (absolutePath: string) => Promise<{ size: number }>;
  /** 以 Buffer 读取写入前内容；ENOENT 表示新文件。 */
  readFile?: (absolutePath: string) => Promise<Buffer>;
  /** 写入文件内容 */
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  /** 递归创建目录 */
  mkdir: (dir: string) => Promise<void>;
}

const defaultWriteOperations: WriteOperations = {
  stat: (path) => fsStat(path),
  readFile: (path) => fsReadFile(path),
  writeFile: (path, content) => fsWriteFile(path, content, 'utf-8'),
  mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
};

// ---------- Options ----------

export interface WriteToolOptions {
  /** 自定义文件写入操作，默认使用本地文件系统 */
  operations?: WriteOperations;
}

// ---------- 工厂函数 ----------

export function createWriteToolDefinition(
  cwd: string,
  options?: WriteToolOptions,
): ToolDefinition<typeof writeSchema, WriteToolDetails> {
  const ops = options?.operations ?? defaultWriteOperations;

  return {
    name: 'write',
    label: 'write',
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    promptSnippet: 'Create or overwrite files',
    promptGuidelines: ['Use write only for new files or complete rewrites.'],
    presentation: { pathArguments: ['path'] },
    parameters: writeSchema,

    async execute(
      _toolCallId: string,
      { path, content }: { path: string; content: string },
      signal?: AbortSignal,
      _onUpdate?: (update: any) => void, // eslint-disable-line @typescript-eslint/no-explicit-any,
    ) {
      const absolutePath = resolveToCwd(path, cwd);
      const displayPath = formatPathRelativeToCwd(absolutePath, cwd);
      const dir = dirname(absolutePath);

      return withFileMutationQueue(absolutePath, async () => {
        // 不在 abort 事件监听器中 reject：那会在文件系统操作仍在进行时释放突变队列。
        // 在每个 await 后检查 signal.aborted 可观察到相同的中止信号，
        // 同时保持队列锁定直到当前操作完成。
        const throwIfAborted = (): void => {
          if (signal?.aborted) throw new Error('Operation aborted');
        };

        throwIfAborted();
        const original = await captureExistingContentForReview(ops, absolutePath);
        throwIfAborted();

        // 按需创建父目录
        await ops.mkdir(dir);
        throwIfAborted();

        // 写入文件内容
        await ops.writeFile(absolutePath, content);
        throwIfAborted();

        return {
          content: [
            { type: 'text', text: `Successfully wrote ${content.length} bytes to ${path}` },
          ],
          details: {
            kind: FILE_REVIEW_PAYLOAD_KIND,
            operation: 'write',
            path,
            absolutePath,
            displayPath,
            originalContent: original.content,
            modifiedContent: original.unavailableReason ? null : content,
            unavailableReason: original.unavailableReason,
          },
        };
      });
    },
  };
}

export function createWriteTool(
  cwd: string,
  options?: WriteToolOptions,
): AgentTool<typeof writeSchema, WriteToolDetails> {
  return wrapToolDefinition(createWriteToolDefinition(cwd, options));
}

async function captureExistingContentForReview(
  ops: WriteOperations,
  absolutePath: string,
): Promise<{ content: string | null; unavailableReason?: FileReviewPayload['unavailableReason'] }> {
  if (!ops.readFile) {
    return { content: null, unavailableReason: 'Original content unavailable' };
  }
  try {
    if (ops.stat) {
      const stats = await ops.stat(absolutePath);
      if (stats.size > MAX_REVIEW_TEXT_BYTES) {
        return { content: null, unavailableReason: 'Diff too large to review' };
      }
    }
    const buffer = await ops.readFile(absolutePath);
    return decodeReviewContent(buffer);
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { content: null };
    }
    // Review capture is observational; only mkdir/writeFile decide write success.
    return { content: null, unavailableReason: 'Original content unavailable' };
  }
}
