// ============================================================
// Conversation Row Reuse — 投影行结构共享
// ============================================================

import type {
  AssistantChangesReview,
  AssistantConversationRow,
  AssistantTurnEntry,
  AssistantTurnSummary,
  ConversationRow,
} from './conversation-row-types';
import {
  areRenderSignaturesEqual,
  createAssistantChangesReviewListSignature,
  createAssistantEntrySignature,
  createAssistantRowSignature,
  createAssistantTurnSummarySignature,
} from './conversation-render-signature';
import { reuseListByKey, reuseListByIndex, reuseOptional } from './structural-sharing';

export function reuseProjectedRows(
  previousRows: ConversationRow[],
  nextRows: ConversationRow[],
): ConversationRow[] {
  const previousRowsByKey = new Map(previousRows.map((row) => [row.key, row]));
  let reusedAnyRow = false;
  const rows = nextRows.map((row) => {
    const previous = previousRowsByKey.get(row.key);
    if (!previous || previous.type !== row.type) return row;
    if (row.type !== 'assistant' || previous.type !== 'assistant') return row;

    const reused = reuseAssistantRow(previous, row);
    reusedAnyRow ||= reused !== row;
    return reused;
  });

  if (!reusedAnyRow) return nextRows;
  return rows.every((row, index) => row === previousRows[index]) &&
    rows.length === previousRows.length
    ? previousRows
    : rows;
}

function reuseAssistantRow(
  previous: AssistantConversationRow,
  next: AssistantConversationRow,
): AssistantConversationRow {
  const entries = reuseAssistantEntries(previous.entries, next.entries);
  const changesReviews = reuseChangesReviews(previous.changesReviews, next.changesReviews);
  const turnSummary = reuseAssistantTurnSummary(previous.turnSummary, next.turnSummary);
  const normalizedNext =
    entries === next.entries &&
    changesReviews === next.changesReviews &&
    turnSummary === next.turnSummary
      ? next
      : {
          ...next,
          entries,
          changesReviews,
          turnSummary,
        };

  if (
    areRenderSignaturesEqual(
      createAssistantRowSignature(previous),
      createAssistantRowSignature(normalizedNext),
    )
  ) {
    return previous;
  }

  return normalizedNext;
}

function reuseAssistantEntries(
  previousEntries: AssistantTurnEntry[],
  nextEntries: AssistantTurnEntry[],
): AssistantTurnEntry[] {
  return reuseListByKey({
    previous: previousEntries,
    next: nextEntries,
    getKey: (entry) => entry.key,
    canReuse: (previous, next) =>
      areRenderSignaturesEqual(
        createAssistantEntrySignature(previous),
        createAssistantEntrySignature(next),
      ),
  });
}

function reuseChangesReviews(
  previousReviews: AssistantChangesReview[],
  nextReviews: AssistantChangesReview[],
): AssistantChangesReview[] {
  return reuseListByIndex({
    previous: previousReviews,
    next: nextReviews,
    canReuse: (previous, next) =>
      areRenderSignaturesEqual(
        createAssistantChangesReviewListSignature([previous]),
        createAssistantChangesReviewListSignature([next]),
      ),
  });
}

function reuseAssistantTurnSummary(
  previous: AssistantTurnSummary | undefined,
  next: AssistantTurnSummary | undefined,
): AssistantTurnSummary | undefined {
  return reuseOptional(previous, next, (previousSummary, nextSummary) =>
    areRenderSignaturesEqual(
      createAssistantTurnSummarySignature(previousSummary),
      createAssistantTurnSummarySignature(nextSummary),
    ),
  );
}
