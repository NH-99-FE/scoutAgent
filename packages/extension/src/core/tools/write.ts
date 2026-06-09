// ============================================================
// 写入工具 — 写入文件内容，自动创建父目录
// 基于 Pi write.ts 移植，删除所有 TUI 渲染代码
// ============================================================

import type { AgentTool } from '@scout-agent/agent';
import { mkdir as fsMkdir, writeFile as fsWriteFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type Static, Type } from '@sinclair/typebox';
import { withFileMutationQueue } from './shared/file-mutation-queue.ts';
import { resolveToCwd } from './shared/path-utils.ts';

// ---------- Schema ----------

const writeSchema = Type.Object({
  path: Type.String({ description: 'Path to the file to write (relative or absolute)' }),
  content: Type.String({ description: 'Content to write to the file' }),
});

export type WriteToolInput = Static<typeof writeSchema>;

// ---------- Operations ----------

/**
 * 可插拔的写入操作接口。
 * 覆盖这些方法可将文件写入委托给远程系统（例如 SSH）。
 */
export interface WriteOperations {
  /** 写入文件内容 */
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  /** 递归创建目录 */
  mkdir: (dir: string) => Promise<void>;
}

const defaultWriteOperations: WriteOperations = {
  writeFile: (path, content) => fsWriteFile(path, content, 'utf-8'),
  mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
};

// ---------- Options ----------

export interface WriteToolOptions {
  /** 自定义文件写入操作，默认使用本地文件系统 */
  operations?: WriteOperations;
}

// ---------- 工厂函数 ----------

export function createWriteTool(
  cwd: string,
  options?: WriteToolOptions,
): AgentTool<typeof writeSchema, undefined> {
  const ops = options?.operations ?? defaultWriteOperations;

  return {
    name: 'write',
    label: 'write',
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    promptSnippet: 'Create or overwrite files',
    promptGuidelines: ['Use write only for new files or complete rewrites.'],
    parameters: writeSchema,

    async execute(
      _toolCallId: string,
      { path, content }: { path: string; content: string },
      signal?: AbortSignal,
      _onUpdate?: (update: any) => void, // eslint-disable-line @typescript-eslint/no-explicit-any,
    ) {
      const absolutePath = resolveToCwd(path, cwd);
      const dir = dirname(absolutePath);

      return withFileMutationQueue(absolutePath, async () => {
        // 不在 abort 事件监听器中 reject：那会在文件系统操作仍在进行时释放突变队列。
        // 在每个 await 后检查 signal.aborted 可观察到相同的中止信号，
        // 同时保持队列锁定直到当前操作完成。
        const throwIfAborted = (): void => {
          if (signal?.aborted) throw new Error('Operation aborted');
        };

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
          details: undefined,
        };
      });
    },
  };
}
