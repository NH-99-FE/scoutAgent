// ============================================================
// Config Store — 配置、模型与命令候选
// ============================================================

import { create } from 'zustand';
import type {
  ScoutCommandInfo,
  ScoutConfig,
  ScoutModelInfo,
  ScoutToolProfileInfo,
} from '@scout-agent/shared';

interface ConfigActions {
  setConfig: (config: ScoutConfig) => void;
  setCommands: (commands: ScoutCommandInfo[]) => void;
  reset: () => void;
}

interface ConfigStore {
  config: ScoutConfig | undefined;
  commands: ScoutCommandInfo[];
  actions: ConfigActions;
}

const initialState = {
  config: undefined as ScoutConfig | undefined,
  commands: [] as ScoutCommandInfo[],
};

const EMPTY_MODELS: ScoutModelInfo[] = [];
const EMPTY_TOOL_PROFILES: ScoutToolProfileInfo[] = [];

export const useConfigStore = create<ConfigStore>((set) => ({
  ...initialState,
  actions: {
    setConfig: (config) => set({ config }),
    setCommands: (commands) => set({ commands }),
    reset: () => set(initialState),
  },
}));

export const useScoutConfig = () => useConfigStore((state) => state.config);
export const useAvailableModels = () =>
  useConfigStore((state) => state.config?.models ?? EMPTY_MODELS);
export const useModelCount = () => useConfigStore((state) => state.config?.models.length ?? 0);
export const useDefaultModelProvider = () =>
  useConfigStore((state) => state.config?.defaultModelProvider ?? '');
export const useDefaultModelId = () =>
  useConfigStore((state) => state.config?.defaultModelId ?? '');
export const useDefaultToolProfileId = () =>
  useConfigStore((state) => state.config?.defaultToolProfileId ?? '');
export const useToolProfiles = () =>
  useConfigStore((state) => state.config?.toolProfiles ?? EMPTY_TOOL_PROFILES);
export const useDefaultModelLabel = () =>
  useConfigStore((state) => {
    const config = state.config;
    if (!config) return '';
    return config.defaultModelId || config.defaultModelProvider;
  });
export const useCommands = () => useConfigStore((state) => state.commands);
export const useConfigActions = () => useConfigStore((state) => state.actions);
