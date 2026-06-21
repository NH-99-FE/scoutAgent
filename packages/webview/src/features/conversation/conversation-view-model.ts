// ============================================================
// Conversation View Model — 协议消息到展示 turn 的增量投影
// ============================================================

import type {
  ScoutAssistantMessage,
  ScoutMessage,
  ScoutToolResultMessage,
} from '@scout-agent/shared';
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
  ManualAbortConversationRow,
  SystemConversationRow,
} from './conversation-row-types';
import {
  buildConversationIndex,
  consumeNextToolResult,
  resolveRuntimeActivity,
  type AssistantRuntimeActivity,
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
  AssistantTurnSummary,
  AssistantTurnEntry,
  AssistantVisibleContent,
  BuildConversationRowsOptions,
  ConversationRow,
  ManualAbortConversationRow,
  SystemConversationRow,
  UserConversationRow,
} from './conversation-row-types';

export interface ConversationRowsProjector {
  project: (options: BuildConversationRowsOptions) => ConversationRow[];
  reset: () => void;
}

interface ProjectedSegment {
  rows: ConversationRow[];
  signature: SegmentSignature;
}

type SegmentPlan = UserSegmentPlan | AssistantSegmentPlan | SystemSegmentPlan | RuntimeSegmentPlan;

interface SegmentSignature {
  kind: SegmentPlan['kind'];
  refs: unknown[];
  scalars: unknown[];
}

interface SegmentBase {
  key: string;
  signature: SegmentSignature;
}

interface UserSegmentPlan extends SegmentBase {
  kind: 'user';
  item: ConversationItem;
  message: Extract<ScoutMessage, { role: 'user' }>;
}

interface AssistantSegmentPlan extends SegmentBase {
  anchorKey: string;
  isLatestAssistant: boolean;
  items: AssistantSegmentItem[];
  kind: 'assistant';
  runtimeActivity: AssistantRuntimeActivity;
  streamingAssistantKey?: string;
  timestamp: number;
}

interface AssistantSegmentItem {
  item: ConversationItem;
  itemIndex: number;
  message: ScoutAssistantMessage;
  pairedToolResults: ScoutToolResultMessage[];
  pairedToolResultsByToolCallId: Map<string, ScoutToolResultMessage[]>;
  toolCallIds: string[];
}

interface SystemSegmentPlan extends SegmentBase {
  item: ConversationItem;
  kind: 'system';
}

interface RuntimeSegmentPlan extends SegmentBase {
  activity: Exclude<AssistantRuntimeActivity, 'idle'>;
  anchorKey?: string;
  isLatestAssistant: boolean;
  kind: 'runtime';
  timestamp: number;
}

type RawSegment = RawUserSegment | RawAssistantSegment | RawSystemSegment | RawRuntimeSegment;

interface RawUserSegment {
  item: ConversationItem;
  key: string;
  kind: 'user';
  message: Extract<ScoutMessage, { role: 'user' }>;
}

interface RawAssistantSegment {
  anchorKey: string;
  isStreaming: boolean;
  items: AssistantSegmentItem[];
  key: string;
  kind: 'assistant';
  timestamp: number;
}

interface RawSystemSegment {
  item: ConversationItem;
  key: string;
  kind: 'system';
}

interface RawRuntimeSegment {
  activity: Exclude<AssistantRuntimeActivity, 'idle'>;
  anchorKey?: string;
  key: string;
  kind: 'runtime';
  timestamp: number;
}

interface ToolResultPairingPlan {
  consumedToolResultKeys: Set<string>;
  pairedByAssistantItemKey: Map<string, Map<string, ScoutToolResultMessage[]>>;
  pairedResultsByAssistantItemKey: Map<string, ScoutToolResultMessage[]>;
  streamingAssistantKey?: string;
}

class IncrementalConversationRowsProjector implements ConversationRowsProjector {
  private projectedSegmentsByKey = new Map<string, ProjectedSegment>();

  project(options: BuildConversationRowsOptions): ConversationRow[] {
    const segments = planConversationSegments(options);
    const nextSegmentsByKey = new Map<string, ProjectedSegment>();
    const rows: ConversationRow[] = [];

    for (const segment of segments) {
      const previous = this.projectedSegmentsByKey.get(segment.key);
      const projected =
        previous && areSignaturesEqual(previous.signature, segment.signature)
          ? previous
          : {
              rows: projectSegment(segment, options),
              signature: segment.signature,
            };
      nextSegmentsByKey.set(segment.key, projected);
      rows.push(...projected.rows);
    }

    this.projectedSegmentsByKey = nextSegmentsByKey;
    return rows;
  }

  reset(): void {
    this.projectedSegmentsByKey = new Map();
  }
}

export function createConversationRowsProjector(): ConversationRowsProjector {
  return new IncrementalConversationRowsProjector();
}

export function buildConversationRows(options: BuildConversationRowsOptions): ConversationRow[] {
  return createConversationRowsProjector().project(options);
}

function planConversationSegments({
  busyState,
  isStreaming,
  items,
  toolExecutionsById,
  toolPreviewsById = {},
}: BuildConversationRowsOptions): SegmentPlan[] {
  const isTurnStreaming = isStreaming && busyState.kind === 'agent';
  const pairingPlan = createToolResultPairingPlan(items, isTurnStreaming);
  const runtimeActivity = resolveRuntimeActivity({
    items,
    streamingAssistantKey: pairingPlan.streamingAssistantKey,
    isTurnStreaming,
    toolExecutionsById,
  });
  const rawSegments: RawSegment[] = [];
  let currentAssistant: RawAssistantSegment | undefined;
  let latestUserKey: string | undefined;
  let latestUserTimestamp = 0;

  const flushAssistant = () => {
    if (!currentAssistant) return;
    rawSegments.push(currentAssistant);
    currentAssistant = undefined;
  };

  for (const [itemIndex, item] of items.entries()) {
    const { message } = item;

    if (message.role === 'user') {
      flushAssistant();
      latestUserKey = item.key;
      latestUserTimestamp = message.timestamp;
      rawSegments.push({ kind: 'user', key: item.key, item, message });
      continue;
    }

    if (message.role === 'assistant') {
      currentAssistant ??= {
        kind: 'assistant',
        key: `assistant-turn:${latestUserKey ?? item.key}`,
        anchorKey: latestUserKey ?? item.key,
        timestamp: latestUserTimestamp || message.timestamp,
        isStreaming: false,
        items: [],
      };
      const segmentItem = createAssistantSegmentItem(item, itemIndex, message, pairingPlan);
      currentAssistant.isStreaming ||= item.key === pairingPlan.streamingAssistantKey;
      currentAssistant.items.push(segmentItem);
      continue;
    }

    if (message.role === 'toolResult' && pairingPlan.consumedToolResultKeys.has(item.key)) {
      continue;
    }

    flushAssistant();
    rawSegments.push({ kind: 'system', key: item.key, item });
  }

  flushAssistant();
  appendRuntimeSegment(rawSegments, {
    activity: runtimeActivity,
    isTurnStreaming,
    latestUserKey,
    latestUserTimestamp,
  });

  const latestAssistantSegmentIndex = findLatestAssistantSegmentIndex(rawSegments);
  return rawSegments.map((segment, index) =>
    createSegmentPlan(segment, {
      isLatestAssistant: index === latestAssistantSegmentIndex,
      runtimeActivity,
      streamingAssistantKey: pairingPlan.streamingAssistantKey,
      toolExecutionsById,
      toolPreviewsById,
    }),
  );
}

function createToolResultPairingPlan(
  items: ConversationItem[],
  isTurnStreaming: boolean,
): ToolResultPairingPlan {
  const index = buildConversationIndex(items, isTurnStreaming);
  const pairedByAssistantItemKey = new Map<string, Map<string, ScoutToolResultMessage[]>>();
  const pairedResultsByAssistantItemKey = new Map<string, ScoutToolResultMessage[]>();

  for (const [itemIndex, item] of items.entries()) {
    const { message } = item;
    if (message.role !== 'assistant') continue;

    for (const content of message.content) {
      if (content.type !== 'toolCall') continue;
      const toolResult = consumeNextToolResult(index, content.id, itemIndex);
      if (!toolResult) continue;
      const pairedByToolCallId = pairedByAssistantItemKey.get(item.key) ?? new Map();
      const queue = pairedByToolCallId.get(content.id) ?? [];
      queue.push(toolResult);
      pairedByToolCallId.set(content.id, queue);
      pairedByAssistantItemKey.set(item.key, pairedByToolCallId);

      const pairedResults = pairedResultsByAssistantItemKey.get(item.key) ?? [];
      pairedResults.push(toolResult);
      pairedResultsByAssistantItemKey.set(item.key, pairedResults);
    }
  }

  return {
    consumedToolResultKeys: index.consumedToolResultKeys,
    pairedByAssistantItemKey,
    pairedResultsByAssistantItemKey,
    streamingAssistantKey: index.streamingAssistantKey,
  };
}

function createAssistantSegmentItem(
  item: ConversationItem,
  itemIndex: number,
  message: ScoutAssistantMessage,
  pairingPlan: ToolResultPairingPlan,
): AssistantSegmentItem {
  return {
    item,
    itemIndex,
    message,
    pairedToolResults: pairingPlan.pairedResultsByAssistantItemKey.get(item.key) ?? [],
    pairedToolResultsByToolCallId: pairingPlan.pairedByAssistantItemKey.get(item.key) ?? new Map(),
    toolCallIds: message.content
      .filter((content) => content.type === 'toolCall')
      .map((content) => content.id),
  };
}

function appendRuntimeSegment(
  segments: RawSegment[],
  {
    activity,
    isTurnStreaming,
    latestUserKey,
    latestUserTimestamp,
  }: {
    activity: AssistantRuntimeActivity;
    isTurnStreaming: boolean;
    latestUserKey?: string;
    latestUserTimestamp: number;
  },
): void {
  if (!isTurnStreaming || activity === 'idle') return;

  const key = `assistant-turn:${latestUserKey ?? `runtime:${activity}`}`;
  const latestAssistant = findLatestRawAssistantSegment(segments);
  if (latestAssistant?.isStreaming || latestAssistant?.key === key) return;

  segments.push({
    kind: 'runtime',
    key,
    anchorKey: latestUserKey,
    timestamp: latestUserTimestamp,
    activity,
  });
}

function findLatestRawAssistantSegment(segments: RawSegment[]): RawAssistantSegment | undefined {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment.kind === 'assistant') return segment;
  }
  return undefined;
}

function findLatestAssistantSegmentIndex(segments: RawSegment[]): number {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment.kind === 'assistant' || segment.kind === 'runtime') return index;
  }
  return -1;
}

function createSegmentPlan(
  segment: RawSegment,
  context: {
    isLatestAssistant: boolean;
    runtimeActivity: AssistantRuntimeActivity;
    streamingAssistantKey?: string;
    toolExecutionsById: BuildConversationRowsOptions['toolExecutionsById'];
    toolPreviewsById: NonNullable<BuildConversationRowsOptions['toolPreviewsById']>;
  },
): SegmentPlan {
  if (segment.kind === 'user') {
    return {
      ...segment,
      signature: createSignature('user', [segment.key], [segment.message]),
    };
  }

  if (segment.kind === 'system') {
    return {
      ...segment,
      signature: createSignature('system', [segment.key], [segment.item.message]),
    };
  }

  if (segment.kind === 'runtime') {
    return {
      ...segment,
      isLatestAssistant: context.isLatestAssistant,
      signature: createSignature(
        'runtime',
        [
          segment.key,
          segment.anchorKey,
          segment.timestamp,
          segment.activity,
          context.isLatestAssistant,
        ],
        [],
      ),
    };
  }

  return {
    ...segment,
    isLatestAssistant: context.isLatestAssistant,
    runtimeActivity: context.runtimeActivity,
    streamingAssistantKey: context.streamingAssistantKey,
    signature: createAssistantSignature(segment, context),
  };
}

function createAssistantSignature(
  segment: RawAssistantSegment,
  {
    isLatestAssistant,
    runtimeActivity,
    streamingAssistantKey,
    toolExecutionsById,
    toolPreviewsById,
  }: {
    isLatestAssistant: boolean;
    runtimeActivity: AssistantRuntimeActivity;
    streamingAssistantKey?: string;
    toolExecutionsById: BuildConversationRowsOptions['toolExecutionsById'];
    toolPreviewsById: NonNullable<BuildConversationRowsOptions['toolPreviewsById']>;
  },
): SegmentSignature {
  const refs: unknown[] = [];
  for (const item of segment.items) {
    refs.push(item.message, ...item.pairedToolResults);
    for (const toolCallId of item.toolCallIds) {
      refs.push(toolExecutionsById[toolCallId], toolPreviewsById[toolCallId]);
    }
  }

  return createSignature(
    'assistant',
    [
      segment.key,
      segment.anchorKey,
      segment.timestamp,
      segment.isStreaming,
      isLatestAssistant,
      streamingAssistantKey,
      runtimeActivity,
    ],
    refs,
  );
}

function createSignature(
  kind: SegmentSignature['kind'],
  scalars: unknown[],
  refs: unknown[],
): SegmentSignature {
  return { kind, scalars, refs };
}

function areSignaturesEqual(previous: SegmentSignature, next: SegmentSignature): boolean {
  return (
    previous.kind === next.kind &&
    areUnknownArraysEqual(previous.scalars, next.scalars) &&
    areUnknownArraysEqual(previous.refs, next.refs)
  );
}

function areUnknownArraysEqual(previous: unknown[], next: unknown[]): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((value, index) => Object.is(value, next[index]));
}

function projectSegment(
  segment: SegmentPlan,
  options: BuildConversationRowsOptions,
): ConversationRow[] {
  if (segment.kind === 'user') {
    return [{ type: 'user', key: segment.key, message: segment.message }];
  }

  if (segment.kind === 'system') {
    return [createSystemRow(segment.item)];
  }

  if (segment.kind === 'runtime') {
    return projectRuntimeSegment(segment);
  }

  return projectAssistantSegment(segment, options);
}

function projectAssistantSegment(
  segment: AssistantSegmentPlan,
  { toolExecutionsById, toolPreviewsById = {} }: BuildConversationRowsOptions,
): ConversationRow[] {
  const turn = createAssistantTurnBuilder({
    anchorKey: segment.anchorKey,
    timestamp: segment.timestamp,
  });

  for (const item of segment.items) {
    appendAssistantMessageEntries({
      item: item.item,
      message: item.message,
      turn,
      isStreaming: item.item.key === segment.streamingAssistantKey,
      runtimeActivity: segment.runtimeActivity,
      toolExecutionsById,
      toolPreviewsById,
      resolveToolResult: createToolResultResolver(item),
    });
  }

  const assistantRow = finalizeAssistantTurn(turn);
  assistantRow.isLatestAssistant = segment.isLatestAssistant;
  const rows: ConversationRow[] = [assistantRow];
  if (turn.stopReason === 'aborted') {
    rows.push(createManualAbortRow(turn));
  }
  return rows;
}

function createToolResultResolver(
  item: AssistantSegmentItem,
): (toolCallId: string) => ScoutToolResultMessage | undefined {
  const queuesByToolCallId = new Map(
    Array.from(item.pairedToolResultsByToolCallId.entries()).map(([toolCallId, queue]) => [
      toolCallId,
      [...queue],
    ]),
  );

  return (toolCallId) => queuesByToolCallId.get(toolCallId)?.shift();
}

function projectRuntimeSegment(segment: RuntimeSegmentPlan): ConversationRow[] {
  const rows: ConversationRow[] = [];
  appendRuntimeActivityRow(rows, {
    isTurnStreaming: true,
    activity: segment.activity,
    anchorKey: segment.anchorKey,
    timestamp: segment.timestamp,
  });
  const row = rows[0];
  if (row?.type === 'assistant') {
    row.isLatestAssistant = segment.isLatestAssistant;
  }
  return rows;
}

function createManualAbortRow(turn: AssistantTurnBuilder): ManualAbortConversationRow {
  return {
    type: 'manual_abort',
    key: `${turn.key}:manual-abort`,
    label: '你停止了会话',
  };
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
