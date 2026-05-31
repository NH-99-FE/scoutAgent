// ============================================================
// stream.ts 测试 — 流式调用入口
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { stream, complete, streamSimple, completeSimple } from '../src/stream';
import { clearApiProviders, registerApiProvider } from '../src/api-registry';
import { AssistantMessageEventStream } from '../src/event-stream';
import type {
  Api,
  Context,
  Model,
  SimpleStreamOptions,
  StreamFunction,
  StreamOptions,
} from '../src/types';

// ---------- 辅助 ----------

function makeModel(api: Api = 'openai-completions'): Model<Api> {
  return {
    id: 'test-model',
    name: 'Test Model',
    api,
    provider: 'test-provider',
    baseUrl: 'https://api.test/v1',
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

const testApi = 'test-stream-api' as Api;

function makeStreamFn(): StreamFunction<Api, StreamOptions> {
  return (_model, _context, _options) => new AssistantMessageEventStream();
}

function makeStreamSimpleFn(): StreamFunction<Api, SimpleStreamOptions> {
  return (_model, _context, _options) => new AssistantMessageEventStream();
}

function makeFakeMessage(): any {
  return {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text: 'hi' }],
    api: testApi,
    provider: 'test',
    model: 'test-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop' as const,
    timestamp: Date.now(),
  };
}

// ---------- 测试 ----------

describe('stream', () => {
  beforeEach(() => {
    clearApiProviders();
  });

  afterEach(() => {
    clearApiProviders();
  });

  it('throws for unregistered API provider', () => {
    expect(() => stream(makeModel('nonexistent-api' as Api), makeContext())).toThrow(
      /未注册的 API provider/,
    );
  });

  it('delegates to the registered provider stream function', () => {
    const streamFn = makeStreamFn();
    registerApiProvider({ api: testApi, stream: streamFn, streamSimple: makeStreamSimpleFn() });

    const result = stream(makeModel(testApi), makeContext());
    expect(result).toBeInstanceOf(AssistantMessageEventStream);
  });

  it('passes model, context, and options to provider stream', () => {
    let received: { model: unknown; context: unknown; options: unknown } | null = null;
    const streamFn: StreamFunction<Api, StreamOptions> = (model, context, options) => {
      received = { model, context, options };
      return new AssistantMessageEventStream();
    };
    registerApiProvider({ api: testApi, stream: streamFn, streamSimple: makeStreamSimpleFn() });

    const model = makeModel(testApi);
    const ctx = makeContext();
    const opts: StreamOptions = { temperature: 0.5, maxTokens: 512 };
    stream(model, ctx, opts);

    expect(received).not.toBeNull();
    expect(received!.model).toBe(model);
    expect(received!.context).toBe(ctx);
    expect(received!.options).toBe(opts);
  });
});

describe('complete', () => {
  beforeEach(() => {
    clearApiProviders();
  });

  afterEach(() => {
    clearApiProviders();
  });

  it('rejects for unregistered API provider', async () => {
    await expect(complete(makeModel('nonexistent-api' as Api), makeContext())).rejects.toThrow(
      /未注册的 API provider/,
    );
  });

  it('resolves with the result from stream', async () => {
    const es = new AssistantMessageEventStream();
    const fakeMessage = makeFakeMessage();
    // 发送完成事件
    setTimeout(() => {
      es.push({ type: 'start', partial: fakeMessage });
      es.push({ type: 'done', reason: 'stop', message: fakeMessage });
      es.end();
    }, 0);

    const streamFn: StreamFunction<Api, StreamOptions> = () => es;
    registerApiProvider({ api: testApi, stream: streamFn, streamSimple: makeStreamSimpleFn() });

    const result = await complete(makeModel(testApi), makeContext());
    expect(result).toBe(fakeMessage);
  });
});

describe('streamSimple', () => {
  beforeEach(() => {
    clearApiProviders();
  });

  afterEach(() => {
    clearApiProviders();
  });

  it('throws for unregistered API provider', () => {
    expect(() => streamSimple(makeModel('nonexistent-api' as Api), makeContext())).toThrow(
      /未注册的 API provider/,
    );
  });

  it('delegates to the registered provider streamSimple function', () => {
    const streamSimpleFn = makeStreamSimpleFn();
    registerApiProvider({ api: testApi, stream: makeStreamFn(), streamSimple: streamSimpleFn });

    const result = streamSimple(makeModel(testApi), makeContext());
    expect(result).toBeInstanceOf(AssistantMessageEventStream);
  });

  it('passes model, context, and options to provider streamSimple', () => {
    let received: { model: unknown; context: unknown; options: unknown } | null = null;
    const streamSimpleFn: StreamFunction<Api, SimpleStreamOptions> = (model, context, options) => {
      received = { model, context, options };
      return new AssistantMessageEventStream();
    };
    registerApiProvider({ api: testApi, stream: makeStreamFn(), streamSimple: streamSimpleFn });

    const model = makeModel(testApi);
    const ctx = makeContext();
    const opts: SimpleStreamOptions = { reasoning: 'medium' };
    streamSimple(model, ctx, opts);

    expect(received).not.toBeNull();
    expect(received!.model).toBe(model);
    expect(received!.context).toBe(ctx);
    expect(received!.options).toBe(opts);
  });
});

describe('completeSimple', () => {
  beforeEach(() => {
    clearApiProviders();
  });

  afterEach(() => {
    clearApiProviders();
  });

  it('rejects for unregistered API provider', async () => {
    await expect(
      completeSimple(makeModel('nonexistent-api' as Api), makeContext()),
    ).rejects.toThrow(/未注册的 API provider/);
  });

  it('resolves with the result from streamSimple', async () => {
    const es = new AssistantMessageEventStream();
    const fakeMessage = makeFakeMessage();
    setTimeout(() => {
      es.push({ type: 'start', partial: fakeMessage });
      es.push({ type: 'done', reason: 'stop', message: fakeMessage });
      es.end();
    }, 0);

    const streamSimpleFn: StreamFunction<Api, SimpleStreamOptions> = () => es;
    registerApiProvider({ api: testApi, stream: makeStreamFn(), streamSimple: streamSimpleFn });

    const result = await completeSimple(makeModel(testApi), makeContext());
    expect(result).toBe(fakeMessage);
  });
});
