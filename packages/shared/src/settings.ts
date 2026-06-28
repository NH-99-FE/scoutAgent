// ============================================================
// Shared 设置契约：运行时设置与补丁
// ============================================================

import type { ScoutModelProvider, ThinkingLevel } from './models.ts';

// ---------- 设置枚举 ----------
export const SCOUT_SETTINGS_SCOPES = ['global', 'project'] as const;
export type ScoutSettingsScope = (typeof SCOUT_SETTINGS_SCOPES)[number];
export const SCOUT_TRANSPORTS = ['sse', 'websocket', 'websocket-cached', 'auto'] as const;
export type ScoutTransport = (typeof SCOUT_TRANSPORTS)[number];
export const SCOUT_QUEUE_MODES = ['one-at-a-time', 'all'] as const;
export type ScoutQueueMode = (typeof SCOUT_QUEUE_MODES)[number];

// ---------- 运行时设置 ----------
export interface ScoutRetryProviderSettings {
  timeoutMs?: number;
  maxRetries?: number;
  maxRetryDelayMs?: number;
}

export interface ScoutRetrySettings {
  enabled?: boolean;
  maxRetries?: number;
  baseDelayMs?: number;
  provider?: ScoutRetryProviderSettings;
}

export interface ScoutCompactionSettings {
  enabled?: boolean;
  reserveTokens?: number;
  keepRecentTokens?: number;
}

export interface ScoutBranchSummarySettings {
  reserveTokens?: number;
  skipPrompt?: boolean;
}

export interface ScoutRuntimeSettings {
  defaultProvider?: ScoutModelProvider;
  /**
   * Model id only. Provider-scoped references like openai/gpt-4.1 belong in runtime model refs,
   * not settings.json.
   */
  defaultModel?: string;
  defaultThinkingLevel?: ThinkingLevel;
  transport?: ScoutTransport;
  thinkingBudgets?: Record<string, unknown>;
  websocketConnectTimeoutMs?: number;
  steeringMode?: ScoutQueueMode;
  followUpMode?: ScoutQueueMode;
  compaction?: ScoutCompactionSettings;
  branchSummary?: ScoutBranchSummarySettings;
  retry?: ScoutRetrySettings;
  shellPath?: string;
  extensions?: string[];
}

export const SCOUT_RUNTIME_SETTINGS_PATHS = [
  'defaultProvider',
  'defaultModel',
  'defaultThinkingLevel',
  'transport',
  'thinkingBudgets',
  'websocketConnectTimeoutMs',
  'steeringMode',
  'followUpMode',
  'compaction.enabled',
  'compaction.reserveTokens',
  'compaction.keepRecentTokens',
  'branchSummary.reserveTokens',
  'branchSummary.skipPrompt',
  'retry.enabled',
  'retry.maxRetries',
  'retry.baseDelayMs',
  'retry.provider.timeoutMs',
  'retry.provider.maxRetries',
  'retry.provider.maxRetryDelayMs',
  'shellPath',
  'extensions',
] as const;

export type ScoutRuntimeSettingsPath = (typeof SCOUT_RUNTIME_SETTINGS_PATHS)[number];

export type ScoutRuntimeSettingsPatchOperation =
  | {
      op: 'set';
      path: ScoutRuntimeSettingsPath;
      value: unknown;
    }
  | {
      op: 'unset';
      path: ScoutRuntimeSettingsPath;
    };

export interface ScoutRuntimeSettingsPatch {
  operations: ScoutRuntimeSettingsPatchOperation[];
}

export interface ScoutRuntimeSettingsState {
  globalSettingsPath: string;
  projectSettingsPath: string;
  global: ScoutRuntimeSettings;
  project: ScoutRuntimeSettings;
  effective: ScoutRuntimeSettings;
  error?: string;
}
