// ============================================================
// Intersection Load More Hook — 基于 sentinel 的无限滚动触发
// ============================================================

import { useEffect, useRef, useState } from 'react';

interface UseIntersectionLoadMoreOptions {
  enabled?: boolean;
  hasMore: boolean;
  isLoading: boolean;
  root?: Element | Document | null;
  rootMargin?: string;
  threshold?: number;
  onLoadMore: () => void;
}

export function useIntersectionLoadMore({
  enabled = true,
  hasMore,
  isLoading,
  root = null,
  rootMargin = '96px',
  threshold = 0,
  onLoadMore,
}: UseIntersectionLoadMoreOptions) {
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  const stateRef = useRef({ enabled, hasMore, isLoading });

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    stateRef.current = { enabled, hasMore, isLoading };
  }, [enabled, hasMore, isLoading]);

  useEffect(() => {
    if (!sentinel || !enabled || !hasMore || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const state = stateRef.current;
        if (!state.enabled || !state.hasMore || state.isLoading) return;
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMoreRef.current();
        }
      },
      { root, rootMargin, threshold },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled, hasMore, root, rootMargin, sentinel, threshold]);

  return { sentinelRef: setSentinel };
}
