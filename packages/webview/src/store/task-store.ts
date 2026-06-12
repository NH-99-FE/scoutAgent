// ============================================================
// Task Store — 任务历史与搜索结果
// ============================================================

import { create } from 'zustand';
import type { ScoutTaskItem } from '@scout-agent/shared';

interface TaskResultInput {
  tasks: ScoutTaskItem[];
  query?: string;
  requestId?: string;
}

interface TaskActions {
  setTasks: (input: TaskResultInput) => void;
  setPendingSearch: (query: string, requestId: string) => void;
  reset: () => void;
}

interface TaskStore {
  tasks: ScoutTaskItem[];
  query: string;
  requestId: string | undefined;
  pending: boolean;
  actions: TaskActions;
}

const initialState = {
  tasks: [] as ScoutTaskItem[],
  query: '',
  requestId: undefined as string | undefined,
  pending: false,
};

export const useTaskStore = create<TaskStore>((set, get) => ({
  ...initialState,
  actions: {
    setTasks: ({ tasks, query, requestId }) => {
      const current = get();
      if (requestId && current.requestId && requestId !== current.requestId) return;
      set({
        tasks,
        query: query ?? current.query,
        requestId,
        pending: false,
      });
    },
    setPendingSearch: (query, requestId) => set({ query, requestId, pending: true }),
    reset: () => set(initialState),
  },
}));

export const useTasks = () => useTaskStore((state) => state.tasks);
export const useTaskCount = () => useTaskStore((state) => state.tasks.length);
export const useTaskQuery = () => useTaskStore((state) => state.query);
export const useTaskPending = () => useTaskStore((state) => state.pending);
export const useTaskActions = () => useTaskStore((state) => state.actions);
