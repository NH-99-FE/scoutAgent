// ============================================================
// UI Store — Surface、提示和诊断
// ============================================================

import { create } from 'zustand';
import type { ScoutDiagnostic, ScoutNotificationMessage } from '@scout-agent/shared';
import type { WebviewSurface } from '@/bridge/surface';

interface UiActions {
  setSurface: (surface: WebviewSurface) => void;
  setNotification: (notification: ScoutNotificationMessage | undefined) => void;
  setDiagnostics: (diagnostics: ScoutDiagnostic[]) => void;
  reset: () => void;
}

interface UiStore {
  surface: WebviewSurface;
  notification: ScoutNotificationMessage | undefined;
  diagnostics: ScoutDiagnostic[];
  actions: UiActions;
}

const initialState = {
  surface: 'chat' as WebviewSurface,
  notification: undefined as ScoutNotificationMessage | undefined,
  diagnostics: [] as ScoutDiagnostic[],
};

export const useUiStore = create<UiStore>((set) => ({
  ...initialState,
  actions: {
    setSurface: (surface) => set({ surface }),
    setNotification: (notification) => set({ notification }),
    setDiagnostics: (diagnostics) => set({ diagnostics }),
    reset: () => set(initialState),
  },
}));

export const useSurface = () => useUiStore((state) => state.surface);
export const useNotification = () => useUiStore((state) => state.notification);
export const useDiagnostics = () => useUiStore((state) => state.diagnostics);
export const useUiActions = () => useUiStore((state) => state.actions);
