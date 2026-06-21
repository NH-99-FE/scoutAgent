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
  AssistantProcessActivitySummary,
  AssistantProcessEntry,
  AssistantProcessLifecycle,
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
  formatMixedToolActivitySummaryLabel,
  formatToolActivitySummaryLabel,
  hasExpandableToolDisplayDetail,
  hasToolDisplaySummary,
  resolveToolActivitySummary,
  resolveToolDisplayResult,
} from './tool-display';

type AssistantProcessSegment = Omit<
  AssistantProcessEntry,
  'summary' | 'displayMode' | 'activitySummary' | 'defaultOpen'
> & {
  lifecycle: AssistantProcessLifecycle;
};
type AssistantTurnDraftEntry = AssistantContentEntry | AssistantProcessSegment;

export interface AssistantTurnBuilder {
  key: string;
  processKey: string;
  entries: AssistantTurnDraftEntry[];
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
    entries: [],
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
    closeActiveProcessSegment(turn);
    turn.entries.push({
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

  if (message.errorMessage && message.stopReason !== 'aborted') {
    appendProcessActivity(turn, 'status', `${item.key}:status-phase`, {
      type: 'status',
      key: `${item.key}:assistant-error`,
      text: message.errorMessage,
      tone: 'error',
      running: false,
    });
  }

  if (
    !hasAnyProcessActivity(getProcessSegments(turn.entries)) &&
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
  const entries = finalizeTurnEntries(turn);

  return {
    type: 'assistant',
    key: turn.key,
    entries,
    turnSummary: resolveAssistantTurnSummary(turn, entries),
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
        lifecycle: 'active',
        summary: resolveProcessSummary(status),
        displayMode: resolveProcessDisplayMode(status, 'active', phases),
        activitySummary: resolveActivitySummary(phases),
        defaultOpen: getProcessDefaultOpen({
          status,
          lifecycle: 'active',
          hasVisibleProcessContent: hasVisibleProcessContent(phases),
          hasDiffTool: hasDiffToolActivity(phases),
        }),
        phases,
      },
    ],
    turnSummary: {
      status,
      label: status === 'work_processing' ? '正在处理' : '正在思考',
      running: true,
      tone: 'default',
    },
    actionText: '',
    timestamp: timestamp || getLastRowTimestamp(rows),
    isLatestAssistant: false,
    isStreaming: true,
  });
}

function resolveAssistantTurnSummary(
  turn: AssistantTurnBuilder,
  entries: Array<AssistantContentEntry | AssistantProcessEntry>,
): AssistantConversationRow['turnSummary'] {
  const processes = entries.filter(
    (entry): entry is AssistantProcessEntry => entry.type === 'process',
  );

  if (turn.isStreaming) {
    const hasWorkTrace = processes.some((entry) => hasObservableWorkTrace(entry.phases));
    if (hasWorkTrace) {
      return {
        status: 'work_processing',
        label: '正在处理',
        running: true,
        tone: 'default',
      };
    }
    return {
      status: 'model_deciding',
      label: '正在思考',
      running: true,
      tone: 'default',
    };
  }

  if (!processes.some((entry) => hasVisibleProcessContent(entry.phases))) return undefined;

  if (turn.stopReason === 'error' || processes.some((entry) => entry.summary.status === 'failed')) {
    return { status: 'failed', label: '处理失败', running: false, tone: 'error' };
  }

  if (
    turn.stopReason === 'aborted' ||
    processes.some((entry) => entry.summary.status === 'stopped')
  ) {
    return { status: 'stopped', label: '已停止', running: false, tone: 'default' };
  }

  return { status: 'completed', label: '已处理', running: false, tone: 'default' };
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

function finalizeTurnEntries(
  turn: AssistantTurnBuilder,
): Array<AssistantContentEntry | AssistantProcessEntry> {
  const processSegments = getProcessSegments(turn.entries);
  if (processSegments.length === 0 && turn.entries.length > 0) {
    return turn.entries.filter((entry): entry is AssistantContentEntry => entry.type === 'content');
  }

  const draftEntries =
    processSegments.length > 0
      ? turn.entries
      : [
          {
            type: 'process' as const,
            key: turn.processKey,
            phases: [],
            lifecycle: 'active' as const,
          },
        ];

  return draftEntries.map((entry) => {
    if (entry.type === 'content') return entry;
    const lifecycle = resolveProcessLifecycle(turn, entry);

    const status = resolveSegmentProcessStatus({
      turn,
      phases: entry.phases,
      lifecycle,
    });

    return {
      type: entry.type,
      key: entry.key,
      lifecycle,
      phases: entry.phases,
      summary: resolveProcessSummary(status),
      displayMode: resolveProcessDisplayMode(status, lifecycle, entry.phases),
      activitySummary: resolveActivitySummary(entry.phases),
      defaultOpen: getProcessDefaultOpen({
        status,
        lifecycle,
        hasVisibleProcessContent: hasVisibleProcessContent(entry.phases),
        hasDiffTool: hasDiffToolActivity(entry.phases),
      }),
    };
  });
}

function resolveProcessLifecycle(
  turn: AssistantTurnBuilder,
  segment: AssistantProcessSegment,
): AssistantProcessLifecycle {
  if (segment.lifecycle !== 'active') return segment.lifecycle;
  if (!turn.isStreaming || turn.stopReason === 'aborted' || turn.stopReason === 'error') {
    return 'settled';
  }
  return 'active';
}

function resolveSegmentProcessStatus({
  turn,
  phases,
  lifecycle,
}: {
  turn: AssistantTurnBuilder;
  phases: AssistantProcessPhase[];
  lifecycle: AssistantProcessLifecycle;
}): AssistantProcessStatus {
  if (lifecycle === 'closed_by_content') return 'completed';
  if (turn.stopReason === 'aborted') return 'stopped';
  if (turn.stopReason === 'error') return 'failed';
  if (lifecycle === 'active') {
    return hasObservableWorkTrace(phases) ? 'work_processing' : 'model_deciding';
  }
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

function resolveProcessDisplayMode(
  status: AssistantProcessStatus,
  lifecycle: AssistantProcessLifecycle,
  phases: AssistantProcessPhase[],
): AssistantProcessEntry['displayMode'] {
  if (status === 'failed' || status === 'stopped') return 'status';
  if (!hasVisibleProcessContent(phases)) return 'status';
  return lifecycle === 'active' ? 'live' : 'compact';
}

function resolveActivitySummary(phases: AssistantProcessPhase[]): AssistantProcessActivitySummary {
  const tools: Array<{
    key: string;
    icon: AssistantProcessActivitySummary['items'][number]['icon'];
    label: string;
  }> = [];
  const counts = new Map<
    string,
    { icon: AssistantProcessActivitySummary['items'][number]['icon']; count: number }
  >();

  for (const phase of phases) {
    for (const activity of phase.activities) {
      if (activity.type !== 'tool') continue;
      const summary = resolveToolActivitySummary(activity.display);
      tools.push({
        key: activity.key,
        icon: summary.icon,
        label: activity.display.summaryTitle,
      });
      const existing = counts.get(summary.key);
      counts.set(summary.key, {
        icon: summary.icon,
        count: (existing?.count ?? 0) + 1,
      });
    }
  }

  const totalCount = tools.length;
  return {
    items: Array.from(counts.entries()).map(([kind, item]) => ({
      key: kind,
      icon: item.icon,
      label: formatToolActivitySummaryLabel(kind, item.count),
      count: item.count,
    })),
    mixed: counts.size > 1,
    primary: resolvePrimaryActivitySummary(tools, counts),
    totalCount,
  };
}

function resolvePrimaryActivitySummary(
  tools: Array<{
    key: string;
    icon: AssistantProcessActivitySummary['items'][number]['icon'];
    label: string;
  }>,
  counts: Map<
    string,
    { icon: AssistantProcessActivitySummary['items'][number]['icon']; count: number }
  >,
): AssistantProcessActivitySummary['primary'] {
  if (tools.length < 2) return undefined;
  if (counts.size === 1) {
    const [kind, item] = Array.from(counts.entries())[0];
    return {
      key: kind,
      icon: item.icon,
      label: formatToolActivitySummaryLabel(kind, item.count),
      count: item.count,
    };
  }
  return {
    key: 'mixed',
    icon: 'clipboard-list',
    label: formatMixedToolActivitySummaryLabel(tools.length),
    count: tools.length,
  };
}

function getProcessDefaultOpen({
  status,
  lifecycle,
  hasVisibleProcessContent,
  hasDiffTool,
}: {
  status: AssistantProcessStatus;
  lifecycle: AssistantProcessLifecycle;
  hasVisibleProcessContent: boolean;
  hasDiffTool: boolean;
}): boolean {
  if (!hasVisibleProcessContent) return false;
  if (status === 'stopped') return true;
  if (status === 'failed') return true;
  if (hasDiffTool) return true;
  if (lifecycle === 'closed_by_content') return false;
  return status === 'model_deciding' || status === 'work_processing';
}

function createRuntimeStatusActivity(
  key: string,
  _activity: Extract<AssistantRuntimeActivity, 'tool_running'>,
): AssistantStatusActivity {
  return {
    type: 'status',
    key: `${key}:runtime-status`,
    text: '正在运行工具',
    running: true,
  };
}

function appendProcessActivity(
  turn: AssistantTurnBuilder,
  kind: AssistantProcessPhaseKind,
  phaseKey: string,
  activity: AssistantProcessActivity,
): void {
  const process = ensureCurrentProcessSegment(turn, phaseKey);
  const lastPhase = process.phases.at(-1);
  if (lastPhase?.kind === kind) {
    lastPhase.activities.push(activity);
  } else {
    process.phases.push({ kind, key: phaseKey, activities: [activity] });
  }
}

function ensureCurrentProcessSegment(
  turn: AssistantTurnBuilder,
  phaseKey: string,
): AssistantProcessSegment {
  const lastEntry = turn.entries.at(-1);
  if (lastEntry?.type === 'process' && lastEntry.lifecycle === 'active') return lastEntry;

  const process: AssistantProcessSegment = {
    type: 'process',
    key: `${phaseKey}:process`,
    phases: [],
    lifecycle: 'active',
  };
  turn.entries.push(process);
  return process;
}

function closeActiveProcessSegment(turn: AssistantTurnBuilder): void {
  const lastEntry = turn.entries.at(-1);
  if (lastEntry?.type !== 'process' || lastEntry.lifecycle !== 'active') return;
  lastEntry.lifecycle = 'closed_by_content';
}

function getProcessSegments(entries: AssistantTurnDraftEntry[]): AssistantProcessSegment[] {
  return entries.filter((entry): entry is AssistantProcessSegment => entry.type === 'process');
}

function hasAnyProcessActivity(processes: AssistantProcessSegment[]): boolean {
  return processes.some((process) => process.phases.some((phase) => phase.activities.length > 0));
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
