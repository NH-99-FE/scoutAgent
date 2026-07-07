// ============================================================
// Custom Models Draft — models.json raw 表单数据与协议数据转换
// ============================================================

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
import {
  parseOptionalJsonObject as parseOptionalJson,
  parseOptionalStringRecordJson,
  stringifyOptionalJsonObject as stringifyJson,
} from './json-draft-utils';

export interface EditableModel extends Omit<
  ScoutCustomModelSettings,
  'name' | 'api' | 'baseUrl' | 'cost'
> {
  clientId: string;
  name: string;
  api: ScoutModelApi | '';
  baseUrl: string;
  reasoning: boolean;
  input: Array<'text' | 'image'>;
  cost: ScoutConfiguredModelSettings['cost'];
  headersJson: string;
  compatJson: string;
  thinkingLevelMapJson: string;
}

export interface EditableProvider {
  provider: ScoutModelProvider;
  apiKey: string;
  baseUrl: string;
  api: ScoutModelApi;
  defaultBaseUrl: string;
  defaultApi: ScoutModelApi;
  supportedApis: ScoutModelApi[];
  headersJson: string;
  compatJson: string;
  modelOverridesJson: string;
  models: EditableModel[];
}

export interface EditableCustomModels {
  modelsPath: string;
  providers: Record<ScoutModelProvider, EditableProvider>;
  error?: string;
}

const EMPTY_COST: ScoutConfiguredModelSettings['cost'] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

const FALLBACK_METADATA: Record<ScoutModelProvider, ScoutCustomModelsProviderMetadata> = {
  openai: {
    provider: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultApi: 'openai-completions',
    supportedApis: ['openai-completions', 'openai-responses'],
  },
  anthropic: {
    provider: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultApi: 'anthropic-messages',
    supportedApis: ['anthropic-messages'],
  },
};

export const EMPTY_CUSTOM_MODELS: EditableCustomModels = {
  modelsPath: '',
  providers: {
    openai: createEditableProvider('openai', FALLBACK_METADATA.openai),
    anthropic: createEditableProvider('anthropic', FALLBACK_METADATA.anthropic),
  },
};

let nextEditableModelClientId = 0;

export function getModelProviders(draft: EditableCustomModels): ScoutModelProvider[] {
  return Object.keys(draft.providers) as ScoutModelProvider[];
}

export function createEditableModel(_provider: ScoutModelProvider): EditableModel {
  return toEditableModel({
    id: '',
    name: '',
    contextWindow: 128000,
    maxTokens: 4096,
    reasoning: false,
    input: ['text'],
    cost: { ...EMPTY_COST },
  });
}

export function toEditableCustomModels(
  settings: ScoutCustomModelsSettings,
  previous?: EditableCustomModels,
): EditableCustomModels {
  return {
    modelsPath: settings.modelsPath,
    error: settings.error,
    providers: {
      openai: toEditableProvider(
        'openai',
        settings.providers.openai,
        settings.providerMetadata.openai,
        previous?.providers.openai,
      ),
      anthropic: toEditableProvider(
        'anthropic',
        settings.providers.anthropic,
        settings.providerMetadata.anthropic,
        previous?.providers.anthropic,
      ),
    },
  };
}

export function toCustomModelsSettings(
  draft: EditableCustomModels,
): ScoutCustomModelsSaveSettings | string {
  const providers: ScoutCustomModelsSaveSettings['providers'] = {};

  for (const provider of getModelProviders(draft)) {
    const editable = draft.providers[provider];
    const headers = parseOptionalStringRecordJson(editable.headersJson, `${provider} headers`);
    if (typeof headers === 'string') return headers;

    const compat = parseOptionalJson(editable.compatJson, `${provider} compat`);
    if (typeof compat === 'string') return compat;

    const modelOverrides = parseOptionalJson(
      editable.modelOverridesJson,
      `${provider} modelOverrides`,
    );
    if (typeof modelOverrides === 'string') return modelOverrides;

    const models: ScoutCustomModelSettings[] = [];
    for (const [index, model] of editable.models.entries()) {
      const parsedHeaders = parseOptionalStringRecordJson(
        model.headersJson,
        `${provider} 模型 ${index + 1} headers`,
      );
      if (typeof parsedHeaders === 'string') return parsedHeaders;

      const parsedCompat = parseOptionalJson(
        model.compatJson,
        `${provider} 模型 ${index + 1} compat`,
      );
      if (typeof parsedCompat === 'string') return parsedCompat;

      const parsedThinking = parseOptionalJson(
        model.thinkingLevelMapJson,
        `${provider} 模型 ${index + 1} thinkingLevelMap`,
      );
      if (typeof parsedThinking === 'string') return parsedThinking;
      const limitError = validateTokenLimits(model, provider, index);
      if (limitError) return limitError;

      const rawModel: ScoutCustomModelSettings = {
        id: model.id,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        cost: model.cost,
        input: model.input,
      };
      if (model.name.trim()) rawModel.name = model.name.trim();
      if (model.api) rawModel.api = model.api;
      if (model.baseUrl.trim()) rawModel.baseUrl = model.baseUrl.trim();
      if (model.reasoning) rawModel.reasoning = model.reasoning;
      if (parsedHeaders) rawModel.headers = parsedHeaders;
      if (parsedCompat) rawModel.compat = parsedCompat;
      if (parsedThinking) rawModel.thinkingLevelMap = parsedThinking;
      models.push(rawModel);
    }

    providers[provider] = {
      apiKey: editable.apiKey,
      baseUrl: editable.baseUrl,
      api: editable.api,
      headers,
      compat,
      models,
      modelOverrides: (modelOverrides ?? {}) as Record<
        string,
        ScoutConfiguredModelOverrideSettings
      >,
    };
  }

  return { providers };
}

export function readNumberInput(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getModelApiOptions(provider: EditableProvider): ScoutModelApi[] {
  return [...provider.supportedApis];
}

function createEditableProvider(
  provider: ScoutModelProvider,
  metadata: ScoutCustomModelsProviderMetadata,
): EditableProvider {
  return {
    provider,
    apiKey: '',
    baseUrl: metadata.defaultBaseUrl,
    api: metadata.defaultApi,
    defaultBaseUrl: metadata.defaultBaseUrl,
    defaultApi: metadata.defaultApi,
    supportedApis: [...metadata.supportedApis],
    headersJson: '',
    compatJson: '',
    modelOverridesJson: '',
    models: [],
  };
}

function toEditableProvider(
  provider: ScoutModelProvider,
  settings: ScoutCustomModelsProviderSettings,
  metadata: ScoutCustomModelsProviderMetadata,
  previous?: EditableProvider,
): EditableProvider {
  return {
    provider,
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    api: settings.api,
    defaultBaseUrl: metadata.defaultBaseUrl,
    defaultApi: metadata.defaultApi,
    supportedApis: [...metadata.supportedApis],
    headersJson: stringifyJson(settings.headers),
    compatJson: stringifyJson(settings.compat),
    modelOverridesJson: stringifyJson(settings.modelOverrides),
    models: settings.models.map((model, index) => toEditableModel(model, previous?.models[index])),
  };
}

function toEditableModel(model: ScoutCustomModelSettings, previous?: EditableModel): EditableModel {
  return {
    ...model,
    name: model.name ?? '',
    api: model.api ?? '',
    baseUrl: model.baseUrl ?? '',
    reasoning: model.reasoning ?? false,
    clientId: previous?.clientId ?? createEditableModelClientId(),
    cost: { ...EMPTY_COST, ...(model.cost ?? {}) },
    input: model.input && model.input.length > 0 ? model.input : ['text'],
    headersJson: stringifyJson(model.headers),
    compatJson: stringifyJson(model.compat),
    thinkingLevelMapJson: stringifyJson(model.thinkingLevelMap),
  };
}

function validateTokenLimits(
  model: EditableModel,
  provider: ScoutModelProvider,
  index: number,
): string | undefined {
  if (!Number.isFinite(model.contextWindow) || model.contextWindow <= 0) {
    return `${provider} 模型 ${index + 1} contextWindow 必须大于 0`;
  }
  if (!Number.isFinite(model.maxTokens) || model.maxTokens <= 0) {
    return `${provider} 模型 ${index + 1} maxTokens 必须大于 0`;
  }
  return undefined;
}

function createEditableModelClientId(): string {
  nextEditableModelClientId += 1;
  return `model:${nextEditableModelClientId}`;
}
