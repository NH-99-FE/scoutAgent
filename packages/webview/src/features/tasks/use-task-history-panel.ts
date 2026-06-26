// ============================================================
// Task History Panel Hook — 历史任务面板交互
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScoutTaskItem } from '@scout-agent/shared';
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
  const triggerRef = useRef<HTMLSpanElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const searchTimerRef = useRef<number | undefined>(undefined);
  // 已请求第一页所用的 query 与 recent 快照基线。两个 effect 都在发请求后写入，
  // 互相看到对方刚发的请求就不再重复——搜索归搜索、recent 刷新归 recent 刷新，
  // 不会在清空搜索词等时机各自再发一次。
  const requestedQueryRef = useRef<string | undefined>(undefined);
  const requestedRecentKeyRef = useRef<string | undefined>(undefined);
  const recentTasks = useRecentTasks();
  const historyTasks = useHistoryTasks();
  const recentTasksKey = getRecentTasksKey(recentTasks);
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
    },
    [taskActions],
  );

  // 两个 effect 共用的去抖发起器：把上一个待发请求覆盖掉，200ms 后发第一页。
  const scheduleFirstPage = useCallback(
    (searchQuery: string, seedTasks?: ScoutTaskItem[]) => {
      if (searchTimerRef.current !== undefined) {
        window.clearTimeout(searchTimerRef.current);
      }
      searchTimerRef.current = window.setTimeout(() => {
        searchTimerRef.current = undefined;
        startSearch(searchQuery, 0, seedTasks);
      }, TASK_HISTORY_SEARCH_DEBOUNCE_MS);
    },
    [startSearch],
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
    // 第一页请求由下方的搜索 effect 驱动，open 只负责开面板。
  }, []);

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
      requestedQueryRef.current = undefined;
      requestedRecentKeyRef.current = undefined;
    }, TASK_HISTORY_PANEL_EXIT_MS);
  }, [taskActions]);

  const toggle = useCallback(() => {
    if (isOpen) {
      close();
      return;
    }
    open();
  }, [close, isOpen, open]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const panel = panelRef.current;
      const trigger = triggerRef.current;
      if (
        !panel ||
        panel.contains(event.target as Node) ||
        trigger?.contains(event.target as Node)
      ) {
        return;
      }
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

  // 搜索：query 变化（含面板打开时的空查询）请求第一页。
  // 首次（基线为 undefined）立即发，让用户点开即见内容；后续输入走 debounce。
  // 空查询用 recentTasks 作为 seed 立即填充，请求回来再替换。
  // 不在 cleanup 里清 timer——本 effect 也依赖 recentTasks，cleanup 清 timer 会
  // 让搜索中到达的 recent 推送取消待发请求；待发请求只在真正重排时被覆盖。
  useEffect(() => {
    if (!isOpen) return;
    if (requestedQueryRef.current === query) return;
    const isFirstFire = requestedQueryRef.current === undefined;
    requestedQueryRef.current = query;
    requestedRecentKeyRef.current = recentTasksKey;
    if (isFirstFire) {
      startSearch(query, 0, query === '' ? recentTasks : undefined);
      return;
    }
    scheduleFirstPage(query, query === '' ? recentTasks : undefined);
  }, [isOpen, query, recentTasks, recentTasksKey, scheduleFirstPage, startSearch]);

  // recent 刷新：仅当空查询且面板打开时，后台新会话（recentTasksKey 变化）刷新第一页。
  // 非空搜索与 recent 无关——最近会话本就不在搜索结果里，故此 effect 直接跳过。
  useEffect(() => {
    if (!isOpen || query !== '') return;
    if (requestedRecentKeyRef.current === recentTasksKey) return;
    requestedRecentKeyRef.current = recentTasksKey;
    scheduleFirstPage('', recentTasks);
  }, [isOpen, query, recentTasks, recentTasksKey, scheduleFirstPage]);

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
    triggerRef,
    tasks: historyTasks,
    query,
    pending,
    loadingMore,
    hasMore,
    sentinelRef,
    open,
    close,
    toggle,
    setQuery,
  };
}

function getRecentTasksKey(tasks: ScoutTaskItem[]): string {
  return tasks
    .map((task) =>
      [
        task.sessionPath,
        task.sessionId,
        task.title,
        task.modifiedAt ?? '',
        task.isCurrent === true ? '1' : '0',
      ].join('|'),
    )
    .join('\n');
}
