// ============================================================
// Tree Virtual Rows — 会话树固定行高虚拟窗口
// ============================================================

import { useCallback, useMemo, useSyncExternalStore } from 'react';

const EMPTY_SCROLL_METRICS_SNAPSHOT = '0|0';

interface ScrollMetrics {
  scrollTop: number;
  viewportHeight: number;
}

interface TreeVirtualRowsOptions {
  fallbackRowCount: number;
  itemCount: number;
  overscan: number;
  paddingEnd?: number;
  paddingStart?: number;
  rowHeight: number;
  scrollElement: HTMLElement | null;
}

interface TreeVirtualRange {
  endIndex: number;
  startIndex: number;
  totalHeight: number;
}

interface TreeVirtualRow {
  index: number;
  offsetTop: number;
}

export function useTreeVirtualRows({
  fallbackRowCount,
  itemCount,
  overscan,
  paddingEnd = 0,
  paddingStart = 0,
  rowHeight,
  scrollElement,
}: TreeVirtualRowsOptions): {
  rows: TreeVirtualRow[];
  scrollToIndex: (index: number) => void;
  totalHeight: number;
} {
  const safeFallbackRowCount = Math.max(1, fallbackRowCount);
  const safeOverscan = Math.max(0, overscan);
  const safePaddingEnd = Math.max(0, paddingEnd);
  const safePaddingStart = Math.max(0, paddingStart);
  const safeRowHeight = Math.max(1, rowHeight);
  const subscribeToScrollMetrics = useCallback(
    (onStoreChange: () => void) => {
      if (!scrollElement) return () => undefined;

      scrollElement.addEventListener('scroll', onStoreChange, { passive: true });

      let resizeObserver: ResizeObserver | undefined;
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(onStoreChange);
        resizeObserver.observe(scrollElement);
      }

      return () => {
        scrollElement.removeEventListener('scroll', onStoreChange);
        resizeObserver?.disconnect();
      };
    },
    [scrollElement],
  );
  const getScrollMetricsSnapshot = useCallback(() => {
    if (!scrollElement) return EMPTY_SCROLL_METRICS_SNAPSHOT;
    return `${scrollElement.scrollTop}|${scrollElement.clientHeight}`;
  }, [scrollElement]);
  const scrollMetricsSnapshot = useSyncExternalStore(
    subscribeToScrollMetrics,
    getScrollMetricsSnapshot,
    getEmptyScrollMetricsSnapshot,
  );
  const metrics = useMemo(
    () => parseScrollMetricsSnapshot(scrollMetricsSnapshot),
    [scrollMetricsSnapshot],
  );
  const range = useMemo(
    () =>
      getTreeVirtualRange({
        fallbackRowCount: safeFallbackRowCount,
        itemCount,
        metrics,
        overscan: safeOverscan,
        paddingEnd: safePaddingEnd,
        paddingStart: safePaddingStart,
        rowHeight: safeRowHeight,
      }),
    [
      itemCount,
      metrics,
      safeFallbackRowCount,
      safeOverscan,
      safePaddingEnd,
      safePaddingStart,
      safeRowHeight,
    ],
  );
  const rows = useMemo(() => {
    const nextRows: TreeVirtualRow[] = [];
    for (let index = range.startIndex; index < range.endIndex; index += 1) {
      nextRows.push({ index, offsetTop: safePaddingStart + index * safeRowHeight });
    }
    return nextRows;
  }, [range.endIndex, range.startIndex, safePaddingStart, safeRowHeight]);

  const scrollToIndex = useCallback(
    (index: number) => {
      if (!scrollElement || index < 0 || index >= itemCount) return;
      const viewportHeight = scrollElement.clientHeight;
      if (viewportHeight <= 0) return;

      const rowTop = safePaddingStart + index * safeRowHeight;
      const rowBottom = rowTop + safeRowHeight;
      const currentTop = scrollElement.scrollTop;
      const currentBottom = currentTop + viewportHeight;
      let nextTop = currentTop;

      if (rowTop < currentTop) {
        nextTop = rowTop;
      } else if (rowBottom > currentBottom) {
        nextTop = rowBottom - viewportHeight;
      }

      const maxScrollTop = Math.max(
        0,
        safePaddingStart + itemCount * safeRowHeight + safePaddingEnd - viewportHeight,
      );
      const boundedTop = Math.min(Math.max(0, nextTop), maxScrollTop);
      if (boundedTop === currentTop) return;

      scrollElement.scrollTo({ top: boundedTop });
      scrollElement.dispatchEvent(new Event('scroll'));
    },
    [itemCount, safePaddingEnd, safePaddingStart, safeRowHeight, scrollElement],
  );

  return { rows, scrollToIndex, totalHeight: range.totalHeight };
}

function getEmptyScrollMetricsSnapshot(): string {
  return EMPTY_SCROLL_METRICS_SNAPSHOT;
}

function parseScrollMetricsSnapshot(snapshot: string): ScrollMetrics {
  const [scrollTop, viewportHeight] = snapshot.split('|').map(Number);
  return {
    scrollTop: Number.isFinite(scrollTop) ? scrollTop : 0,
    viewportHeight: Number.isFinite(viewportHeight) ? viewportHeight : 0,
  };
}

function getTreeVirtualRange({
  fallbackRowCount,
  itemCount,
  metrics,
  overscan,
  paddingEnd,
  paddingStart,
  rowHeight,
}: {
  fallbackRowCount: number;
  itemCount: number;
  metrics: ScrollMetrics;
  overscan: number;
  paddingEnd: number;
  paddingStart: number;
  rowHeight: number;
}): TreeVirtualRange {
  const totalHeight = paddingStart + itemCount * rowHeight + paddingEnd;
  if (itemCount === 0) {
    return { endIndex: 0, startIndex: 0, totalHeight };
  }

  const viewportRows =
    metrics.viewportHeight > 0 ? Math.ceil(metrics.viewportHeight / rowHeight) : fallbackRowCount;
  const maxFirstVisibleIndex = Math.max(0, itemCount - viewportRows);
  const firstVisibleIndex = Math.min(
    Math.max(0, Math.floor((metrics.scrollTop - paddingStart) / rowHeight)),
    maxFirstVisibleIndex,
  );
  const startIndex = Math.max(0, firstVisibleIndex - overscan);
  const endIndex = Math.min(itemCount, firstVisibleIndex + viewportRows + overscan);

  return { endIndex, startIndex, totalHeight };
}
