// ============================================================
// Conversation Virtual Rows — 会话顶层 row 虚拟化适配
// ============================================================

import { useCallback } from 'react';
import type { RefObject } from 'react';
import { useVirtualizer, type ReactVirtualizer } from '@tanstack/react-virtual';
import type { ConversationRow } from './conversation-view-model';
import {
  CONVERSATION_VIRTUALIZATION_OVERSCAN,
  estimateConversationRowSize,
  getConversationVirtualScrollKey,
  shouldVirtualizeConversationRows,
} from './conversation-virtualization';
import type { ConversationScrollMetrics } from './use-conversation-auto-scroll';

export type ConversationRowVirtualizer = ReactVirtualizer<HTMLDivElement, HTMLDivElement>;

export interface ConversationVirtualRowsState {
  enabled: boolean;
  getScrollMetrics?: (element: HTMLElement) => ConversationScrollMetrics;
  rowVirtualizer: ConversationRowVirtualizer;
  scrollLayoutKey?: string;
  scrollToBottomOverride?: () => void;
}

interface UseConversationVirtualRowsOptions {
  isStreaming: boolean;
  rows: ConversationRow[];
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

export function useConversationVirtualRows({
  isStreaming,
  rows,
  scrollContainerRef,
}: UseConversationVirtualRowsOptions): ConversationVirtualRowsState {
  const enabled = shouldVirtualizeConversationRows(rows.length);
  const getScrollElement = useCallback(() => scrollContainerRef.current, [scrollContainerRef]);
  const estimateSize = useCallback(
    (index: number) => estimateConversationRowSize(rows[index]),
    [rows],
  );
  const getItemKey = useCallback(
    (index: number) => rows[index]?.key ?? `conversation-row:${index}`,
    [rows],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual owns imperative measurement callbacks.
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    estimateSize,
    getItemKey,
    getScrollElement,
    overscan: CONVERSATION_VIRTUALIZATION_OVERSCAN,
  });
  const totalSize = enabled ? rowVirtualizer.getTotalSize() : 0;
  const scrollLayoutKey = enabled
    ? getConversationVirtualScrollKey({
        isStreaming,
        rows,
        totalSize,
      })
    : undefined;
  const getScrollMetrics = useCallback(
    (element: HTMLElement): ConversationScrollMetrics => ({
      clientHeight: element.clientHeight,
      scrollHeight: Math.max(element.scrollHeight, rowVirtualizer.getTotalSize()),
      scrollTop: element.scrollTop,
    }),
    [rowVirtualizer],
  );
  const scrollToBottomOverride = useCallback(() => {
    if (rows.length > 0) {
      rowVirtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
    }

    const element = scrollContainerRef.current;
    if (!element) return;

    const scrollHeight = Math.max(element.scrollHeight, rowVirtualizer.getTotalSize());
    const top = Math.max(0, scrollHeight - element.clientHeight);
    if (typeof element.scrollTo === 'function') {
      element.scrollTo({ top, behavior: 'auto' });
    } else {
      element.scrollTop = top;
    }
  }, [rowVirtualizer, rows.length, scrollContainerRef]);

  return {
    enabled,
    getScrollMetrics: enabled ? getScrollMetrics : undefined,
    rowVirtualizer,
    scrollLayoutKey,
    scrollToBottomOverride: enabled ? scrollToBottomOverride : undefined,
  };
}
