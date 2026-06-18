// ============================================================
// Conversation Turn Index — turn 扫描、toolResult 配对与运行态线索
// ============================================================

import type { ScoutToolResultMessage } from '@scout-agent/shared';
import type { ConversationItem, ToolExecutionState } from '@/store/conversation-store';

export type AssistantRuntimeActivity = 'idle' | 'waiting' | 'tool_pending' | 'tool_running';

export interface ConversationIndex {
  streamingAssistantKey?: string;
  consumedToolResultKeys: Set<string>;
  toolResultQueuesById: Map<string, ToolResultQueueEntry[]>;
}

interface ToolResultQueueEntry {
  item: ConversationItem;
  index: number;
  message: ScoutToolResultMessage;
}

export function buildConversationIndex(
  items: ConversationItem[],
  isStreaming: boolean,
): ConversationIndex {
  const toolResultQueuesById = new Map<string, ToolResultQueueEntry[]>();
  let streamingAssistantKey: string | undefined;

  for (const [index, item] of items.entries()) {
    const { message } = item;
    if (isStreaming && message.role === 'user') {
      streamingAssistantKey = undefined;
    }
    if (isStreaming && message.role === 'assistant') {
      streamingAssistantKey = item.key;
    }
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

export function consumeNextToolResult(
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

export function resolveRuntimeActivity({
  items,
  streamingAssistantKey,
  isTurnStreaming,
  toolExecutionsById,
}: {
  items: ConversationItem[];
  streamingAssistantKey?: string;
  isTurnStreaming: boolean;
  toolExecutionsById: Record<string, ToolExecutionState>;
}): AssistantRuntimeActivity {
  if (!isTurnStreaming) return 'idle';

  const item = items.find((candidate) => candidate.key === streamingAssistantKey);
  if (!item || item.message.role !== 'assistant') return 'waiting';

  const toolCallIds = item.message.content
    .filter((content) => content.type === 'toolCall')
    .map((content) => content.id);

  const runningTool = toolCallIds.some(
    (toolCallId) => toolExecutionsById[toolCallId]?.status === 'running',
  );
  if (runningTool) return 'tool_running';

  const pendingToolCall = toolCallIds.some((toolCallId) => !toolExecutionsById[toolCallId]);
  if (pendingToolCall) return 'tool_pending';

  return 'waiting';
}
