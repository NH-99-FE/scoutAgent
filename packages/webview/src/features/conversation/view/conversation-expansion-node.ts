// ============================================================
// Conversation Expansion Node — 会话折叠节点注册
// ============================================================

import { useEffect } from 'react';
import type { ConversationExpansionNode } from '@/store/conversation-expansion-store';
import { useConversationExpansionStore } from '@/store/conversation-expansion-store';

export function useRegisterConversationExpansionNode({
  id,
  kind,
  parentId,
}: ConversationExpansionNode): void {
  useEffect(() => {
    const { actions } = useConversationExpansionStore.getState();
    actions.registerNode({ id, kind, parentId });
    return () => actions.unregisterNode(id);
  }, [id, kind, parentId]);
}
