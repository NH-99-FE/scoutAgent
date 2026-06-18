// ============================================================
// Assistant Process Projection — assistant 消息到过程块的纯投影
// ============================================================

import type { ScoutAssistantMessage, ScoutToolResultMessage } from '@scout-agent/shared';
import type { ConversationItem, ToolExecutionState } from '@/store/conversation-store';
import type {
  AssistantContentEntry,
  AssistantConversationRow,
  AssistantProcessActivity,
  AssistantProcessEntry,
  AssistantProcessSummary,
  AssistantStatusActivity,
  AssistantVisibleContent,
  ConversationRow,
} from './conversation-row-types';
import type { AssistantRuntimeActivity } from './conversation-turn-index';
import { contentToText, resolveToolDisplayResult } from './tool-display';

type TurnProcessStatus = 'thinking' | 'processing' | 'completed' | 'stopped';

export interface AssistantTurnBuilder {
  key: string;
  processKey: string;
  contentEntries: AssistantContentEntry[];
  activities: AssistantProcessActivity[];
  actionTextParts: string[];
  timestamp: number;
  isStreaming: boolean;
  forceProcessing: boolean;
  hasProcessingTrace: boolean;
  stopReason?: string;
}

export interface AssistantTurnMeta {
  hasProcessingTrace: boolean;
}

export interface AssistantTurnProjection {
  row: AssistantConversationRow;
  meta: AssistantTurnMeta;
}

export function createAssistantTurnBuilder({
  anchorKey,
  timestamp,
  forceProcessing,
}: {
  anchorKey: string;
  timestamp: number;
  forceProcessing: boolean;
}): AssistantTurnBuilder {
  return {
    key: `assistant-turn:${anchorKey}`,
    processKey: `assistant-turn:${anchorKey}:process`,
    contentEntries: [],
    activities: [],
    actionTextParts: [],
    timestamp,
    isStreaming: false,
    forceProcessing,
    hasProcessingTrace: false,
  };
}

export function appendAssistantMessageEntries({
  item,
  message,
  turn,
  isStreaming,
  runtimeActivity,
  toolExecutionsById,
  resolveToolResult,
}: {
  item: ConversationItem;
  message: ScoutAssistantMessage;
  turn: AssistantTurnBuilder;
  isStreaming: boolean;
  runtimeActivity: AssistantRuntimeActivity;
  toolExecutionsById: Record<string, ToolExecutionState>;
  resolveToolResult: (toolCallId: string) => ScoutToolResultMessage | undefined;
}): void {
  turn.isStreaming ||= isStreaming;
  turn.stopReason = message.stopReason ?? turn.stopReason;
  const contentBlocks: AssistantVisibleContent[] = [];
  const flushContent = (index: number) => {
    if (contentBlocks.length === 0) return;
    turn.contentEntries.push({
      type: 'content',
      key: `${item.key}:content:${index}`,
      blocks: [...contentBlocks],
      timestamp: message.timestamp,
    });
    contentBlocks.length = 0;
  };

  message.content.forEach((content, index) => {
    if (content.type === 'text' || content.type === 'image') {
      if (content.type === 'text' && !content.text.trim()) return;
      turn.hasProcessingTrace = true;
      contentBlocks.push(content);
      return;
    }

    flushContent(index);

    if (content.type === 'thinking') {
      turn.activities.push({
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
      turn.hasProcessingTrace = true;
      turn.activities.push({
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
      });
    }
  });

  flushContent(message.content.length);

  if (message.errorMessage) {
    turn.hasProcessingTrace = true;
    turn.activities.push({
      type: 'status',
      key: `${item.key}:assistant-error`,
      text: message.errorMessage,
      tone: 'error',
      running: false,
    });
  }

  if (turn.activities.length === 0 && isStreaming && runtimeActivity !== 'idle') {
    turn.activities.push(createRuntimeStatusActivity(item.key, runtimeActivity));
  }

  const actionText = contentToText(message.content);
  if (actionText) turn.actionTextParts.push(actionText);
  turn.timestamp = message.timestamp;
}

export function finalizeAssistantTurn(turn: AssistantTurnBuilder): AssistantTurnProjection {
  const status = resolveTurnProcessStatus(turn);
  const processEntry: AssistantProcessEntry = {
    type: 'process',
    key: turn.processKey,
    summary: resolveProcessSummary(status),
    defaultOpen: getProcessDefaultOpen(status),
    activities: turn.activities,
  };

  return {
    row: {
      type: 'assistant',
      key: turn.key,
      entries: [processEntry, ...turn.contentEntries],
      actionText: turn.actionTextParts.join('\n'),
      timestamp: turn.timestamp,
      isLatestAssistant: false,
      isStreaming: turn.isStreaming,
    },
    meta: {
      hasProcessingTrace: turn.hasProcessingTrace,
    },
  };
}

export function appendRuntimeActivityRow(
  rows: ConversationRow[],
  {
    isTurnStreaming,
    activity,
    forceProcessing,
    hasProcessingTrace,
    anchorKey,
    timestamp,
  }: {
    isTurnStreaming: boolean;
    activity: AssistantRuntimeActivity;
    forceProcessing: boolean;
    hasProcessingTrace: boolean;
    anchorKey?: string;
    timestamp: number;
  },
): void {
  if (!isTurnStreaming || activity === 'idle') return;
  const latestAssistant = findLatestAssistantRow(rows);
  if (latestAssistant?.isStreaming) return;

  const key = `assistant-turn:${anchorKey ?? `runtime:${activity}`}`;
  const status =
    forceProcessing ||
    hasProcessingTrace ||
    activity === 'tool_pending' ||
    activity === 'tool_running'
      ? 'processing'
      : 'thinking';
  rows.push({
    type: 'assistant',
    key,
    entries: [
      {
        type: 'process',
        key: `${key}:process`,
        summary: resolveProcessSummary(status),
        defaultOpen: getProcessDefaultOpen(status),
        activities: [createRuntimeStatusActivity(key, activity)],
      },
    ],
    actionText: '',
    timestamp: timestamp || getLastRowTimestamp(rows),
    isLatestAssistant: false,
    isStreaming: true,
  });
}

function findLatestAssistantRow(rows: ConversationRow[]): AssistantConversationRow | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.type === 'assistant') return row;
  }
  return undefined;
}

function getLastRowTimestamp(rows: ConversationRow[]): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.type === 'assistant') return row.timestamp;
    if (row.type === 'user') return row.message.timestamp;
  }
  return 0;
}

function resolveTurnProcessStatus(turn: AssistantTurnBuilder): TurnProcessStatus {
  if (turn.isStreaming) {
    return turn.forceProcessing || turn.hasProcessingTrace ? 'processing' : 'thinking';
  }
  if (turn.stopReason === 'aborted') return 'stopped';
  return 'completed';
}

function resolveProcessSummary(status: TurnProcessStatus): AssistantProcessSummary {
  if (status === 'thinking') {
    return { label: '思考中', running: true, tone: 'default' };
  }
  if (status === 'processing') {
    return { label: '正在处理', running: true, tone: 'default' };
  }
  if (status === 'stopped') {
    return { label: '已停止', running: false, tone: 'default' };
  }
  return { label: '处理完成', running: false, tone: 'default' };
}

function getProcessDefaultOpen(status: TurnProcessStatus): boolean {
  return status === 'thinking' || status === 'processing' || status === 'stopped';
}

function createRuntimeStatusActivity(
  key: string,
  activity: AssistantRuntimeActivity,
): AssistantStatusActivity {
  return {
    type: 'status',
    key: `${key}:runtime-status`,
    text: formatRuntimeActivityLabel(activity),
    running: true,
  };
}

function formatRuntimeActivityLabel(activity: AssistantRuntimeActivity): string {
  if (activity === 'tool_pending') return '等待运行工具';
  if (activity === 'tool_running') return '正在运行工具';
  return '等待模型响应';
}
