// ============================================================
// Conversation Virtualization — 会话顶层 row 虚拟化参数
// ============================================================

import type { ConversationRow } from './conversation-view-model';

export const CONVERSATION_VIRTUALIZATION_ROW_THRESHOLD = 160;
export const CONVERSATION_VIRTUALIZATION_OVERSCAN = 8;

interface ConversationVirtualScrollKeyOptions {
  isStreaming: boolean;
  rows: ConversationRow[];
  totalSize: number;
}

export function shouldVirtualizeConversationRows(rowCount: number): boolean {
  return rowCount >= CONVERSATION_VIRTUALIZATION_ROW_THRESHOLD;
}

export function estimateConversationRowSize(row: ConversationRow | undefined): number {
  if (!row) return 120;
  if (row.type === 'user') return 64;
  if (row.type === 'assistant_outcome') {
    if (row.kind === 'error') return 120;
    if (row.kind === 'compacted') return Math.min(360, 96 + Math.ceil(row.markdown.length / 80) * 24);
    return 72;
  }
  if (row.type === 'system') return 120;
  return row.isStreaming ? 260 : 180;
}

export function getConversationVirtualScrollKey({
  isStreaming,
  rows,
  totalSize,
}: ConversationVirtualScrollKeyOptions): string {
  const lastRowKey = rows.at(-1)?.key ?? '';
  return [rows.length, lastRowKey, isStreaming ? 'streaming' : 'idle', Math.round(totalSize)].join(
    ':',
  );
}
