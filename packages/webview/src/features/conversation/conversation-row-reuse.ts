// ============================================================
// Conversation Row Reuse — 投影行结构共享
// ============================================================

import type { ScoutAssistantMessage } from '@scout-agent/shared';
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
  ConversationRow,
} from './conversation-row-types';

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

  if (
    entries === previous.entries &&
    changesReviews === previous.changesReviews &&
    turnSummary === previous.turnSummary &&
    previous.actionText === next.actionText &&
    previous.timestamp === next.timestamp &&
    previous.isLatestAssistant === next.isLatestAssistant &&
    previous.isStreaming === next.isStreaming
  ) {
    return previous;
  }

  if (
    entries === next.entries &&
    changesReviews === next.changesReviews &&
    turnSummary === next.turnSummary
  ) {
    return next;
  }

  return {
    ...next,
    entries,
    changesReviews,
    turnSummary,
  };
}

function reuseAssistantEntries(
  previousEntries: AssistantTurnEntry[],
  nextEntries: AssistantTurnEntry[],
): AssistantTurnEntry[] {
  const previousByKey = new Map(previousEntries.map((entry) => [entry.key, entry]));
  let reusedAnyEntry = false;
  const entries = nextEntries.map((entry) => {
    const previous = previousByKey.get(entry.key);
    if (!previous || !areAssistantEntriesEqual(previous, entry)) return entry;
    reusedAnyEntry ||= previous !== entry;
    return previous;
  });

  if (!reusedAnyEntry) return nextEntries;
  return entries.every((entry, index) => entry === previousEntries[index]) &&
    entries.length === previousEntries.length
    ? previousEntries
    : entries;
}

function areAssistantEntriesEqual(previous: AssistantTurnEntry, next: AssistantTurnEntry): boolean {
  if (previous.type !== next.type || previous.key !== next.key) return false;
  if (previous.type === 'content' && next.type === 'content') {
    return areAssistantContentEntriesEqual(previous, next);
  }
  if (previous.type === 'process' && next.type === 'process') {
    return areAssistantProcessEntriesEqual(previous, next);
  }
  return false;
}

function areAssistantContentEntriesEqual(
  previous: AssistantContentEntry,
  next: AssistantContentEntry,
): boolean {
  return (
    previous.timestamp === next.timestamp &&
    areAssistantVisibleContentArraysEqual(previous.blocks, next.blocks)
  );
}

function areAssistantProcessEntriesEqual(
  previous: AssistantProcessEntry,
  next: AssistantProcessEntry,
): boolean {
  return (
    previous.lifecycle === next.lifecycle &&
    previous.displayMode === next.displayMode &&
    previous.defaultOpen === next.defaultOpen &&
    areProcessSummariesEqual(previous.summary, next.summary) &&
    areActivitySummariesEqual(previous.activitySummary, next.activitySummary) &&
    areProcessPhasesEqual(previous.phases, next.phases)
  );
}

function reuseChangesReviews(
  previousReviews: AssistantChangesReview[],
  nextReviews: AssistantChangesReview[],
): AssistantChangesReview[] {
  if (!areChangesReviewsEqual(previousReviews, nextReviews)) return nextReviews;
  return previousReviews;
}

function reuseAssistantTurnSummary(
  previous: AssistantTurnSummary | undefined,
  next: AssistantTurnSummary | undefined,
): AssistantTurnSummary | undefined {
  if (!previous || !next) return next;
  return areTurnSummariesEqual(previous, next) ? previous : next;
}

function areAssistantVisibleContentArraysEqual(
  previous: AssistantVisibleContent[],
  next: AssistantVisibleContent[],
): boolean {
  return (
    previous.length === next.length &&
    previous.every((content, index) => areAssistantVisibleContentEqual(content, next[index]))
  );
}

function areAssistantVisibleContentEqual(
  previous: AssistantVisibleContent,
  next: AssistantVisibleContent,
): boolean {
  if (Object.is(previous, next)) return true;
  if (previous.type !== next.type) return false;
  if (previous.type === 'text' && next.type === 'text') return previous.text === next.text;
  if (previous.type === 'image' && next.type === 'image') {
    return previous.data === next.data && previous.mimeType === next.mimeType;
  }
  return false;
}

function areProcessSummariesEqual(
  previous: AssistantProcessSummary,
  next: AssistantProcessSummary,
): boolean {
  return (
    previous.status === next.status &&
    previous.label === next.label &&
    previous.running === next.running &&
    previous.tone === next.tone
  );
}

function areActivitySummariesEqual(
  previous: AssistantProcessActivitySummary,
  next: AssistantProcessActivitySummary,
): boolean {
  return (
    previous.mixed === next.mixed &&
    previous.totalCount === next.totalCount &&
    areActivitySummaryItemsEqual(previous.items, next.items) &&
    areOptionalActivitySummaryItemEqual(previous.primary, next.primary)
  );
}

function areActivitySummaryItemsEqual(
  previous: AssistantProcessActivitySummary['items'],
  next: AssistantProcessActivitySummary['items'],
): boolean {
  return (
    previous.length === next.length &&
    previous.every((item, index) => areOptionalActivitySummaryItemEqual(item, next[index]))
  );
}

function areOptionalActivitySummaryItemEqual(
  previous: AssistantProcessActivitySummary['items'][number] | undefined,
  next: AssistantProcessActivitySummary['items'][number] | undefined,
): boolean {
  if (!previous || !next) return previous === next;
  return (
    previous.key === next.key &&
    previous.icon === next.icon &&
    previous.label === next.label &&
    previous.count === next.count
  );
}

function areProcessPhasesEqual(
  previous: AssistantProcessPhase[],
  next: AssistantProcessPhase[],
): boolean {
  return (
    previous.length === next.length &&
    previous.every((phase, index) => {
      const nextPhase = next[index];
      return (
        phase.key === nextPhase.key &&
        phase.kind === nextPhase.kind &&
        areProcessActivitiesEqual(phase.activities, nextPhase.activities)
      );
    })
  );
}

function areProcessActivitiesEqual(
  previous: AssistantProcessActivity[],
  next: AssistantProcessActivity[],
): boolean {
  return (
    previous.length === next.length &&
    previous.every((activity, index) => areProcessActivityEqual(activity, next[index]))
  );
}

function areProcessActivityEqual(
  previous: AssistantProcessActivity,
  next: AssistantProcessActivity,
): boolean {
  if (previous.type !== next.type || previous.key !== next.key) return false;
  if (previous.type === 'status' && next.type === 'status') {
    return (
      previous.text === next.text &&
      previous.tone === next.tone &&
      previous.running === next.running
    );
  }
  if (previous.type === 'thinking' && next.type === 'thinking') {
    return (
      previous.isStreaming === next.isStreaming &&
      previous.messageKey === next.messageKey &&
      previous.content.thinking === next.content.thinking &&
      previous.content.redacted === next.content.redacted
    );
  }
  if (previous.type === 'tool' && next.type === 'tool') {
    return (
      areToolCallsEqual(previous.toolCall, next.toolCall) &&
      previous.runtime === next.runtime &&
      previous.preview === next.preview &&
      previous.toolResult === next.toolResult &&
      areJsonLikeValuesEqual(previous.display, next.display)
    );
  }
  return false;
}

function areToolCallsEqual(
  previous: Extract<ScoutAssistantMessage['content'][number], { type: 'toolCall' }>,
  next: Extract<ScoutAssistantMessage['content'][number], { type: 'toolCall' }>,
): boolean {
  return (
    previous.id === next.id &&
    previous.name === next.name &&
    areJsonLikeValuesEqual(previous.arguments, next.arguments) &&
    areJsonLikeValuesEqual(previous.displayArguments, next.displayArguments)
  );
}

function areChangesReviewsEqual(
  previous: AssistantChangesReview[],
  next: AssistantChangesReview[],
): boolean {
  return (
    previous.length === next.length &&
    previous.every((review, index) => areChangeReviewsEqual(review, next[index]))
  );
}

function areChangeReviewsEqual(
  previous: AssistantChangesReview,
  next: AssistantChangesReview,
): boolean {
  return (
    previous.key === next.key &&
    previous.turnId === next.turnId &&
    previous.fileCount === next.fileCount &&
    previous.additions === next.additions &&
    previous.deletions === next.deletions &&
    areChangeReviewFilesEqual(previous.files, next.files)
  );
}

function areChangeReviewFilesEqual(
  previous: AssistantChangesReview['files'],
  next: AssistantChangesReview['files'],
): boolean {
  return (
    previous.length === next.length &&
    previous.every((file, index) => {
      const nextFile = next[index];
      return (
        file.path === nextFile.path &&
        file.displayPath === nextFile.displayPath &&
        file.additions === nextFile.additions &&
        file.deletions === nextFile.deletions
      );
    })
  );
}

function areTurnSummariesEqual(
  previous: AssistantTurnSummary,
  next: AssistantTurnSummary,
): boolean {
  return (
    previous.status === next.status &&
    previous.label === next.label &&
    previous.running === next.running &&
    previous.tone === next.tone
  );
}

function areJsonLikeValuesEqual(previous: unknown, next: unknown): boolean {
  if (Object.is(previous, next)) return true;
  if (!isRecordLike(previous) || !isRecordLike(next)) return false;

  if (Array.isArray(previous) || Array.isArray(next)) {
    if (!Array.isArray(previous) || !Array.isArray(next)) return false;
    return (
      previous.length === next.length &&
      previous.every((value, index) => areJsonLikeValuesEqual(value, next[index]))
    );
  }

  const previousEntries = Object.entries(previous);
  const nextKeys = new Set(Object.keys(next));
  if (previousEntries.length !== nextKeys.size) return false;

  return previousEntries.every(([key, value]) => {
    if (!nextKeys.has(key)) return false;
    return areJsonLikeValuesEqual(value, next[key]);
  });
}

function isRecordLike(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === 'object' && value !== null;
}
