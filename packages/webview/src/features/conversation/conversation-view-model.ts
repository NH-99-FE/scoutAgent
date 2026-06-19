// ============================================================
// Conversation View Model — 协议消息到展示 turn 的纯投影
// ============================================================

import type { ConversationItem } from '@/store/conversation-store';
import {
  appendAssistantMessageEntries,
  appendRuntimeActivityRow,
  createAssistantTurnBuilder,
  finalizeAssistantTurn,
  type AssistantTurnBuilder,
} from './assistant-process-projection';
import type {
  BuildConversationRowsOptions,
  ConversationRow,
  SystemConversationRow,
} from './conversation-row-types';
import {
  buildConversationIndex,
  consumeNextToolResult,
  resolveRuntimeActivity,
} from './conversation-turn-index';
import { contentToText } from './tool-display';

export type {
  AssistantContentEntry,
  AssistantConversationRow,
  AssistantProcessActivity,
  AssistantProcessEntry,
  AssistantProcessPhase,
  AssistantProcessPhaseKind,
  AssistantProcessSummary,
  AssistantProcessStatus,
  AssistantStatusActivity,
  AssistantThinkingActivity,
  AssistantToolActivity,
  AssistantTurnEntry,
  AssistantVisibleContent,
  BuildConversationRowsOptions,
  ConversationRow,
  SystemConversationRow,
  UserConversationRow,
} from './conversation-row-types';

export function buildConversationRows({
  items,
  isStreaming,
  busyState,
  toolExecutionsById,
  toolPreviewsById = {},
}: BuildConversationRowsOptions): ConversationRow[] {
  const isTurnStreaming = isStreaming && busyState.kind === 'agent';
  const index = buildConversationIndex(items, isTurnStreaming);
  const runtimeActivity = resolveRuntimeActivity({
    items,
    streamingAssistantKey: index.streamingAssistantKey,
    isTurnStreaming,
    toolExecutionsById,
  });
  const rows: ConversationRow[] = [];
  let currentTurn: AssistantTurnBuilder | undefined;
  let latestUserKey: string | undefined;
  let latestUserTimestamp = 0;

  const flushTurn = () => {
    if (!currentTurn) return;
    rows.push(finalizeAssistantTurn(currentTurn));
    currentTurn = undefined;
  };

  for (const [itemIndex, item] of items.entries()) {
    const { message } = item;

    if (message.role === 'user') {
      flushTurn();
      latestUserKey = item.key;
      latestUserTimestamp = message.timestamp;
      rows.push({ type: 'user', key: item.key, message });
      continue;
    }

    if (message.role === 'assistant') {
      currentTurn ??= createAssistantTurnBuilder({
        anchorKey: latestUserKey ?? item.key,
        timestamp: latestUserTimestamp || message.timestamp,
      });
      appendAssistantMessageEntries({
        item,
        message,
        turn: currentTurn,
        isStreaming: item.key === index.streamingAssistantKey,
        runtimeActivity,
        toolExecutionsById,
        toolPreviewsById,
        resolveToolResult: (toolCallId) => consumeNextToolResult(index, toolCallId, itemIndex),
      });
      continue;
    }

    if (message.role === 'toolResult' && index.consumedToolResultKeys.has(item.key)) {
      continue;
    }

    flushTurn();
    rows.push(createSystemRow(item));
  }

  flushTurn();
  appendRuntimeActivityRow(rows, {
    isTurnStreaming,
    activity: runtimeActivity,
    anchorKey: latestUserKey,
    timestamp: latestUserTimestamp,
  });
  markLatestAssistantRow(rows);
  return rows;
}

function markLatestAssistantRow(rows: ConversationRow[]): void {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.type !== 'assistant') continue;
    row.isLatestAssistant = true;
    return;
  }
}

function createSystemRow(item: ConversationItem): SystemConversationRow {
  const { message } = item;

  if (message.role === 'toolResult') {
    return {
      type: 'system',
      key: item.key,
      title: message.toolName,
      text: contentToText(message.content),
      tone: message.isError ? 'error' : 'default',
      defaultOpen: true,
    };
  }

  if (message.role === 'branchSummary') {
    return {
      type: 'system',
      key: item.key,
      title: '分支摘要',
      text: message.summary,
      tone: 'default',
      defaultOpen: false,
    };
  }

  if (message.role === 'compactionSummary') {
    return {
      type: 'system',
      key: item.key,
      title: '压缩摘要',
      text: message.summary,
      tone: 'default',
      defaultOpen: false,
    };
  }

  if (message.role === 'custom') {
    return {
      type: 'system',
      key: item.key,
      title: message.customType,
      text: contentToText(message.content),
      tone: 'default',
      defaultOpen: true,
    };
  }

  return {
    type: 'system',
    key: item.key,
    title: message.role,
    text: '',
    tone: 'default',
    defaultOpen: false,
  };
}
