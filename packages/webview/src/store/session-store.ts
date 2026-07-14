// ============================================================
// Session Store — 当前会话摘要与会话列表
// ============================================================

import { create } from 'zustand';
import type {
  ScoutSessionListItem,
  ScoutActiveToolSelection,
  ScoutWebviewState,
  ThinkingLevel,
  ToolInfo,
} from '@scout-agent/shared';

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
  parentSessionPath: string;
  forkPointEntryId: string;
  cwd: string;
  modelProvider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  tools: ToolInfo[];
  activeToolSelection?: ScoutActiveToolSelection;
  actions: SessionActions;
}

const initialState = {
  sessions: [] as ScoutSessionListItem[],
  sessionId: '',
  sessionName: '',
  sessionFile: '',
  parentSessionPath: '',
  forkPointEntryId: '',
  cwd: '',
  modelProvider: '',
  modelId: '',
  thinkingLevel: 'off' as ThinkingLevel,
  tools: [] as ToolInfo[],
  activeToolSelection: undefined as ScoutActiveToolSelection | undefined,
};

export const useSessionStore = create<SessionStore>((set) => ({
  ...initialState,
  actions: {
    applyState: (state) =>
      set({
        sessionId: state.sessionId ?? '',
        sessionName: state.sessionName ?? '',
        sessionFile: state.sessionFile ?? '',
        parentSessionPath: state.parentSessionPath ?? '',
        forkPointEntryId: state.forkPointEntryId ?? '',
        cwd: state.cwd ?? '',
        modelProvider: state.modelProvider,
        modelId: state.modelId,
        thinkingLevel: state.thinkingLevel,
        tools: state.tools,
        activeToolSelection: state.activeToolSelection,
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
export const useParentSessionPath = () => useSessionStore((state) => state.parentSessionPath);
export const useForkPointEntryId = () => useSessionStore((state) => state.forkPointEntryId);
export const useSessionCwd = () => useSessionStore((state) => state.cwd);
export const useCurrentModelProvider = () => useSessionStore((state) => state.modelProvider);
export const useCurrentModelId = () => useSessionStore((state) => state.modelId);
export const useCurrentModelLabel = () =>
  useSessionStore((state) => [state.modelProvider, state.modelId].filter(Boolean).join(' / '));
export const useThinkingLevel = () => useSessionStore((state) => state.thinkingLevel);
export const useTools = () => useSessionStore((state) => state.tools);
export const useActiveToolSelection = () => useSessionStore((state) => state.activeToolSelection);
export const useSessionActions = () => useSessionStore((state) => state.actions);
