// ============================================================
// Conversation View Projector — 会话视图投影流水线
// ============================================================

import type { ScoutBusyState } from '@scout-agent/shared';
import type { ToolCallPreviewState, ToolExecutionState } from '@/store/conversation-store';
import {
  createConversationRowsProjector,
  type ConversationViewItem,
} from './conversation-view-model';
import { createConversationTranscriptProjector } from './conversation-transcript-projector';
import type {
  ConversationTranscriptAddon,
  ConversationTranscriptRow,
} from './conversation-transcript-rows';

export interface ConversationViewProjector {
  project: (options: ConversationViewProjectorOptions) => ConversationTranscriptRow[];
}

export interface ConversationViewProjectorOptions {
  busyState: ScoutBusyState;
  items: ConversationViewItem[];
  isStreaming: boolean;
  toolExecutionsById: Record<string, ToolExecutionState>;
  toolPreviewsById: Record<string, ToolCallPreviewState>;
  transcriptAddons: ConversationTranscriptAddon[];
}

export function createConversationViewProjector(): ConversationViewProjector {
  const rowsProjector = createConversationRowsProjector();
  const transcriptProjector = createConversationTranscriptProjector();

  return {
    project({
      busyState,
      items,
      isStreaming,
      toolExecutionsById,
      toolPreviewsById,
      transcriptAddons,
    }) {
      const rows = rowsProjector.project({
        items,
        isStreaming,
        busyState,
        toolExecutionsById,
        toolPreviewsById,
      });
      return transcriptProjector.project({
        addons: transcriptAddons,
        busyState,
        rows,
      });
    },
  };
}
