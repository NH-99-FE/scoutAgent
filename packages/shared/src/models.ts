// ============================================================
// Shared 模型契约：推理等级与模型配置
// ============================================================

// ---------- 推理等级 ----------

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type ThinkingStrengthLevel = Exclude<ThinkingLevel, 'off'>;
export const THINKING_STRENGTH_LEVELS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly ThinkingStrengthLevel[];

// ---------- 模型 ----------
export interface ScoutModelInfo {
  provider: string;
  id: string;
  name: string;
  supportedThinkingLevels: ThinkingLevel[];
  input: Array<'text' | 'image'>;
  contextWindow: number;
}

export const SCOUT_MODEL_PROVIDERS = ['openai', 'anthropic'] as const;
export type ScoutModelProvider = (typeof SCOUT_MODEL_PROVIDERS)[number];
export type ScoutModelApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages';

// ---------- 自定义模型设置 ----------
export interface ScoutConfiguredModelSettings {
  id: string;
  name: string;
  provider: ScoutModelProvider;
  api: ScoutModelApi;
  baseUrl: string;
  reasoning: boolean;
  input: Array<'text' | 'image'>;
  contextWindow: number;
  maxTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  thinkingLevelMap?: Record<string, unknown>;
}

export interface ScoutCustomModelSettings {
  id: string;
  name?: string;
  api?: ScoutModelApi;
  baseUrl?: string;
  reasoning?: boolean;
  input?: Array<'text' | 'image'>;
  contextWindow: number;
  maxTokens: number;
  cost?: Partial<ScoutConfiguredModelSettings['cost']>;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  thinkingLevelMap?: Record<string, unknown>;
}

export interface ScoutConfiguredModelOverrideSettings {
  name?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, unknown>;
  input?: Array<'text' | 'image'>;
  cost?: Partial<ScoutConfiguredModelSettings['cost']>;
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
}

export interface ScoutCustomModelsProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  api?: ScoutModelApi;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  models?: ScoutCustomModelSettings[];
  modelOverrides?: Record<string, ScoutConfiguredModelOverrideSettings>;
}

export interface ScoutCustomModelsProviderSettings extends Required<
  Pick<ScoutCustomModelsProviderConfig, 'apiKey' | 'baseUrl' | 'api'>
> {
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  models: ScoutCustomModelSettings[];
  modelOverrides: Record<string, ScoutConfiguredModelOverrideSettings>;
}

export interface ScoutCustomModelsProviderMetadata {
  provider: ScoutModelProvider;
  defaultBaseUrl: string;
  defaultApi: ScoutModelApi;
  supportedApis: ScoutModelApi[];
}

export interface ScoutCustomModelsSaveSettings {
  providers: Partial<Record<ScoutModelProvider, ScoutCustomModelsProviderConfig>>;
}

export interface ScoutCustomModelsSettings {
  modelsPath: string;
  providerMetadata: Record<ScoutModelProvider, ScoutCustomModelsProviderMetadata>;
  providers: Record<ScoutModelProvider, ScoutCustomModelsProviderSettings>;
  error?: string;
}
