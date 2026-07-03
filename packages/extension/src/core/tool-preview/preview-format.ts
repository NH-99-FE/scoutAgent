// ============================================================
// Tool preview format helpers — 工具预览格式化辅助
// 负责：路径展示、上下文 key、diff 统计与预览结果构造。
// ============================================================

import { formatPathRelativeToCwd, resolveToCwd } from '../tools/shared/path-utils.ts';
import type {
  EditDiffError,
  EditDiffResult,
  ParsedEditInput,
  ParsedWriteInput,
  ToolPreviewContext,
  ToolPreviewFileEdit,
  ToolPreviewToolIdentity,
  WriteContentStats,
} from './types.ts';

// ---------- Tool identity ----------

export function canPreviewBuiltinTool(context: ToolPreviewContext, toolName: string): boolean {
  const tool = getPreviewToolIdentity(context, toolName);
  return (
    context.sessionId.trim().length > 0 &&
    tool?.active === true &&
    tool.source === 'builtin' &&
    tool.path === `<builtin:${toolName}>`
  );
}

export function getPreviewToolIdentity(
  context: ToolPreviewContext,
  toolName: string,
): ToolPreviewToolIdentity | undefined {
  return context.tools[toolName];
}

// ---------- Keys ----------

export function createToolPreviewContextKey(context: ToolPreviewContext, toolName: string): string {
  const tool = getPreviewToolIdentity(context, toolName);
  return [
    String(context.generation),
    context.sessionId,
    context.sessionFile ?? '',
    context.cwd,
    toolName,
    tool?.active ? 'active' : 'inactive',
    tool?.source ?? '',
    tool?.path ?? '',
  ].join('\u0000');
}

export function createEditArgsKey(input: ParsedEditInput): string {
  return JSON.stringify(input);
}

export function createWriteArgsKey(input: ParsedWriteInput, stats: WriteContentStats): string {
  return ['write', input.path, String(stats.length), String(stats.lines), stats.hash].join(
    '\u0000',
  );
}

// ---------- Preview construction ----------

export function formatPreviewPath(path: string, cwd: string): string {
  if (!cwd) return path;
  return formatPathRelativeToCwd(resolveToCwd(path, cwd), cwd);
}

export function createFileEditPreview(
  path: string,
  displayPath: string,
  result: EditDiffResult | EditDiffError,
): ToolPreviewFileEdit {
  if ('error' in result) return createFileEditErrorPreview(path, displayPath, result.error);

  const stats = countDiffStats(result.diff);
  return {
    kind: 'file_edit',
    path,
    displayPath,
    diff: result.diff,
    additions: stats.additions,
    deletions: stats.deletions,
    firstChangedLine: result.firstChangedLine,
  };
}

export function createFileEditErrorPreview(
  path: string,
  displayPath: string,
  message: string,
): ToolPreviewFileEdit {
  return {
    kind: 'file_edit',
    path,
    displayPath,
    additions: 0,
    deletions: 0,
    error: message,
  };
}

export function collectWriteContentStats(content: string): WriteContentStats {
  if (content.length === 0) {
    return { hash: '0', length: 0, lines: 0 };
  }

  let lines = 1;
  let hash = 0x811c9dc5;
  let endedWithLineBreak = false;
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    hash ^= code;
    hash = Math.imul(hash, 0x01000193) >>> 0;

    if (code === 13) {
      lines += 1;
      endedWithLineBreak = true;
      if (content.charCodeAt(index + 1) === 10) {
        index += 1;
        hash ^= 10;
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      continue;
    }
    if (code === 10) {
      lines += 1;
      endedWithLineBreak = true;
      continue;
    }
    endedWithLineBreak = false;
  }

  if (endedWithLineBreak) lines -= 1;
  return { hash: hash.toString(36), length: content.length, lines };
}

// ---------- Diff stats ----------

function countDiffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }

  return { additions, deletions };
}
