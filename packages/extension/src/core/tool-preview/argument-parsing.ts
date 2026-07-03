// ============================================================
// Tool preview argument parsing — 工具预览参数解析
// 负责：把内置 edit/write 的流式参数规范化为 core preview 输入。
// ============================================================

import type { Edit, ParsedEditInput, ParsedWriteInput } from './types.ts';

// ---------- Public parsing ----------

export function parseEditToolCallArguments(
  args: Record<string, unknown>,
): ParsedEditInput | undefined {
  const path = typeof args.path === 'string' ? args.path.trim() : '';
  if (!path) return undefined;

  const edits = parseEditArray(args.edits);
  if (typeof args.oldText === 'string' && typeof args.newText === 'string') {
    edits.push({ oldText: args.oldText, newText: args.newText });
  }

  return edits.length > 0 ? { path, edits } : undefined;
}

export function parseWriteToolCallArguments(
  args: Record<string, unknown>,
): ParsedWriteInput | undefined {
  const path = typeof args.path === 'string' ? args.path.trim() : '';
  if (!path || typeof args.content !== 'string') return undefined;
  return { path, content: args.content };
}

// ---------- Internal helpers ----------

function parseEditArray(value: unknown): Edit[] {
  const parsedValue = typeof value === 'string' ? parseJsonArray(value) : value;
  if (!Array.isArray(parsedValue)) return [];

  const edits: Edit[] = [];
  for (const item of parsedValue) {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    if (typeof record.oldText !== 'string' || typeof record.newText !== 'string') return [];
    edits.push({ oldText: record.oldText, newText: record.newText });
  }
  return edits;
}

function parseJsonArray(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
