// ============================================================
// Conversation Transcript Projector — transcript 行结构共享
// ============================================================

import type { ScoutBusyState } from '@scout-agent/shared';
import type { ConversationRow } from './conversation-view-model';
import {
  createConversationTranscriptRows,
  type ConversationTranscriptAddon,
  type ConversationTranscriptRow,
} from './conversation-transcript-rows';

export interface ConversationTranscriptProjector {
  project: (options: ConversationTranscriptProjectorOptions) => ConversationTranscriptRow[];
  reset: () => void;
}

interface ConversationTranscriptProjectorOptions {
  addons?: ConversationTranscriptAddon[];
  busyState: ScoutBusyState;
  rows: ConversationRow[];
}

class StructuralSharingConversationTranscriptProjector implements ConversationTranscriptProjector {
  private previousRows: ConversationTranscriptRow[] = [];

  project(options: ConversationTranscriptProjectorOptions): ConversationTranscriptRow[] {
    const nextRows = createConversationTranscriptRows(options);
    const rows = reuseTranscriptRows(this.previousRows, nextRows);
    this.previousRows = rows;
    return rows;
  }

  reset(): void {
    this.previousRows = [];
  }
}

export function createConversationTranscriptProjector(): ConversationTranscriptProjector {
  return new StructuralSharingConversationTranscriptProjector();
}

export function buildConversationTranscriptRows(
  options: ConversationTranscriptProjectorOptions,
): ConversationTranscriptRow[] {
  return createConversationTranscriptProjector().project(options);
}

function reuseTranscriptRows(
  previousRows: ConversationTranscriptRow[],
  nextRows: ConversationTranscriptRow[],
): ConversationTranscriptRow[] {
  const previousRowsByKey = new Map(previousRows.map((row) => [row.key, row]));
  let reusedAnyRow = false;
  const rows = nextRows.map((row) => {
    const previous = previousRowsByKey.get(row.key);
    if (!previous || previous.type !== row.type) return row;
    if (!canReuseTranscriptRow(previous, row)) return row;
    reusedAnyRow ||= previous !== row;
    return previous;
  });

  if (!reusedAnyRow) return nextRows;
  return rows.every((row, index) => row === previousRows[index]) &&
    rows.length === previousRows.length
    ? previousRows
    : rows;
}

function canReuseTranscriptRow(
  previous: ConversationTranscriptRow,
  next: ConversationTranscriptRow,
): boolean {
  if (previous === next) return true;
  if (previous.type !== next.type) return false;

  if (previous.type === 'extension_requests' && next.type === 'extension_requests') {
    return previous.requests === next.requests;
  }

  if (previous.type === 'runtime_status' && next.type === 'runtime_status') {
    return (
      previous.statusKind === next.statusKind &&
      previous.label === next.label &&
      previous.detail === next.detail
    );
  }

  return false;
}
