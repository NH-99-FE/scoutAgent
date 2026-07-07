import { describe, expect, it } from 'vitest';
import type { ScoutCustomModelsSettings } from '@scout-agent/shared';
import {
  getModelApiOptions,
  toCustomModelsSettings,
  toEditableCustomModels,
} from '@/features/settings/model/custom-models-draft';

describe('custom-models-draft', () => {
  it('returns provider-specific model API options', () => {
    const draft = toEditableCustomModels(makeCustomModelsSettings());

    expect(getModelApiOptions(draft.providers.openai)).toEqual([
      'openai-completions',
      'openai-responses',
    ]);
    expect(getModelApiOptions(draft.providers.anthropic)).toEqual(['anthropic-messages']);
  });

  it('saves provider defaults separately from raw custom model fields', () => {
    const draft = toEditableCustomModels(makeCustomModelsSettings());
    const payload = toCustomModelsSettings(draft);

    expect(payload).not.toBeTypeOf('string');
    if (typeof payload === 'string') return;
    expect(payload.providers.openai?.baseUrl).toBe('https://proxy.example.test/v1');
    expect(payload.providers.openai?.headers).toEqual({ 'x-provider': 'one' });
    expect(payload.providers.openai?.compat).toEqual({ supportsDeveloperRole: false });
    expect(payload.providers.openai?.models?.[0]).toEqual({
      id: 'gpt-test',
      contextWindow: 1000,
      maxTokens: 100,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
  });
});

function makeCustomModelsSettings(): ScoutCustomModelsSettings {
  return {
    modelsPath: '/home/me/.scout/agent/models.json',
    providerMetadata: {
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
    },
    providers: {
      openai: {
        apiKey: 'openai-key',
        baseUrl: 'https://proxy.example.test/v1',
        api: 'openai-responses',
        headers: { 'x-provider': 'one' },
        compat: { supportsDeveloperRole: false },
        models: [
          {
            id: 'gpt-test',
            contextWindow: 1000,
            maxTokens: 100,
          },
        ],
        modelOverrides: {},
      },
      anthropic: {
        apiKey: '',
        baseUrl: 'https://api.anthropic.com',
        api: 'anthropic-messages',
        models: [],
        modelOverrides: {},
      },
    },
  };
}
