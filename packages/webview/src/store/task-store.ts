// ============================================================
// Task Store — 任务历史与搜索结果
// ============================================================

import { create } from 'zustand';
import type { ScoutTaskItem } from '@scout-agent/shared';

interface TaskActions {
  setRecentTasks: (tasks: ScoutTaskItem[]) => void;
  beginHistorySearch: (input: BeginHistorySearchInput) => void;
  applyHistoryResult: (input: HistoryResultInput) => void;
  setHistoryQuery: (query: string) => void;
  resetHistory: () => void;
  reset: () => void;
}

interface BeginHistorySearchInput {
  query: string;
  requestId: string;
  offset: number;
  seedTasks?: ScoutTaskItem[];
}

interface HistoryResultInput {
  query: string;
  requestId: string;
  tasks: ScoutTaskItem[];
  offset: number;
  hasMore: boolean;
  nextOffset: number;
}

interface TaskStore {
  recentTasks: ScoutTaskItem[];
  historyTasks: ScoutTaskItem[];
  historyQuery: string;
  historyPending: boolean;
  historyLoadingMore: boolean;
  historyRequestId: string | undefined;
  historyHasMore: boolean;
  historyNextOffset: number;
  actions: TaskActions;
}

const initialState = {
  recentTasks: [] as ScoutTaskItem[],
  historyTasks: [] as ScoutTaskItem[],
  historyQuery: '',
  historyPending: false,
  historyLoadingMore: false,
  historyRequestId: undefined as string | undefined,
  historyHasMore: false,
  historyNextOffset: 0,
};

export const useTaskStore = create<TaskStore>((set) => ({
  ...initialState,
  actions: {
    setRecentTasks: (recentTasks) => set({ recentTasks }),
    beginHistorySearch: ({ query, requestId, offset, seedTasks }) =>
      set((state) => ({
        historyTasks: offset > 0 ? state.historyTasks : (seedTasks ?? []),
        historyQuery: query,
        historyPending: offset === 0,
        historyLoadingMore: offset > 0,
        historyRequestId: requestId,
        historyHasMore: false,
        historyNextOffset: offset,
      })),
    applyHistoryResult: ({ query, requestId, tasks, offset, hasMore, nextOffset }) =>
      set((state) => {
        if (state.historyRequestId !== requestId) return state;
        return {
          historyTasks: offset > 0 ? appendUniqueTasks(state.historyTasks, tasks) : tasks,
          historyQuery: query,
          historyPending: false,
          historyLoadingMore: false,
          historyRequestId: undefined,
          historyHasMore: hasMore,
          historyNextOffset: nextOffset,
        };
      }),
    setHistoryQuery: (historyQuery) => set({ historyQuery }),
    resetHistory: () =>
      set({
        historyTasks: [],
        historyQuery: '',
        historyPending: false,
        historyLoadingMore: false,
        historyRequestId: undefined,
        historyHasMore: false,
        historyNextOffset: 0,
      }),
    reset: () => set(initialState),
  },
}));

function appendUniqueTasks(current: ScoutTaskItem[], incoming: ScoutTaskItem[]): ScoutTaskItem[] {
  const seen = new Set(current.map((task) => task.sessionPath));
  const next = [...current];
  for (const task of incoming) {
    if (seen.has(task.sessionPath)) continue;
    seen.add(task.sessionPath);
    next.push(task);
  }
  return next;
}

export const useRecentTasks = () => useTaskStore((state) => state.recentTasks);
export const useHistoryTasks = () => useTaskStore((state) => state.historyTasks);
export const useTaskHistoryQuery = () => useTaskStore((state) => state.historyQuery);
export const useTaskHistoryPending = () => useTaskStore((state) => state.historyPending);
export const useTaskHistoryLoadingMore = () => useTaskStore((state) => state.historyLoadingMore);
export const useTaskHistoryHasMore = () => useTaskStore((state) => state.historyHasMore);
export const useTaskHistoryNextOffset = () => useTaskStore((state) => state.historyNextOffset);
export const useTaskActions = () => useTaskStore((state) => state.actions);
