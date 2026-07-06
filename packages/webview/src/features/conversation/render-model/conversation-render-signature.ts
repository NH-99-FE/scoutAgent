// ============================================================
// Conversation Render Signature — 展示模型结构共享签名
// ============================================================

import type {
  AssistantChangesReview,
  AssistantContentEntry,
  AssistantConversationRow,
  AssistantProcessActivity,
  AssistantProcessActivitySummary,
  AssistantProcessEntry,
  AssistantProcessPhase,
  AssistantProcessSummary,
  AssistantTurnEntry,
  AssistantTurnSummary,
  AssistantVisibleContent,
} from './conversation-row-types';

export type RenderSignature = readonly unknown[];

type SignatureSink = unknown[];
type SignatureBuilder<T> = (value: T, sink: SignatureSink) => void;

type AssistantEntrySignatureBuilders = {
  [Type in AssistantTurnEntry['type']]: SignatureBuilder<
    Extract<AssistantTurnEntry, { type: Type }>
  >;
};

type AssistantActivitySignatureBuilders = {
  [Type in AssistantProcessActivity['type']]: SignatureBuilder<
    Extract<AssistantProcessActivity, { type: Type }>
  >;
};

const ASSISTANT_ENTRY_SIGNATURE_BUILDERS: AssistantEntrySignatureBuilders = {
  content: appendContentEntrySignature,
  process: appendProcessEntrySignature,
};

const ASSISTANT_ACTIVITY_SIGNATURE_BUILDERS: AssistantActivitySignatureBuilders = {
  status: appendStatusActivitySignature,
  thinking: appendThinkingActivitySignature,
  tool: appendToolActivitySignature,
};

export function createAssistantRowSignature(row: AssistantConversationRow): RenderSignature {
  return createRenderSignature(row, appendAssistantRowSignature);
}

export function createAssistantEntrySignature(entry: AssistantTurnEntry): RenderSignature {
  return createRenderSignature(entry, appendAssistantEntrySignature);
}

export function createAssistantChangesReviewListSignature(
  reviews: AssistantChangesReview[],
): RenderSignature {
  return createRenderSignature(reviews, appendChangesReviewListSignature);
}

export function createAssistantTurnSummarySignature(
  summary: AssistantTurnSummary | undefined,
): RenderSignature {
  return createRenderSignature(summary, appendOptionalTurnSummarySignature);
}

export function areRenderSignaturesEqual(
  previous: RenderSignature,
  next: RenderSignature,
): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((value, index) => Object.is(value, next[index]));
}

function createRenderSignature<T>(value: T, builder: SignatureBuilder<T>): RenderSignature {
  const signature: SignatureSink = [];
  builder(value, signature);
  return signature;
}

function appendAssistantRowSignature(row: AssistantConversationRow, sink: SignatureSink): void {
  sink.push(
    row.type,
    row.key,
    row.actionText,
    row.timestamp,
    row.isLatestAssistant,
    row.isStreaming,
  );
  appendOptionalTurnSummarySignature(row.turnSummary, sink);
  appendChangesReviewListSignature(row.changesReviews, sink);
  appendList(row.entries, sink, appendAssistantEntrySignature);
}

function appendAssistantEntrySignature(entry: AssistantTurnEntry, sink: SignatureSink): void {
  sink.push(entry.type, entry.key);
  if (entry.type === 'content') {
    ASSISTANT_ENTRY_SIGNATURE_BUILDERS.content(entry, sink);
    return;
  }
  ASSISTANT_ENTRY_SIGNATURE_BUILDERS.process(entry, sink);
}

function appendContentEntrySignature(entry: AssistantContentEntry, sink: SignatureSink): void {
  sink.push(entry.timestamp);
  appendList(entry.blocks, sink, appendVisibleContentSignature);
}

function appendVisibleContentSignature(
  content: AssistantVisibleContent,
  sink: SignatureSink,
): void {
  sink.push(content.type);
  if (content.type === 'text') {
    sink.push(content.text);
    return;
  }
  sink.push(content.mimeType, content.data);
}

function appendProcessEntrySignature(entry: AssistantProcessEntry, sink: SignatureSink): void {
  sink.push(entry.lifecycle, entry.displayMode, entry.defaultOpen);
  appendProcessSummarySignature(entry.summary, sink);
  appendActivitySummarySignature(entry.activitySummary, sink);
  appendList(entry.phases, sink, appendProcessPhaseSignature);
}

function appendProcessSummarySignature(
  summary: AssistantProcessSummary,
  sink: SignatureSink,
): void {
  sink.push(summary.status, summary.label, summary.running, summary.tone);
}

function appendActivitySummarySignature(
  summary: AssistantProcessActivitySummary,
  sink: SignatureSink,
): void {
  sink.push(summary.mixed, summary.totalCount);
  appendOptional(summary.primary, sink, appendActivitySummaryItemSignature);
  appendList(summary.items, sink, appendActivitySummaryItemSignature);
}

function appendActivitySummaryItemSignature(
  item: AssistantProcessActivitySummary['items'][number],
  sink: SignatureSink,
): void {
  sink.push(item.key, item.icon, item.label, item.count);
}

function appendProcessPhaseSignature(phase: AssistantProcessPhase, sink: SignatureSink): void {
  sink.push(phase.key, phase.kind);
  appendList(phase.activities, sink, appendProcessActivitySignature);
}

function appendProcessActivitySignature(
  activity: AssistantProcessActivity,
  sink: SignatureSink,
): void {
  sink.push(activity.type, activity.key);
  if (activity.type === 'status') {
    ASSISTANT_ACTIVITY_SIGNATURE_BUILDERS.status(activity, sink);
    return;
  }
  if (activity.type === 'thinking') {
    ASSISTANT_ACTIVITY_SIGNATURE_BUILDERS.thinking(activity, sink);
    return;
  }
  ASSISTANT_ACTIVITY_SIGNATURE_BUILDERS.tool(activity, sink);
}

function appendStatusActivitySignature(
  activity: Extract<AssistantProcessActivity, { type: 'status' }>,
  sink: SignatureSink,
): void {
  sink.push(activity.text, activity.tone, activity.running);
}

function appendThinkingActivitySignature(
  activity: Extract<AssistantProcessActivity, { type: 'thinking' }>,
  sink: SignatureSink,
): void {
  sink.push(
    activity.isStreaming,
    activity.messageKey,
    activity.content.thinking,
    activity.content.redacted,
  );
}

function appendToolActivitySignature(
  activity: Extract<AssistantProcessActivity, { type: 'tool' }>,
  sink: SignatureSink,
): void {
  appendToolCallSignature(activity.toolCall, sink);
  // runtime/preview/toolResult 是展示态的临时 owner，引用变化即表示对应过程块需要失效。
  sink.push(activity.runtime, activity.preview, activity.toolResult);
  appendStableValue(activity.display, sink);
}

function appendToolCallSignature(
  toolCall: Extract<AssistantProcessActivity, { type: 'tool' }>['toolCall'],
  sink: SignatureSink,
): void {
  sink.push(toolCall.id, toolCall.name);
  appendStableValue(toolCall.arguments, sink);
  appendStableValue(toolCall.displayArguments, sink);
}

function appendChangesReviewListSignature(
  reviews: AssistantChangesReview[],
  sink: SignatureSink,
): void {
  appendList(reviews, sink, appendChangesReviewSignature);
}

function appendChangesReviewSignature(review: AssistantChangesReview, sink: SignatureSink): void {
  sink.push(review.key, review.turnId, review.fileCount, review.additions, review.deletions);
  appendList(review.files, sink, (file, fileSink) => {
    fileSink.push(file.path, file.displayPath, file.additions, file.deletions);
  });
}

function appendOptionalTurnSummarySignature(
  summary: AssistantTurnSummary | undefined,
  sink: SignatureSink,
): void {
  appendOptional(summary, sink, (value, valueSink) => {
    valueSink.push(value.status, value.label, value.running, value.tone);
  });
}

function appendOptional<T>(
  value: T | undefined,
  sink: SignatureSink,
  builder: SignatureBuilder<T>,
): void {
  if (value === undefined) {
    sink.push('none');
    return;
  }
  sink.push('some');
  builder(value, sink);
}

function appendList<T>(
  values: readonly T[],
  sink: SignatureSink,
  builder: SignatureBuilder<T>,
): void {
  sink.push(values.length);
  values.forEach((value) => builder(value, sink));
}

function appendStableValue(value: unknown, sink: SignatureSink): void {
  if (value === null || value === undefined || typeof value !== 'object') {
    sink.push(value);
    return;
  }

  if (Array.isArray(value)) {
    sink.push('array', value.length);
    value.forEach((item) => appendStableValue(item, sink));
    return;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  sink.push('object', keys.length);
  keys.forEach((key) => {
    sink.push(key);
    appendStableValue(record[key], sink);
  });
}
