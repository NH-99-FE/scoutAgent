// ============================================================
// UI Store — Surface、提示和诊断
// ============================================================

import { create } from 'zustand';
import type {
  ScoutDiagnostic,
  ScoutExtensionUIRequest,
  ScoutNotificationMessage,
} from '@scout-agent/shared';
import type { WebviewSurface } from '@/bridge/surface';

export type ChatView = 'auto' | 'home' | 'detail';
export type BootstrapStatus = 'pending' | 'ready' | 'failed';

interface UiActions {
  beginOpenTask: (sessionPath: string) => void;
  completeOpenTask: (success: boolean) => void;
  beginNewSessionRequest: () => void;
  completeNewSessionRequest: (success: boolean) => void;
  markBootstrapFailed: (message: string) => void;
  markBootstrapReady: () => void;
  resolveOpenTask: (sessionFile: string | undefined) => void;
  setChatView: (view: ChatView) => void;
  setSurface: (surface: WebviewSurface) => void;
  setNotification: (notification: ScoutNotificationMessage | undefined) => void;
  setExtensionUIRequests: (requests: ScoutExtensionUIRequest[]) => void;
  addExtensionUIRequest: (request: ScoutExtensionUIRequest) => void;
  removeExtensionUIRequest: (id: string) => void;
  setDiagnostics: (diagnostics: ScoutDiagnostic[]) => void;
  reset: () => void;
}

interface UiStore {
  bootstrapError: string | undefined;
  bootstrapStatus: BootstrapStatus;
  chatView: ChatView;
  newSessionPending: boolean;
  openingTaskSessionPath: string | undefined;
  surface: WebviewSurface;
  notification: ScoutNotificationMessage | undefined;
  extensionUIRequests: ScoutExtensionUIRequest[];
  diagnostics: ScoutDiagnostic[];
  actions: UiActions;
}

const initialState = {
  bootstrapError: undefined as string | undefined,
  bootstrapStatus: 'pending' as BootstrapStatus,
  chatView: 'auto' as ChatView,
  newSessionPending: false,
  openingTaskSessionPath: undefined as string | undefined,
  surface: 'chat' as WebviewSurface,
  notification: undefined as ScoutNotificationMessage | undefined,
  extensionUIRequests: [] as ScoutExtensionUIRequest[],
  diagnostics: [] as ScoutDiagnostic[],
};

export const useUiStore = create<UiStore>((set) => ({
  ...initialState,
  actions: {
    beginOpenTask: (sessionPath) =>
      set({
        chatView: 'home',
        newSessionPending: false,
        openingTaskSessionPath: sessionPath,
      }),
    completeOpenTask: (success) => {
      if (!success) {
        set({
          chatView: 'home',
          openingTaskSessionPath: undefined,
        });
      }
    },
    beginNewSessionRequest: () =>
      set({
        newSessionPending: true,
        openingTaskSessionPath: undefined,
      }),
    completeNewSessionRequest: (success) => {
      set({
        chatView: success ? 'detail' : 'home',
        newSessionPending: false,
      });
    },
    markBootstrapFailed: (message) =>
      set({
        bootstrapError: message,
        bootstrapStatus: 'failed',
      }),
    markBootstrapReady: () => set({ bootstrapError: undefined, bootstrapStatus: 'ready' }),
    resolveOpenTask: (sessionFile) =>
      set((state) => {
        if (!state.openingTaskSessionPath || state.openingTaskSessionPath !== sessionFile) {
          return {};
        }
        return {
          chatView: 'detail',
          openingTaskSessionPath: undefined,
        };
      }),
    setChatView: (view) => set({ chatView: view }),
    setSurface: (surface) => set({ surface }),
    setNotification: (notification) => set({ notification }),
    setExtensionUIRequests: (requests) => set({ extensionUIRequests: requests }),
    addExtensionUIRequest: (request) =>
      set((state) => ({
        extensionUIRequests: [
          ...state.extensionUIRequests.filter((existing) => existing.id !== request.id),
          request,
        ],
      })),
    removeExtensionUIRequest: (id) =>
      set((state) => ({
        extensionUIRequests: state.extensionUIRequests.filter((request) => request.id !== id),
      })),
    setDiagnostics: (diagnostics) => set({ diagnostics }),
    reset: () => set(initialState),
  },
}));

export const useBootstrapError = () => useUiStore((state) => state.bootstrapError);
export const useBootstrapStatus = () => useUiStore((state) => state.bootstrapStatus);
export const useChatView = () => useUiStore((state) => state.chatView);
export const useNewSessionPending = () => useUiStore((state) => state.newSessionPending);
export const useOpeningTaskSessionPath = () => useUiStore((state) => state.openingTaskSessionPath);
export const useSurface = () => useUiStore((state) => state.surface);
export const useNotification = () => useUiStore((state) => state.notification);
export const useExtensionUIRequests = () => useUiStore((state) => state.extensionUIRequests);
export const useDiagnostics = () => useUiStore((state) => state.diagnostics);
export const useUiActions = () => useUiStore((state) => state.actions);
