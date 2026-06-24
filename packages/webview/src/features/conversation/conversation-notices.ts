// ============================================================
// Conversation Notices — 会话元数据到 UI-only 行
// ============================================================

import type { ConversationItem } from '@/store/conversation-store';
import type { ConversationViewItem } from './conversation-row-types';

interface ApplyForkOriginNoticeOptions {
  forkPointEntryId?: string;
  hasParentSession: boolean;
  items: ConversationItem[];
}

const FORK_ORIGIN_TEXT = '从对话中派生';

export function applyForkOriginNotice({
  forkPointEntryId,
  hasParentSession,
  items,
}: ApplyForkOriginNoticeOptions): ConversationViewItem[] {
  if (!hasParentSession) return items;

  const notice = {
    key: `fork-origin:${forkPointEntryId ?? 'root'}`,
    type: 'notice' as const,
    notice: {
      kind: 'fork_origin' as const,
      text: FORK_ORIGIN_TEXT,
    },
  };

  if (!forkPointEntryId) return [notice, ...items];

  const anchorIndex = items.findIndex((item) => item.message.entryId === forkPointEntryId);
  if (anchorIndex < 0) return [notice, ...items];

  return [...items.slice(0, anchorIndex + 1), notice, ...items.slice(anchorIndex + 1)];
}
