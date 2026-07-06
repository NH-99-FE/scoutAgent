// ============================================================
// Conversation Transcript Projector — transcript 投影流水线与结构共享
// ============================================================

import {
  createConversationRowsProjector,
  type BuildConversationRowsOptions,
} from './conversation-view-model';
import {
  createConversationTranscriptRows,
  type ConversationTranscriptAddon,
  type ConversationTranscriptRow,
} from './conversation-transcript-rows';
import { reuseListByKey } from './structural-sharing';

export interface ConversationTranscriptProjector {
  project: (options: ConversationTranscriptProjectorOptions) => ConversationTranscriptRow[];
  reset: () => void;
}

export interface ConversationTranscriptProjectorOptions extends BuildConversationRowsOptions {
  transcriptAddons: ConversationTranscriptAddon[];
}

const EMPTY_TOOL_PREVIEWS: NonNullable<BuildConversationRowsOptions['toolPreviewsById']> = {};

class StructuralSharingConversationTranscriptProjector implements ConversationTranscriptProjector {
  private readonly rowsProjector = createConversationRowsProjector();
  private previousRows: ConversationTranscriptRow[] = [];

  project({
    busyState,
    items,
    isStreaming,
    toolExecutionsById,
    toolPreviewsById = EMPTY_TOOL_PREVIEWS,
    transcriptAddons,
  }: ConversationTranscriptProjectorOptions): ConversationTranscriptRow[] {
    const baseRows = this.rowsProjector.project({
      items,
      isStreaming,
      busyState,
      toolExecutionsById,
      toolPreviewsById,
    });
    const nextRows = createConversationTranscriptRows({
      addons: transcriptAddons,
      busyState,
      rows: baseRows,
    });
    const rows = reuseTranscriptRows(this.previousRows, nextRows);
    this.previousRows = rows;
    return rows;
  }

  reset(): void {
    this.rowsProjector.reset();
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
  return reuseListByKey({
    previous: previousRows,
    next: nextRows,
    getKey: (row) => row.key,
    canReuse: canReuseTranscriptRow,
  });
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
