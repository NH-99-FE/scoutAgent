// ============================================================
// Task History Panel Hook — 历史任务面板交互
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { protocolClient } from '@/bridge/protocol-client';
import { useIntersectionLoadMore } from '@/hooks/use-intersection-load-more';
import {
  useHistoryTasks,
  useRecentTasks,
  useTaskActions,
  useTaskHistoryHasMore,
  useTaskHistoryLoadingMore,
  useTaskHistoryNextOffset,
  useTaskHistoryPending,
  useTaskHistoryQuery,
} from '@/store/task-store';

const TASK_HISTORY_PANEL_EXIT_MS = 140;
const TASK_HISTORY_PAGE_SIZE = 20;
const TASK_HISTORY_SEARCH_DEBOUNCE_MS = 200;

export function useTaskHistoryPanel() {
  const [isRendered, setIsRendered] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const searchTimerRef = useRef<number | undefined>(undefined);
  const lastRequestedQueryRef = useRef<string | undefined>(undefined);
  const recentTasks = useRecentTasks();
  const historyTasks = useHistoryTasks();
  const query = useTaskHistoryQuery();
  const pending = useTaskHistoryPending();
  const loadingMore = useTaskHistoryLoadingMore();
  const hasMore = useTaskHistoryHasMore();
  const nextOffset = useTaskHistoryNextOffset();
  const taskActions = useTaskActions();

  const startSearch = useCallback(
    (searchQuery: string, offset: number, seedTasks?: typeof historyTasks) => {
      const queryToken = protocolClient.requestTaskHistory({
        query: searchQuery,
        limit: TASK_HISTORY_PAGE_SIZE,
        offset,
        purpose: 'panel',
      });
      taskActions.beginHistorySearch({
        query: searchQuery,
        queryToken,
        offset,
        seedTasks,
      });
      if (offset === 0) {
        lastRequestedQueryRef.current = searchQuery;
      }
    },
    [taskActions],
  );

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== undefined) {
        window.clearTimeout(closeTimerRef.current);
      }
      if (searchTimerRef.current !== undefined) {
        window.clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  const open = useCallback(() => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
    setIsRendered(true);
    setIsOpen(true);
    startSearch('', 0, recentTasks);
  }, [recentTasks, startSearch]);

  const close = useCallback(() => {
    setIsOpen(false);
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
    }
    if (searchTimerRef.current !== undefined) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = undefined;
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = undefined;
      setIsRendered(false);
      taskActions.resetHistory();
      lastRequestedQueryRef.current = undefined;
    }, TASK_HISTORY_PANEL_EXIT_MS);
  }, [taskActions]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const panel = panelRef.current;
      if (!panel || panel.contains(event.target as Node)) return;
      close();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [close, isOpen]);

  const setQuery = useCallback(
    (value: string) => {
      taskActions.setHistoryQuery(value);
    },
    [taskActions],
  );

  useEffect(() => {
    if (!isOpen || query === lastRequestedQueryRef.current) return;
    if (searchTimerRef.current !== undefined) {
      window.clearTimeout(searchTimerRef.current);
    }
    searchTimerRef.current = window.setTimeout(() => {
      searchTimerRef.current = undefined;
      startSearch(query, 0);
    }, TASK_HISTORY_SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimerRef.current !== undefined) {
        window.clearTimeout(searchTimerRef.current);
        searchTimerRef.current = undefined;
      }
    };
  }, [isOpen, query, startSearch]);

  const loadMore = useCallback(() => {
    if (!isOpen || pending || loadingMore || !hasMore) return;
    startSearch(query, nextOffset);
  }, [hasMore, isOpen, loadingMore, nextOffset, pending, query, startSearch]);

  const { sentinelRef } = useIntersectionLoadMore({
    enabled: isOpen,
    hasMore,
    isLoading: pending || loadingMore,
    onLoadMore: loadMore,
  });

  return {
    isRendered,
    isOpen,
    panelRef,
    tasks: historyTasks,
    query,
    pending,
    loadingMore,
    hasMore,
    sentinelRef,
    open,
    close,
    setQuery,
  };
}
