// ============================================================
// Conversation View — 会话 transcript 组装入口
// ============================================================

import { useMemo } from 'react';
import type { ScoutBusyState } from '@scout-agent/shared';
import { getConversationExpansionScope } from '@/store/conversation-expansion-store';
import type { ToolCallPreviewState, ToolExecutionState } from '@/store/conversation-store';
import { ConversationScroller } from './ConversationScroller';
import { ConversationTranscript } from './ConversationTranscript';
import type { ConversationViewItem } from '../render-model/conversation-view-model';
import { createConversationViewProjector } from '../render-model/conversation-view-projector';
import type { ConversationTranscriptAddon } from '../render-model/conversation-transcript-rows';

interface ConversationViewProps {
  busyState: ScoutBusyState;
  expansionScope?: string;
  items: ConversationViewItem[];
  isStreaming: boolean;
  toolExecutionsById: Record<string, ToolExecutionState>;
  toolPreviewsById?: Record<string, ToolCallPreviewState>;
  className?: string;
  showScrollToBottomButton?: boolean;
  transcriptAddons?: ConversationTranscriptAddon[];
}

const EMPTY_TOOL_PREVIEWS: Record<string, ToolCallPreviewState> = {};
const EMPTY_TRANSCRIPT_ADDONS: ConversationTranscriptAddon[] = [];

export function ConversationView({
  busyState,
  expansionScope = getConversationExpansionScope({}),
  items,
  isStreaming,
  toolExecutionsById,
  toolPreviewsById = EMPTY_TOOL_PREVIEWS,
  className,
  showScrollToBottomButton = false,
  transcriptAddons = EMPTY_TRANSCRIPT_ADDONS,
}: ConversationViewProps) {
  const projector = useMemo(() => createConversationViewProjector(), []);
  const transcriptRows = useMemo(
    () =>
      projector.project({
        items,
        isStreaming,
        busyState,
        toolExecutionsById,
        toolPreviewsById,
        transcriptAddons,
      }),
    [
      projector,
      items,
      isStreaming,
      busyState,
      toolExecutionsById,
      toolPreviewsById,
      transcriptAddons,
    ],
  );

  // 发送消息不隐式滚底；用户可用一键到底，已在底部时由 autoScroll 自然跟随。
  return (
    <ConversationScroller className={className} showScrollToBottomButton={showScrollToBottomButton}>
      <ConversationTranscript
        expansionScope={expansionScope}
        isStreaming={isStreaming}
        rows={transcriptRows}
      />
    </ConversationScroller>
  );
}
