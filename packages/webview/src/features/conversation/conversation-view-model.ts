// ============================================================
// Conversation View Model — 协议消息到展示 turn 的纯投影
// ============================================================

import type {
  ScoutAssistantMessage,
  ScoutImageContent,
  ScoutMessage,
  ScoutTextContent,
  ScoutThinkingContent,
  ScoutToolCallContent,
  ScoutToolResultMessage,
} from '@scout-agent/shared';
import type { ConversationItem, ToolExecutionState } from '@/store/conversation-store';
import { contentToText, resolveToolDisplayResult, type ToolDisplayResult } from './tool-display';

export type AssistantVisibleContent = ScoutTextContent | ScoutImageContent;

export type ConversationRow =
  | UserConversationRow
  | AssistantConversationRow
  | SystemConversationRow;

export interface UserConversationRow {
  type: 'user';
  key: string;
  message: Extract<ScoutMessage, { role: 'user' }>;
}

export interface AssistantConversationRow {
  type: 'assistant';
  key: string;
  entries: AssistantTurnEntry[];
  actionText: string;
  timestamp: number;
  isLatestAssistant: boolean;
  isStreaming: boolean;
}

export type AssistantTurnEntry = AssistantContentEntry | AssistantProcessEntry;

export interface AssistantContentEntry {
  type: 'content';
  key: string;
  blocks: AssistantVisibleContent[];
  errorMessage?: string;
  timestamp: number;
}

export interface AssistantProcessEntry {
  type: 'process';
  key: string;
  activities: AssistantProcessActivity[];
}

export type AssistantProcessActivity =
  | AssistantThinkingActivity
  | AssistantToolActivity
  | AssistantStatusActivity;

export interface AssistantThinkingActivity {
  type: 'thinking';
  key: string;
  content: ScoutThinkingContent;
  isStreaming: boolean;
  messageKey: string;
}

export interface AssistantToolActivity {
  type: 'tool';
  key: string;
  toolCall: ScoutToolCallContent;
  display: ToolDisplayResult;
  runtime?: ToolExecutionState;
  toolResult?: ScoutToolResultMessage;
  assistantErrorMessage?: string;
  assistantStopReason?: string;
}

export interface AssistantStatusActivity {
  type: 'status';
  key: string;
  text: string;
}

export interface SystemConversationRow {
  type: 'system';
  key: string;
  title: string;
  text: string;
  tone: 'default' | 'error';
  defaultOpen: boolean;
}

export interface BuildConversationRowsOptions {
  items: ConversationItem[];
  isStreaming: boolean;
  toolExecutionsById: Record<string, ToolExecutionState>;
}

interface ConversationIndex {
  streamingAssistantKey?: string;
  consumedToolResultKeys: Set<string>;
  toolResultQueuesById: Map<string, ToolResultQueueEntry[]>;
}

interface ToolResultQueueEntry {
  item: ConversationItem;
  index: number;
  message: ScoutToolResultMessage;
}

export function buildConversationRows({
  items,
  isStreaming,
  toolExecutionsById,
}: BuildConversationRowsOptions): ConversationRow[] {
  const index = buildConversationIndex(items, isStreaming);
  const rows: ConversationRow[] = [];
  let currentAssistant: AssistantConversationRow | undefined;

  const flushAssistant = () => {
    if (!currentAssistant) return;
    rows.push(currentAssistant);
    currentAssistant = undefined;
  };

  for (const [itemIndex, item] of items.entries()) {
    const { message } = item;

    if (message.role === 'user') {
      flushAssistant();
      rows.push({ type: 'user', key: item.key, message });
      continue;
    }

    if (message.role === 'assistant') {
      currentAssistant ??= {
        type: 'assistant',
        key: `assistant:${item.key}`,
        entries: [],
        actionText: '',
        timestamp: message.timestamp,
        isLatestAssistant: false,
        isStreaming: false,
      };
      appendAssistantMessageEntries({
        item,
        message,
        row: currentAssistant,
        isStreaming: item.key === index.streamingAssistantKey,
        toolExecutionsById,
        resolveToolResult: (toolCallId) => consumeNextToolResult(index, toolCallId, itemIndex),
      });
      continue;
    }

    if (message.role === 'toolResult' && index.consumedToolResultKeys.has(item.key)) {
      continue;
    }

    flushAssistant();
    rows.push(createSystemRow(item));
  }

  flushAssistant();
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

function appendAssistantMessageEntries({
  item,
  message,
  row,
  isStreaming,
  toolExecutionsById,
  resolveToolResult,
}: {
  item: ConversationItem;
  message: ScoutAssistantMessage;
  row: AssistantConversationRow;
  isStreaming: boolean;
  toolExecutionsById: Record<string, ToolExecutionState>;
  resolveToolResult: (toolCallId: string) => ScoutToolResultMessage | undefined;
}) {
  row.isStreaming ||= isStreaming;
  const contentBlocks: AssistantVisibleContent[] = [];
  const processActivities: AssistantProcessActivity[] = [];
  const flushContent = (index: number) => {
    if (contentBlocks.length === 0) return;
    row.entries.push({
      type: 'content',
      key: `${item.key}:content:${index}`,
      blocks: [...contentBlocks],
      timestamp: message.timestamp,
    });
    contentBlocks.length = 0;
  };
  const flushProcess = (index: number) => {
    if (processActivities.length === 0) return;
    row.entries.push({
      type: 'process',
      key: `${item.key}:process:${index}`,
      activities: [...processActivities],
    });
    processActivities.length = 0;
  };

  message.content.forEach((content, index) => {
    if (content.type === 'text' || content.type === 'image') {
      flushProcess(index);
      if (content.type === 'text' && !content.text.trim()) return;
      contentBlocks.push(content);
      return;
    }

    flushContent(index);
    if (content.type === 'thinking') {
      processActivities.push({
        type: 'thinking',
        key: `${item.key}:thinking:${index}`,
        content,
        isStreaming,
        messageKey: item.key,
      });
      return;
    }

    if (content.type === 'toolCall') {
      const runtime = toolExecutionsById[content.id];
      const toolResult = resolveToolResult(content.id);
      processActivities.push({
        type: 'tool',
        key: `${item.key}:tool:${content.id}`,
        toolCall: content,
        runtime,
        toolResult,
        display: resolveToolDisplayResult({
          toolCall: content,
          runtime,
          toolResult,
          assistantErrorMessage: message.errorMessage,
          assistantStopReason: message.stopReason,
        }),
        assistantErrorMessage: message.errorMessage,
        assistantStopReason: message.stopReason,
      });
    }
  });

  flushContent(message.content.length);
  flushProcess(message.content.length);

  if (message.errorMessage && !hasToolCall(message)) {
    row.entries.push({
      type: 'content',
      key: `${item.key}:error`,
      blocks: [],
      errorMessage: message.errorMessage,
      timestamp: message.timestamp,
    });
  }

  if (row.entries.length === 0 && isStreaming) {
    row.entries.push({
      type: 'process',
      key: `${item.key}:status`,
      activities: [{ type: 'status', key: `${item.key}:thinking-status`, text: '正在思考' }],
    });
  }

  const actionText = contentToText(message.content);
  row.actionText = [row.actionText, actionText].filter(Boolean).join('\n');
  row.timestamp = message.timestamp;
}

function buildConversationIndex(
  items: ConversationItem[],
  isStreaming: boolean,
): ConversationIndex {
  const toolResultQueuesById = new Map<string, ToolResultQueueEntry[]>();
  const lastItem = items[items.length - 1];
  const streamingAssistantKey =
    isStreaming && lastItem?.message.role === 'assistant' ? lastItem.key : undefined;

  for (const [index, item] of items.entries()) {
    const { message } = item;
    if (message.role === 'toolResult') {
      const queue = toolResultQueuesById.get(message.toolCallId) ?? [];
      queue.push({ item, index, message });
      toolResultQueuesById.set(message.toolCallId, queue);
    }
  }

  return {
    streamingAssistantKey,
    consumedToolResultKeys: new Set(),
    toolResultQueuesById,
  };
}

function consumeNextToolResult(
  index: ConversationIndex,
  toolCallId: string,
  afterItemIndex: number,
): ScoutToolResultMessage | undefined {
  const queue = index.toolResultQueuesById.get(toolCallId);
  const result = queue?.find(
    (entry) => entry.index > afterItemIndex && !index.consumedToolResultKeys.has(entry.item.key),
  );
  if (!result) return undefined;
  index.consumedToolResultKeys.add(result.item.key);
  return result.message;
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

function hasToolCall(message: ScoutAssistantMessage): boolean {
  return message.content.some((content) => content.type === 'toolCall');
}
