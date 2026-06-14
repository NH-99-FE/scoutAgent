// ============================================================
// Session Store — 当前会话摘要与会话列表
// ============================================================

import { create } from 'zustand';
import type { ScoutSessionListItem, ScoutWebviewState, ThinkingLevel } from '@scout-agent/shared';

interface SessionActions {
  applyState: (state: ScoutWebviewState) => void;
  setSessions: (sessions: ScoutSessionListItem[]) => void;
  reset: () => void;
}

interface SessionStore {
  sessions: ScoutSessionListItem[];
  sessionId: string;
  sessionName: string;
  sessionFile: string;
  cwd: string;
  modelProvider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  actions: SessionActions;
}

const initialState = {
  sessions: [] as ScoutSessionListItem[],
  sessionId: '',
  sessionName: '',
  sessionFile: '',
  cwd: '',
  modelProvider: '',
  modelId: '',
  thinkingLevel: 'off' as ThinkingLevel,
};

export const useSessionStore = create<SessionStore>((set) => ({
  ...initialState,
  actions: {
    applyState: (state) =>
      set({
        sessionId: state.sessionId ?? '',
        sessionName: state.sessionName ?? '',
        sessionFile: state.sessionFile ?? '',
        cwd: state.cwd ?? '',
        modelProvider: state.modelProvider,
        modelId: state.modelId,
        thinkingLevel: state.thinkingLevel,
      }),
    setSessions: (sessions) => set({ sessions }),
    reset: () => set(initialState),
  },
}));

export const useSessions = () => useSessionStore((state) => state.sessions);
export const useSessionCount = () => useSessionStore((state) => state.sessions.length);
export const useSessionName = () => useSessionStore((state) => state.sessionName);
export const useSessionId = () => useSessionStore((state) => state.sessionId);
export const useSessionFile = () => useSessionStore((state) => state.sessionFile);
export const useSessionCwd = () => useSessionStore((state) => state.cwd);
export const useCurrentModelLabel = () =>
  useSessionStore((state) => [state.modelProvider, state.modelId].filter(Boolean).join(' / '));
export const useThinkingLevel = () => useSessionStore((state) => state.thinkingLevel);
export const useSessionActions = () => useSessionStore((state) => state.actions);
