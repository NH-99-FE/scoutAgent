// ============================================================
// ModelsConfigManager — 用户级 models.json raw/snapshot/runtime 管理
// ============================================================

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getModel as getBuiltInModel, getModels as getBuiltInModels } from '@scout-agent/ai';
import type { Api, Model } from '@scout-agent/ai';
import { SCOUT_MODEL_PROVIDERS } from '@scout-agent/shared';
import type {
  ScoutConfiguredModelOverrideSettings,
  ScoutConfiguredModelSettings,
  ScoutCustomModelSettings,
  ScoutCustomModelsProviderMetadata,
  ScoutCustomModelsProviderSettings,
  ScoutCustomModelsSaveSettings,
  ScoutCustomModelsSettings,
  ScoutModelApi,
  ScoutModelProvider,
} from '@scout-agent/shared';
import { getDefaultUserConfigDir } from './settings-manager.ts';
import { cloneJson, isRecord, readJsonFile, withFileLock, writeJsonFile } from './json-utils.ts';

const SUPPORTED_PROVIDERS = SCOUT_MODEL_PROVIDERS;
const SUPPORTED_PROVIDER_SET = new Set<string>(SUPPORTED_PROVIDERS);
const MODEL_APIS_BY_PROVIDER: Record<ScoutModelProvider, readonly ScoutModelApi[]> = {
  openai: ['openai-completions', 'openai-responses'],
  anthropic: ['anthropic-messages'],
};
const EMPTY_COST: ScoutConfiguredModelSettings['cost'] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

export interface ModelsConfigManagerOptions {
  userConfigDir?: string;
}

export function getUserModelsPath(userConfigDir = getDefaultUserConfigDir()): string {
  return join(resolve(userConfigDir), 'models.json');
}

export class ModelsConfigManager {
  readonly modelsPath: string;
  private settings: ScoutCustomModelsSettings;

  constructor(options: ModelsConfigManagerOptions = {}) {
    this.modelsPath = getUserModelsPath(options.userConfigDir);
    this.settings = this.readSettings();
  }

  reload(): void {
    this.settings = this.readSettings();
  }

  getSettings(): ScoutCustomModelsSettings {
    return cloneJson(this.settings);
  }

  save(settings: ScoutCustomModelsSaveSettings): ScoutCustomModelsSettings {
    withFileLock(this.modelsPath, () => {
      const normalized = normalizeCustomModelsSettings(this.modelsPath, settings);
      writeModelsFile(this.modelsPath, normalized);
    });
    this.reload();
    return this.getSettings();
  }

  getApiKey(provider: string): string | undefined {
    if (!isSupportedProvider(provider)) return undefined;
    const raw = this.settings.providers[provider].apiKey.trim();
    if (!raw) return undefined;
    return process.env[raw] || raw;
  }

  getConfiguredModels(): Model<Api>[] {
    const result: Model<Api>[] = [];
    for (const provider of SUPPORTED_PROVIDERS) {
      const config = this.settings.providers[provider];
      result.push(...this.buildProviderModelOverrides(provider, config));
      result.push(...config.models.map((model) => toAiModel(provider, config, model)));
    }
    return result;
  }

  private readSettings(): ScoutCustomModelsSettings {
    if (!existsSync(this.modelsPath)) {
      return emptyCustomModelsSettings(this.modelsPath);
    }
    const parsed = readJsonFile(this.modelsPath, {
      errorLabel: 'Models JSON is invalid',
    });
    if (!parsed.ok) {
      const settings = emptyCustomModelsSettings(this.modelsPath);
      settings.error = parsed.error;
      return settings;
    }
    try {
      return normalizeCustomModelsSettings(this.modelsPath, parsed.value);
    } catch (cause) {
      const settings = emptyCustomModelsSettings(this.modelsPath);
      settings.error =
        cause instanceof Error
          ? `Models config is invalid: ${this.modelsPath}: ${cause.message}`
          : `Models config is invalid: ${this.modelsPath}: ${String(cause)}`;
      return settings;
    }
  }

  private buildProviderModelOverrides(
    provider: ScoutModelProvider,
    config: ScoutCustomModelsProviderSettings,
  ): Model<Api>[] {
    const result: Model<Api>[] = [];
    const hasProviderBaseUrlOverride = config.baseUrl !== defaultBaseUrlForProvider(provider);
    const shouldOverrideProviderModels =
      hasProviderBaseUrlOverride ||
      !!config.headers ||
      !!config.compat ||
      Object.keys(config.modelOverrides).length > 0;
    if (!shouldOverrideProviderModels) return result;

    const modelIds = new Set<string>([
      ...getBuiltInModels(provider).map((model) => model.id),
      ...Object.keys(config.modelOverrides),
    ]);
    for (const modelId of modelIds) {
      const builtIn = getBuiltInModel(provider, modelId);
      if (!builtIn) continue;
      const override = config.modelOverrides[modelId];
      result.push(applyModelOverride(provider, builtIn, config, override));
    }
    return result;
  }
}

export function emptyCustomModelsSettings(modelsPath: string): ScoutCustomModelsSettings {
  return {
    modelsPath,
    providerMetadata: providerMetadata(),
    providers: {
      openai: emptyProviderSettings('openai'),
      anthropic: emptyProviderSettings('anthropic'),
    },
  };
}

export function normalizeCustomModelsSettings(
  modelsPath: string,
  value: unknown,
): ScoutCustomModelsSettings {
  const root = isRecord(value) ? value : {};
  const rawProviders = isRecord(root.providers) ? root.providers : {};
  const providers = {} as Record<ScoutModelProvider, ScoutCustomModelsProviderSettings>;

  for (const providerName of Object.keys(rawProviders)) {
    if (!isSupportedProvider(providerName)) {
      throw new Error(`Unsupported model provider: ${providerName}`);
    }
  }

  for (const provider of SUPPORTED_PROVIDERS) {
    providers[provider] = normalizeProviderSettings(provider, rawProviders[provider]);
  }

  return { modelsPath, providerMetadata: providerMetadata(), providers };
}

function normalizeProviderSettings(
  provider: ScoutModelProvider,
  value: unknown,
): ScoutCustomModelsProviderSettings {
  const record = isRecord(value) ? value : {};
  const apiKey = readString(record.apiKey);
  if (apiKey.startsWith('!')) {
    throw new Error(`Provider ${provider} command apiKey is not supported`);
  }
  const api =
    readModelApi(record.api, provider, `${provider}.api`) ?? defaultApiForProvider(provider);
  const baseUrl = readString(record.baseUrl) || defaultBaseUrlForProvider(provider);
  const headers = readStringRecord(record.headers, `${provider}.headers`);
  const compat = readObjectRecord(record.compat, `${provider}.compat`);
  const models = readModelList(provider, record.models);
  const modelOverrides = readModelOverrides(record.modelOverrides);

  return {
    apiKey,
    baseUrl,
    api,
    headers,
    compat,
    models,
    modelOverrides,
  };
}

function readModelList(provider: ScoutModelProvider, value: unknown): ScoutCustomModelSettings[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Provider ${provider} models must be an array`);
  }
  return value.map((model, index) => normalizeModel(provider, model, index));
}

function normalizeModel(
  provider: ScoutModelProvider,
  value: unknown,
  index: number,
): ScoutCustomModelSettings {
  if (!isRecord(value)) {
    throw new Error(`Provider ${provider} model ${index + 1} must be an object`);
  }
  const id = readString(value.id);
  if (!id) throw new Error(`Provider ${provider} model ${index + 1} id is required`);
  const contextWindow = readPositiveNumber(value.contextWindow, `${provider}/${id}.contextWindow`);
  const maxTokens = readPositiveNumber(value.maxTokens, `${provider}/${id}.maxTokens`);

  const model: ScoutCustomModelSettings = {
    id,
    contextWindow,
    maxTokens,
  };
  const name = readString(value.name);
  if (name) model.name = name;
  const api = readModelApi(value.api, provider, `${provider}/${id}.api`);
  if (api) model.api = api;
  const baseUrl = readString(value.baseUrl);
  if (baseUrl) model.baseUrl = baseUrl;
  if (typeof value.reasoning === 'boolean') model.reasoning = value.reasoning;
  const input = readModelInput(value.input, `${provider}/${id}.input`);
  if (input) model.input = input;
  const cost = readPartialCost(value.cost, `${provider}/${id}.cost`);
  if (cost) model.cost = cost;
  const headers = readStringRecord(value.headers, `${provider}/${id}.headers`);
  if (headers) model.headers = headers;
  const compat = readObjectRecord(value.compat, `${provider}/${id}.compat`);
  if (compat) model.compat = compat;
  const thinkingLevelMap = readObjectRecord(
    value.thinkingLevelMap,
    `${provider}/${id}.thinkingLevelMap`,
  );
  if (thinkingLevelMap) model.thinkingLevelMap = thinkingLevelMap;
  return model;
}

function readModelOverrides(value: unknown): Record<string, ScoutConfiguredModelOverrideSettings> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error('modelOverrides must be an object');
  const result: Record<string, ScoutConfiguredModelOverrideSettings> = {};
  for (const [modelId, rawOverride] of Object.entries(value)) {
    if (!isRecord(rawOverride)) {
      throw new Error(`${modelId} override must be an object`);
    }
    result[modelId] = normalizeModelOverride(modelId, rawOverride);
  }
  return result;
}

function normalizeModelOverride(
  modelId: string,
  value: Record<string, unknown>,
): ScoutConfiguredModelOverrideSettings {
  const result: ScoutConfiguredModelOverrideSettings = {};
  const name = readString(value.name);
  if (name) result.name = name;
  if (typeof value.reasoning === 'boolean') result.reasoning = value.reasoning;
  const thinkingLevelMap = readObjectRecord(value.thinkingLevelMap, `${modelId}.thinkingLevelMap`);
  if (thinkingLevelMap) result.thinkingLevelMap = thinkingLevelMap;
  const input = readModelInput(value.input, `${modelId}.input`);
  if (input) result.input = input;
  const cost = readPartialCost(value.cost, `${modelId}.cost`);
  if (cost) result.cost = cost;
  if (value.contextWindow !== undefined) {
    result.contextWindow = readPositiveNumber(value.contextWindow, `${modelId}.contextWindow`);
  }
  if (value.maxTokens !== undefined) {
    result.maxTokens = readPositiveNumber(value.maxTokens, `${modelId}.maxTokens`);
  }
  const headers = readStringRecord(value.headers, `${modelId}.headers`);
  if (headers) result.headers = headers;
  const compat = readObjectRecord(value.compat, `${modelId}.compat`);
  if (compat) result.compat = compat;
  return result;
}

function applyModelOverride(
  provider: ScoutModelProvider,
  model: Model<Api>,
  providerConfig: ScoutCustomModelsProviderSettings,
  override: ScoutConfiguredModelOverrideSettings | undefined,
): Model<Api> {
  const headers = mergeStringRecords(model.headers, providerConfig.headers, override?.headers);
  const compat = mergeObjectRecords(
    model.compat as Record<string, unknown> | undefined,
    providerConfig.compat,
    override?.compat,
  );
  const providerBaseUrl =
    providerConfig.baseUrl !== defaultBaseUrlForProvider(provider)
      ? providerConfig.baseUrl
      : undefined;
  return {
    ...model,
    name: override?.name ?? model.name,
    baseUrl: providerBaseUrl ?? model.baseUrl,
    reasoning: override?.reasoning ?? model.reasoning,
    input: override?.input ?? model.input,
    cost: { ...model.cost, ...(override?.cost ?? {}) },
    contextWindow: override?.contextWindow ?? model.contextWindow,
    maxTokens: override?.maxTokens ?? model.maxTokens,
    headers,
    compat: compat as Model<Api>['compat'],
    thinkingLevelMap:
      (override?.thinkingLevelMap as Model<Api>['thinkingLevelMap'] | undefined) ??
      model.thinkingLevelMap,
  };
}

function toAiModel(
  provider: ScoutModelProvider,
  providerConfig: ScoutCustomModelsProviderSettings,
  model: ScoutCustomModelSettings,
): Model<Api> {
  const headers = mergeStringRecords(providerConfig.headers, model.headers);
  const compat = mergeObjectRecords(providerConfig.compat, model.compat);
  return {
    id: model.id,
    name: model.name || model.id,
    api: model.api ?? providerConfig.api,
    provider,
    baseUrl: model.baseUrl || providerConfig.baseUrl,
    reasoning: model.reasoning ?? false,
    input: model.input ?? ['text'],
    cost: { ...EMPTY_COST, ...(model.cost ?? {}) },
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    headers,
    compat: compat as Model<Api>['compat'],
    thinkingLevelMap: model.thinkingLevelMap as Model<Api>['thinkingLevelMap'],
  };
}

function writeModelsFile(path: string, settings: ScoutCustomModelsSettings): void {
  writeJsonFile(path, toModelsFileJson(settings));
}

function toModelsFileJson(settings: ScoutCustomModelsSettings): Record<string, unknown> {
  const providers: Record<string, unknown> = {};
  for (const provider of SUPPORTED_PROVIDERS) {
    const config = settings.providers[provider];
    if (isEmptyProviderSettings(provider, config)) continue;
    providers[provider] = trimProviderForFile(provider, config);
  }
  return { providers };
}

function trimProviderForFile(
  provider: ScoutModelProvider,
  config: ScoutCustomModelsProviderSettings,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (config.apiKey) result.apiKey = config.apiKey;
  if (config.baseUrl && config.baseUrl !== defaultBaseUrlForProvider(provider)) {
    result.baseUrl = config.baseUrl;
  }
  if (config.api !== defaultApiForProvider(provider)) result.api = config.api;
  if (config.headers) result.headers = config.headers;
  if (config.compat) result.compat = config.compat;
  if (config.models.length > 0) result.models = config.models.map(trimModelForFile);
  if (Object.keys(config.modelOverrides).length > 0) {
    result.modelOverrides = config.modelOverrides;
  }
  return result;
}

function trimModelForFile(model: ScoutCustomModelSettings): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: model.id,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  };
  if (model.name) result.name = model.name;
  if (model.api) result.api = model.api;
  if (model.baseUrl) result.baseUrl = model.baseUrl;
  if (model.reasoning !== undefined) result.reasoning = model.reasoning;
  if (model.input) result.input = model.input;
  if (model.cost && Object.keys(model.cost).length > 0) result.cost = model.cost;
  if (model.headers) result.headers = model.headers;
  if (model.compat) result.compat = model.compat;
  if (model.thinkingLevelMap) result.thinkingLevelMap = model.thinkingLevelMap;
  return result;
}

function isEmptyProviderSettings(
  provider: ScoutModelProvider,
  config: ScoutCustomModelsProviderSettings,
): boolean {
  return (
    !config.apiKey &&
    config.baseUrl === defaultBaseUrlForProvider(provider) &&
    config.api === defaultApiForProvider(provider) &&
    !config.headers &&
    !config.compat &&
    config.models.length === 0 &&
    Object.keys(config.modelOverrides).length === 0
  );
}

function emptyProviderSettings(provider: ScoutModelProvider): ScoutCustomModelsProviderSettings {
  return {
    apiKey: '',
    baseUrl: defaultBaseUrlForProvider(provider),
    api: defaultApiForProvider(provider),
    models: [],
    modelOverrides: {},
  };
}

function providerMetadata(): Record<ScoutModelProvider, ScoutCustomModelsProviderMetadata> {
  return {
    openai: {
      provider: 'openai',
      defaultBaseUrl: defaultBaseUrlForProvider('openai'),
      defaultApi: defaultApiForProvider('openai'),
      supportedApis: [...MODEL_APIS_BY_PROVIDER.openai],
    },
    anthropic: {
      provider: 'anthropic',
      defaultBaseUrl: defaultBaseUrlForProvider('anthropic'),
      defaultApi: defaultApiForProvider('anthropic'),
      supportedApis: [...MODEL_APIS_BY_PROVIDER.anthropic],
    },
  };
}

function readModelApi(
  value: unknown,
  provider: ScoutModelProvider,
  label: string,
): ScoutModelApi | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const supportedApis = MODEL_APIS_BY_PROVIDER[provider];
  if (supportedApis.includes(value as ScoutModelApi)) {
    return value as ScoutModelApi;
  }
  throw new Error(`${label} must match provider ${provider}`);
}

function defaultApiForProvider(provider: ScoutModelProvider): ScoutModelApi {
  return provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions';
}

function defaultBaseUrlForProvider(provider: ScoutModelProvider): string {
  return provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1';
}

function readModelInput(value: unknown, label: string): Array<'text' | 'image'> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const input = value.filter(
    (item): item is 'text' | 'image' => item === 'text' || item === 'image',
  );
  if (input.length === 0) throw new Error(`${label} must contain text or image`);
  return input;
}

function readPartialCost(
  value: unknown,
  label: string,
): Partial<ScoutConfiguredModelSettings['cost']> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const result: Partial<ScoutConfiguredModelSettings['cost']> = {};
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
    if (value[key] === undefined) continue;
    const numberValue = readFiniteNumber(value[key]);
    if (numberValue === undefined) throw new Error(`${label}.${key} must be a finite number`);
    result[key] = numberValue;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function readPositiveNumber(value: unknown, label: string): number {
  const numberValue = readFiniteNumber(value);
  if (numberValue === undefined || numberValue <= 0) {
    throw new Error(`${label} must be greater than 0`);
  }
  return numberValue;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringRecord(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const entries = Object.entries(value).filter((entry): entry is [string, string] => {
    const [key, val] = entry;
    return typeof key === 'string' && typeof val === 'string';
  });
  if (entries.length !== Object.keys(value).length) {
    throw new Error(`${label} values must be strings`);
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function readObjectRecord(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return Object.keys(value).length > 0 ? cloneJson(value) : undefined;
}

function mergeStringRecords(
  ...records: Array<Record<string, string> | undefined>
): Record<string, string> | undefined {
  const merged: Record<string, string> = {};
  for (const record of records) {
    if (record) Object.assign(merged, record);
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeObjectRecords(
  ...records: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {};
  for (const record of records) {
    if (record) Object.assign(merged, record);
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function isSupportedProvider(value: string): value is ScoutModelProvider {
  return SUPPORTED_PROVIDER_SET.has(value);
}
