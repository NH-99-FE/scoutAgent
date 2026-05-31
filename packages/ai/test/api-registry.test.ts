// ============================================================
// api-registry 测试 — API Provider 注册表
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerApiProvider,
  getApiProvider,
  getApiProviders,
  unregisterApiProviders,
  clearApiProviders,
} from '../src/api-registry';
import { streamAnthropic, streamSimpleAnthropic } from '../src/providers/anthropic';
import {
  streamOpenAICompletions,
  streamSimpleOpenAICompletions,
} from '../src/providers/openai-completions';
import type {
  Api,
  Context,
  Model,
  SimpleStreamOptions,
  StreamFunction,
  StreamOptions,
} from '../src/types';
import { AssistantMessageEventStream as EventStreamClass } from '../src/event-stream';

// ---------- 辅助函数 ----------

function makeFakeStreamFn(api: string): StreamFunction<Api, StreamOptions> {
  return (model, _context, _options) => {
    if (model.api !== api) {
      throw new Error(`API 不匹配: ${model.api}，期望 ${api}`);
    }
    return new EventStreamClass();
  };
}

function makeFakeModel(api: Api, provider: string = 'test-provider'): Model<Api> {
  return {
    id: 'fake-model',
    name: 'Fake Model',
    api,
    provider,
    baseUrl: 'https://fake.api/v1',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096,
    maxTokens: 1024,
  };
}

function makeContext(): Context {
  return {
    messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }],
  };
}

function registerBuiltins() {
  registerApiProvider({
    api: 'anthropic-messages',
    stream: streamAnthropic,
    streamSimple: streamSimpleAnthropic,
  });
  registerApiProvider({
    api: 'openai-completions',
    stream: streamOpenAICompletions,
    streamSimple: streamSimpleOpenAICompletions,
  });
}

// ---------- 测试 ----------

describe('api-registry', () => {
  beforeEach(() => {
    if (!getApiProvider('anthropic-messages')) {
      registerBuiltins();
    }
  });

  afterEach(() => {
    clearApiProviders();
    registerBuiltins();
  });

  it('has built-in providers registered after import', () => {
    expect(getApiProvider('anthropic-messages')).toBeDefined();
    expect(getApiProvider('openai-completions')).toBeDefined();
  });

  it('returns undefined for unregistered API', () => {
    expect(getApiProvider('nonexistent-api')).toBeUndefined();
  });

  it('registerApiProvider registers a custom provider', () => {
    const customApi = 'test-custom-api' as Api;
    const streamFn = makeFakeStreamFn(customApi);
    const streamSimpleFn = makeFakeStreamFn(customApi) as StreamFunction<Api, SimpleStreamOptions>;

    registerApiProvider({
      api: customApi,
      stream: streamFn,
      streamSimple: streamSimpleFn,
    });

    const provider = getApiProvider(customApi);
    expect(provider).toBeDefined();
    expect(provider!.api).toBe(customApi);
  });

  it('registerApiProvider overwrites existing provider with same API', () => {
    const customApi = 'test-overwrite-api' as Api;
    const stream1 = makeFakeStreamFn(customApi);
    const stream2 = makeFakeStreamFn(customApi);

    registerApiProvider({ api: customApi, stream: stream1, streamSimple: stream1 as any });
    registerApiProvider({ api: customApi, stream: stream2, streamSimple: stream2 as any });

    const provider = getApiProvider(customApi);
    expect(provider).toBeDefined();
  });

  it('clearApiProviders removes all providers', () => {
    clearApiProviders();
    expect(getApiProvider('anthropic-messages')).toBeUndefined();
    expect(getApiProvider('openai-completions')).toBeUndefined();
  });

  it('registered provider stream throws on API mismatch', () => {
    const customApi = 'test-api-mismatch' as Api;
    const streamFn = makeFakeStreamFn(customApi);

    registerApiProvider({ api: customApi, stream: streamFn, streamSimple: streamFn as any });

    const provider = getApiProvider(customApi)!;
    const wrongModel = makeFakeModel('different-api' as Api);

    expect(() => provider.stream(wrongModel, makeContext())).toThrow(/API 不匹配/);
  });

  it('registered provider stream works with matching API', () => {
    const customApi = 'test-api-match' as Api;
    const streamFn = makeFakeStreamFn(customApi);

    registerApiProvider({ api: customApi, stream: streamFn, streamSimple: streamFn as any });

    const provider = getApiProvider(customApi)!;
    const model = makeFakeModel(customApi);

    const result = provider.stream(model, makeContext());
    expect(result).toBeDefined();
  });

  it('getApiProviders returns all registered providers', () => {
    const providers = getApiProviders();
    expect(providers.length).toBeGreaterThanOrEqual(2);
    const apis = providers.map((p) => p.api);
    expect(apis).toContain('anthropic-messages');
    expect(apis).toContain('openai-completions');
  });

  it('getApiProviders includes newly registered providers', () => {
    const customApi = 'test-get-all-api' as Api;
    const streamFn = makeFakeStreamFn(customApi);
    registerApiProvider({ api: customApi, stream: streamFn, streamSimple: streamFn as any });

    const providers = getApiProviders();
    const apis = providers.map((p) => p.api);
    expect(apis).toContain(customApi);
  });

  it('unregisterApiProviders removes providers by sourceId', () => {
    const sourceA = 'source-a';
    const sourceB = 'source-b';
    const apiA = 'test-api-source-a' as Api;
    const apiB = 'test-api-source-b' as Api;
    const streamFnA = makeFakeStreamFn(apiA);
    const streamFnB = makeFakeStreamFn(apiB);

    registerApiProvider({ api: apiA, stream: streamFnA, streamSimple: streamFnA as any }, sourceA);
    registerApiProvider({ api: apiB, stream: streamFnB, streamSimple: streamFnB as any }, sourceB);

    expect(getApiProvider(apiA)).toBeDefined();
    expect(getApiProvider(apiB)).toBeDefined();

    unregisterApiProviders(sourceA);

    expect(getApiProvider(apiA)).toBeUndefined();
    expect(getApiProvider(apiB)).toBeDefined();
  });

  it('unregisterApiProviders does not remove providers without sourceId', () => {
    const customApi = 'test-api-no-source' as Api;
    const streamFn = makeFakeStreamFn(customApi);
    registerApiProvider({ api: customApi, stream: streamFn, streamSimple: streamFn as any });

    unregisterApiProviders('nonexistent-source');

    expect(getApiProvider(customApi)).toBeDefined();
  });

  it('unregisterApiProviders removes multiple providers with same sourceId', () => {
    const sourceId = 'multi-source';
    const api1 = 'test-multi-api-1' as Api;
    const api2 = 'test-multi-api-2' as Api;
    const streamFn1 = makeFakeStreamFn(api1);
    const streamFn2 = makeFakeStreamFn(api2);

    registerApiProvider({ api: api1, stream: streamFn1, streamSimple: streamFn1 as any }, sourceId);
    registerApiProvider({ api: api2, stream: streamFn2, streamSimple: streamFn2 as any }, sourceId);

    expect(getApiProvider(api1)).toBeDefined();
    expect(getApiProvider(api2)).toBeDefined();

    unregisterApiProviders(sourceId);

    expect(getApiProvider(api1)).toBeUndefined();
    expect(getApiProvider(api2)).toBeUndefined();
  });
});
