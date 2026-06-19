// ============================================================
// Assistant Process Projection — assistant 消息到过程块的纯投影
// ============================================================

import type { ScoutAssistantMessage, ScoutToolResultMessage } from '@scout-agent/shared';
import type {
  ConversationItem,
  ToolCallPreviewState,
  ToolExecutionState,
} from '@/store/conversation-store';
import type {
  AssistantContentEntry,
  AssistantConversationRow,
  AssistantProcessActivity,
  AssistantProcessEntry,
  AssistantProcessPhase,
  AssistantProcessPhaseKind,
  AssistantProcessSummary,
  AssistantProcessStatus,
  AssistantStatusActivity,
  AssistantVisibleContent,
  ConversationRow,
} from './conversation-row-types';
import type { AssistantRuntimeActivity } from './conversation-turn-index';
import {
  contentToText,
  hasExpandableToolDisplayDetail,
  hasToolDisplaySummary,
  resolveToolDisplayResult,
} from './tool-display';

export interface AssistantTurnBuilder {
  key: string;
  processKey: string;
  contentEntries: AssistantContentEntry[];
  phases: AssistantProcessPhase[];
  actionTextParts: string[];
  timestamp: number;
  isStreaming: boolean;
  stopReason?: string;
  errorMessage?: string;
}

export function createAssistantTurnBuilder({
  anchorKey,
  timestamp,
}: {
  anchorKey: string;
  timestamp: number;
}): AssistantTurnBuilder {
  return {
    key: `assistant-turn:${anchorKey}`,
    processKey: `assistant-turn:${anchorKey}:process`,
    contentEntries: [],
    phases: [],
    actionTextParts: [],
    timestamp,
    isStreaming: false,
  };
}

export function appendAssistantMessageEntries({
  item,
  message,
  turn,
  isStreaming,
  runtimeActivity,
  toolExecutionsById,
  toolPreviewsById,
  resolveToolResult,
}: {
  item: ConversationItem;
  message: ScoutAssistantMessage;
  turn: AssistantTurnBuilder;
  isStreaming: boolean;
  runtimeActivity: AssistantRuntimeActivity;
  toolExecutionsById: Record<string, ToolExecutionState>;
  toolPreviewsById: Record<string, ToolCallPreviewState>;
  resolveToolResult: (toolCallId: string) => ScoutToolResultMessage | undefined;
}): void {
  turn.isStreaming ||= isStreaming;
  turn.stopReason = message.stopReason ?? turn.stopReason;
  turn.errorMessage = message.errorMessage ?? turn.errorMessage;
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
      contentBlocks.push(content);
      return;
    }

    flushContent(index);

    if (content.type === 'thinking') {
      appendProcessActivity(turn, 'model_responding', `${item.key}:model:${index}`, {
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
      const preview = toolPreviewsById[content.id];
      const toolResult = resolveToolResult(content.id);
      appendProcessActivity(turn, 'tool_processing', `${item.key}:tool-phase:${content.id}`, {
        type: 'tool',
        key: `${item.key}:tool:${content.id}`,
        toolCall: content,
        runtime,
        preview,
        toolResult,
        display: resolveToolDisplayResult({
          toolCall: content,
          runtime,
          preview,
          toolResult,
          assistantErrorMessage: message.errorMessage,
          assistantStopReason: message.stopReason,
        }),
      });
    }
  });

  flushContent(message.content.length);

  if (message.errorMessage) {
    appendProcessActivity(turn, 'status', `${item.key}:status-phase`, {
      type: 'status',
      key: `${item.key}:assistant-error`,
      text: message.errorMessage,
      tone: 'error',
      running: false,
    });
  }

  if (
    !hasAnyProcessActivity(turn.phases) &&
    isStreaming &&
    runtimeActivity !== 'idle' &&
    runtimeActivity !== 'waiting'
  ) {
    appendProcessActivity(
      turn,
      'tool_processing',
      `${item.key}:runtime-tool-phase`,
      createRuntimeStatusActivity(item.key, runtimeActivity),
    );
  }

  const actionText = contentToText(message.content);
  if (actionText) turn.actionTextParts.push(actionText);
  turn.timestamp = message.timestamp;
}

export function finalizeAssistantTurn(turn: AssistantTurnBuilder): AssistantConversationRow {
  const status = resolveTurnProcessStatus(turn);
  const processEntry: AssistantProcessEntry = {
    type: 'process',
    key: turn.processKey,
    summary: resolveProcessSummary(status),
    defaultOpen: getProcessDefaultOpen({
      status,
      hasVisibleContent: turn.contentEntries.length > 0,
      hasVisibleProcessContent: hasVisibleProcessContent(turn.phases),
      hasDiffTool: hasDiffToolActivity(turn.phases),
    }),
    phases: turn.phases,
  };

  return {
    type: 'assistant',
    key: turn.key,
    entries: [processEntry, ...turn.contentEntries],
    actionText: turn.actionTextParts.join('\n'),
    timestamp: turn.timestamp,
    isLatestAssistant: false,
    isStreaming: turn.isStreaming,
  };
}

export function appendRuntimeActivityRow(
  rows: ConversationRow[],
  {
    isTurnStreaming,
    activity,
    anchorKey,
    timestamp,
  }: {
    isTurnStreaming: boolean;
    activity: AssistantRuntimeActivity;
    anchorKey?: string;
    timestamp: number;
  },
): void {
  if (!isTurnStreaming || activity === 'idle') return;
  const key = `assistant-turn:${anchorKey ?? `runtime:${activity}`}`;
  const latestAssistant = findLatestAssistantRow(rows);
  if (latestAssistant?.isStreaming || latestAssistant?.key === key) return;

  const status: AssistantProcessStatus =
    activity === 'tool_running' ? 'work_processing' : 'model_deciding';
  const phaseKind: AssistantProcessPhaseKind =
    status === 'work_processing' ? 'tool_processing' : 'model_responding';
  const phases: AssistantProcessPhase[] =
    activity === 'waiting'
      ? []
      : [
          {
            kind: phaseKind,
            key: `${key}:phase:${status}`,
            activities: [createRuntimeStatusActivity(key, activity)],
          },
        ];
  rows.push({
    type: 'assistant',
    key,
    entries: [
      {
        type: 'process',
        key: `${key}:process`,
        summary: resolveProcessSummary(status),
        defaultOpen: getProcessDefaultOpen({
          status,
          hasVisibleContent: false,
          hasVisibleProcessContent: hasVisibleProcessContent(phases),
          hasDiffTool: hasDiffToolActivity(phases),
        }),
        phases,
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

function resolveTurnProcessStatus(turn: AssistantTurnBuilder): AssistantProcessStatus {
  if (turn.isStreaming) {
    return hasObservableWorkTrace(turn.phases) ? 'work_processing' : 'model_deciding';
  }
  if (turn.stopReason === 'aborted') return 'stopped';
  if (turn.stopReason === 'error') return 'failed';
  return 'completed';
}

function resolveProcessSummary(status: AssistantProcessStatus): AssistantProcessSummary {
  if (status === 'model_deciding') {
    return { status, label: '正在思考', running: true, tone: 'default' };
  }
  if (status === 'work_processing') {
    return { status, label: '正在处理', running: true, tone: 'default' };
  }
  if (status === 'stopped') {
    return { status, label: '已停止', running: false, tone: 'default' };
  }
  if (status === 'failed') {
    return { status, label: '处理失败', running: false, tone: 'error' };
  }
  return { status, label: '已处理', running: false, tone: 'default' };
}

function getProcessDefaultOpen({
  status,
  hasVisibleContent,
  hasVisibleProcessContent,
  hasDiffTool,
}: {
  status: AssistantProcessStatus;
  hasVisibleContent: boolean;
  hasVisibleProcessContent: boolean;
  hasDiffTool: boolean;
}): boolean {
  if (!hasVisibleProcessContent) return false;
  if (status === 'stopped') return true;
  if (status === 'failed') return true;
  if (hasDiffTool) return true;
  if (hasVisibleContent) return false;
  return status === 'model_deciding' || status === 'work_processing';
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
  if (activity === 'tool_running') return '正在运行工具';
  return '等待模型响应';
}

function appendProcessActivity(
  turn: AssistantTurnBuilder,
  kind: AssistantProcessPhaseKind,
  phaseKey: string,
  activity: AssistantProcessActivity,
): void {
  const lastPhase = turn.phases.at(-1);
  if (lastPhase?.kind === kind) {
    lastPhase.activities.push(activity);
  } else {
    turn.phases.push({ kind, key: phaseKey, activities: [activity] });
  }
}

function hasAnyProcessActivity(phases: AssistantProcessPhase[]): boolean {
  return phases.some((phase) => phase.activities.length > 0);
}

function hasObservableWorkTrace(phases: AssistantProcessPhase[]): boolean {
  return phases.some((phase) =>
    phase.activities.some((activity) => {
      if (activity.type === 'tool') return true;
      return phase.kind === 'tool_processing' && activity.type === 'status';
    }),
  );
}

function hasVisibleProcessContent(phases: AssistantProcessPhase[]): boolean {
  return phases.some((phase) => phase.activities.some(hasVisibleActivity));
}

function hasDiffToolActivity(phases: AssistantProcessPhase[]): boolean {
  return phases.some((phase) =>
    phase.activities.some(
      (activity) => activity.type === 'tool' && activity.display.detail?.kind === 'diff',
    ),
  );
}

function hasVisibleActivity(activity: AssistantProcessActivity): boolean {
  if (activity.type === 'status') return activity.text.trim().length > 0;
  if (activity.type === 'thinking') {
    return activity.content.redacted || activity.content.thinking.trim().length > 0;
  }
  return (
    hasToolDisplaySummary(activity.display) || hasExpandableToolDisplayDetail(activity.display)
  );
}
