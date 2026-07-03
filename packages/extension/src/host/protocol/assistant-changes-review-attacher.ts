// ============================================================
// Assistant changes review attacher — assistant 消息审查摘要装饰器
// 负责：根据 tool result 的 file_change details，把 host 生成的 review summary
//      贴回拥有该 tool call 的 assistant message。
// ============================================================

import type {
  ScoutAssistantMessage,
  ScoutChangesReviewSummary,
  ScoutFileChangeDetails,
  ScoutMessage,
} from '@scout-agent/shared';

// ---------- 类型 ----------

export type ResolveChangesReviewSummary = (turnId: string) => ScoutChangesReviewSummary | undefined;

export interface AssistantChangesReviewAttachOptions {
  resolveChangesReviewSummary?: ResolveChangesReviewSummary;
}

interface AssistantTurnOccurrence {
  turnId: string;
  order: number;
}

interface PendingToolCallOwner {
  assistant: ScoutAssistantMessage;
}

// ---------- Attacher ----------

export function attachAssistantChangesReviews(
  messages: readonly ScoutMessage[],
  options: AssistantChangesReviewAttachOptions = {},
): ScoutMessage[] {
  const resolveChangesReviewSummary = options.resolveChangesReviewSummary;
  if (!resolveChangesReviewSummary) return messages as ScoutMessage[];

  const occurrencesByAssistant = collectReviewOccurrences(messages);
  if (occurrencesByAssistant.size === 0) return messages as ScoutMessage[];

  let changed = false;
  const nextMessages = messages.map((message) => {
    if (message.role !== 'assistant') return message;
    const occurrences = occurrencesByAssistant.get(message);
    if (!occurrences?.length) return message;
    const changesReviews = resolveAssistantReviewSummaries(
      occurrences,
      resolveChangesReviewSummary,
    );
    if (changesReviews.length === 0) return message;
    changed = true;
    return { ...message, changesReviews };
  });

  return changed ? nextMessages : (messages as ScoutMessage[]);
}

function collectReviewOccurrences(
  messages: readonly ScoutMessage[],
): Map<ScoutAssistantMessage, AssistantTurnOccurrence[]> {
  const pendingToolCalls = new Map<string, PendingToolCallOwner>();
  const occurrencesByAssistant = new Map<ScoutAssistantMessage, AssistantTurnOccurrence[]>();

  for (const [order, message] of messages.entries()) {
    if (message.role === 'user') {
      pendingToolCalls.clear();
      continue;
    }

    if (message.role === 'assistant') {
      for (const toolCallId of getAssistantToolCallIds(message)) {
        pendingToolCalls.set(toolCallId, { assistant: message });
      }
      continue;
    }

    if (message.role !== 'toolResult') continue;
    const owner = pendingToolCalls.get(message.toolCallId);
    if (!owner || !isScoutFileChangeDetails(message.details)) continue;

    const occurrences = occurrencesByAssistant.get(owner.assistant) ?? [];
    occurrences.push({ turnId: message.details.review.turnId, order });
    occurrencesByAssistant.set(owner.assistant, occurrences);
  }

  return occurrencesByAssistant;
}

function getAssistantToolCallIds(message: ScoutAssistantMessage): string[] {
  return message.content.flatMap((content) => (content.type === 'toolCall' ? [content.id] : []));
}

function resolveAssistantReviewSummaries(
  occurrences: readonly AssistantTurnOccurrence[],
  resolveChangesReviewSummary: ResolveChangesReviewSummary,
): ScoutChangesReviewSummary[] {
  const latestOrderByTurnId = new Map<string, number>();
  for (const occurrence of occurrences) {
    latestOrderByTurnId.set(
      occurrence.turnId,
      Math.max(latestOrderByTurnId.get(occurrence.turnId) ?? -1, occurrence.order),
    );
  }

  return Array.from(latestOrderByTurnId.entries())
    .sort((left, right) => right[1] - left[1])
    .flatMap(([turnId]) => {
      const summary = resolveChangesReviewSummary(turnId);
      return summary ? [summary] : [];
    });
}

function isScoutFileChangeDetails(value: unknown): value is ScoutFileChangeDetails {
  if (!value || typeof value !== 'object') return false;
  const details = value as Partial<ScoutFileChangeDetails>;
  return (
    details.kind === 'file_change' &&
    typeof details.path === 'string' &&
    typeof details.additions === 'number' &&
    typeof details.deletions === 'number' &&
    Boolean(details.review) &&
    typeof details.review?.turnId === 'string' &&
    typeof details.review?.recordId === 'string'
  );
}
