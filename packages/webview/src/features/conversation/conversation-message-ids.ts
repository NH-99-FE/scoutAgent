// ============================================================
// Conversation Message Ids — 会话滚动行标识
// ============================================================

export const CONVERSATION_EXTENSION_REQUESTS_MESSAGE_ID = 'conversation-extension-requests';

const RUNTIME_STATUS_MESSAGE_ID_PREFIX = 'runtime-status';

export function getRuntimeStatusMessageId(key: string): string {
  return `${RUNTIME_STATUS_MESSAGE_ID_PREFIX}:${key}`;
}
