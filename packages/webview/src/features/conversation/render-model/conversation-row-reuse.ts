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
  const previousByKey = new Map(previousEntries.map((entry) => [entry.key, entry]));
  let reusedAnyEntry = false;
  const entries = nextEntries.map((entry) => {
    const previous = previousByKey.get(entry.key);
    if (!previous) return entry;
    if (
      !areRenderSignaturesEqual(
        createAssistantEntrySignature(previous),
        createAssistantEntrySignature(entry),
      )
    ) {
      return entry;
    }
    reusedAnyEntry ||= previous !== entry;
    return previous;
  });

  if (!reusedAnyEntry) return nextEntries;
  return entries.every((entry, index) => entry === previousEntries[index]) &&
    entries.length === previousEntries.length
    ? previousEntries
    : entries;
}

function reuseChangesReviews(
  previousReviews: AssistantChangesReview[],
  nextReviews: AssistantChangesReview[],
): AssistantChangesReview[] {
  if (
    areRenderSignaturesEqual(
      createAssistantChangesReviewListSignature(previousReviews),
      createAssistantChangesReviewListSignature(nextReviews),
    )
  ) {
    return previousReviews;
  }
  return nextReviews;
}

function reuseAssistantTurnSummary(
  previous: AssistantTurnSummary | undefined,
  next: AssistantTurnSummary | undefined,
): AssistantTurnSummary | undefined {
  if (
    areRenderSignaturesEqual(
      createAssistantTurnSummarySignature(previous),
      createAssistantTurnSummarySignature(next),
    )
  ) {
    return previous;
  }
  return next;
}
