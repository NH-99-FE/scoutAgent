// ============================================================
// Edit 工具 — 精确文本替换，支持多编辑和模糊匹配
// 基于 Pi edit.ts 移植，去掉所有 TUI 渲染代码
// ============================================================

import type { AgentTool } from '@scout-agent/agent';
import { constants } from 'node:fs';
import {
  access as fsAccess,
  readFile as fsReadFile,
  writeFile as fsWriteFile,
} from 'node:fs/promises';
import { type Static, Type } from '@sinclair/typebox';
import {
  applyEditsToNormalizedContent,
  detectLineEnding,
  type Edit,
  generateDiffString,
  generateUnifiedPatch,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from './shared/edit-diff.ts';
import { withFileMutationQueue } from './shared/file-mutation-queue.ts';
import { resolveToCwd } from './shared/path-utils.ts';

// ---------- Schema ----------

const replaceEditSchema = Type.Object(
  {
    oldText: Type.String({
      description:
        'Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.',
    }),
    newText: Type.String({ description: 'Replacement text for this targeted edit.' }),
  },
  { additionalProperties: false },
);

const editSchema = Type.Object(
  {
    path: Type.String({ description: 'Path to the file to edit (relative or absolute)' }),
    edits: Type.Array(replaceEditSchema, {
      description:
        'One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.',
    }),
  },
  { additionalProperties: false },
);

// ---------- Types ----------

export type EditToolInput = Static<typeof editSchema>;

/** 兼容旧版 top-level oldText/newText 的输入类型 */
type LegacyEditToolInput = EditToolInput & {
  oldText?: unknown;
  newText?: unknown;
};

export interface EditToolDetails {
  /** 显示用 diff */
  diff: string;
  /** 标准统一补丁 */
  patch: string;
  /** 新文件中第一个变更行号（用于编辑器导航） */
  firstChangedLine?: number;
}

// ---------- 可插拔操作接口 ----------

/**
 * Edit 工具的可插拔操作。
 * 覆盖以委托文件编辑到远程系统（例如 SSH）。
 */
export interface EditOperations {
  /** 以 Buffer 读取文件内容 */
  readFile: (absolutePath: string) => Promise<Buffer>;
  /** 写入文件内容 */
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  /** 检查文件可读写（不可则抛异常） */
  access: (absolutePath: string) => Promise<void>;
}

const defaultEditOperations: EditOperations = {
  readFile: (path) => fsReadFile(path),
  writeFile: (path, content) => fsWriteFile(path, content, 'utf-8'),
  access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
};

export interface EditToolOptions {
  /** 自定义文件操作。默认：本地文件系统 */
  operations?: EditOperations;
}

// ---------- 参数预处理 ----------

/**
 * 处理旧版 top-level oldText/newText 参数和 JSON 字符串形式的 edits。
 * 某些模型（Opus 4.6, GLM-5.1）会把 edits 发为 JSON 字符串而非数组。
 */
function prepareEditArguments(input: unknown): EditToolInput {
  if (!input || typeof input !== 'object') {
    return input as EditToolInput;
  }

  const args = input as Record<string, unknown>;

  // 某些模型把 edits 发为 JSON 字符串
  if (typeof args.edits === 'string') {
    try {
      const parsed = JSON.parse(args.edits);
      if (Array.isArray(parsed)) args.edits = parsed;
    } catch {
      // 解析失败则保留原值，后续 validateEditInput 会报错
    }
  }

  const legacy = args as LegacyEditToolInput;
  if (typeof legacy.oldText !== 'string' || typeof legacy.newText !== 'string') {
    return args as EditToolInput;
  }

  // 将 top-level oldText/newText 合并到 edits 数组
  const edits = Array.isArray(legacy.edits) ? [...legacy.edits] : [];
  edits.push({ oldText: legacy.oldText, newText: legacy.newText });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { oldText: _, newText: _n, ...rest } = legacy;
  return { ...rest, edits } as EditToolInput;
}

function validateEditInput(input: EditToolInput): { path: string; edits: Edit[] } {
  if (!Array.isArray(input.edits) || input.edits.length === 0) {
    throw new Error('Edit tool input is invalid. edits must contain at least one replacement.');
  }
  return { path: input.path, edits: input.edits };
}

// ---------- 创建工具 ----------

export function createEditTool(
  cwd: string,
  options?: EditToolOptions,
): AgentTool<typeof editSchema, EditToolDetails> {
  const ops = options?.operations ?? defaultEditOperations;

  return {
    name: 'edit',
    label: 'edit',
    description:
      'Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.',
    promptSnippet: 'Edit files with exact text replacement',
    promptGuidelines: [
      'Use edit for targeted replacements. Use write for new files or complete rewrites.',
    ],
    parameters: editSchema,
    prepareArguments: prepareEditArguments,
    async execute(_toolCallId, input: EditToolInput, signal?: AbortSignal, _onUpdate?) {
      const { path, edits } = validateEditInput(input);
      const absolutePath = resolveToCwd(path, cwd);

      return withFileMutationQueue(absolutePath, async () => {
        // 不要在 abort 事件监听器中 reject：那会在飞行中的文件系统操作
        // 可能仍在完成时释放突变队列。在每次 await 后检查 signal.aborted
        // 可以观察到相同的中止，同时保持队列锁定直到当前操作结算。
        const throwIfAborted = (): void => {
          if (signal?.aborted) throw new Error('Operation aborted');
        };

        throwIfAborted();

        // 检查文件是否存在
        try {
          await ops.access(absolutePath);
        } catch (error: unknown) {
          throwIfAborted();
          const errorMessage =
            error instanceof Error && 'code' in error
              ? `Error code: ${(error as NodeJS.ErrnoException).code}`
              : String(error);
          throw new Error(`Could not edit file: ${path}. ${errorMessage}.`, { cause: error });
        }
        throwIfAborted();

        // 读取文件
        const buffer = await ops.readFile(absolutePath);
        const rawContent = buffer.toString('utf-8');
        throwIfAborted();

        // 匹配前去除 BOM — 模型不会在 oldText 中包含不可见的 BOM
        const { bom, text: content } = stripBom(rawContent);
        const originalEnding = detectLineEnding(content);
        const normalizedContent = normalizeToLF(content);
        const { baseContent, newContent } = applyEditsToNormalizedContent(
          normalizedContent,
          edits,
          path,
        );
        throwIfAborted();

        const finalContent = bom + restoreLineEndings(newContent, originalEnding);
        await ops.writeFile(absolutePath, finalContent);
        throwIfAborted();

        const diffResult = generateDiffString(baseContent, newContent);
        const patch = generateUnifiedPatch(path, baseContent, newContent);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Successfully replaced ${edits.length} block(s) in ${path}.`,
            },
          ],
          details: { diff: diffResult.diff, patch, firstChangedLine: diffResult.firstChangedLine },
        };
      });
    },
  };
}
