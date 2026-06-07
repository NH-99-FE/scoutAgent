// ============================================================
// openai-responses provider 流式测试
// 覆盖 provider 私有参数构建与 service tier 计价
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ResponseCreateParamsStreaming,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses.js';
import type { Context, Model } from '../../src/types';

// ---------- 夹具 ----------

function makeModel(overrides: Partial<Model<'openai-responses'>> = {}): Model<'openai-responses'> {
  return {
    id: 'gpt-5',
    name: 'GPT-5',
    api: 'openai-responses',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    reasoning: true,
    thinkingLevelMap: { off: null },
    input: ['text', 'image'],
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
    ...overrides,
  };
}

function makeContext(): Context {
  return {
    messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }],
  };
}

function completedEvent(
  serviceTier: 'default' | 'flex' | 'priority',
  cachedTokens = 0,
): ResponseStreamEvent {
  return {
    type: 'response.completed',
    response: {
      id: 'resp_123',
      status: 'completed',
      service_tier: serviceTier,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        input_tokens_details: { cached_tokens: cachedTokens },
      },
    },
  } as ResponseStreamEvent;
}

// ---------- OpenAI mock ----------

let mockStreamEvents: ResponseStreamEvent[] = [];
let capturedPayload: ResponseCreateParamsStreaming | null = null;
let capturedClientConfig: { defaultHeaders?: Record<string, string> } | null = null;

vi.mock('openai', () => {
  class APIError extends Error {}

  return {
    default: class MockOpenAI {
      static APIError = APIError;

      constructor(config: { defaultHeaders?: Record<string, string> }) {
        capturedClientConfig = config;
      }

      responses = {
        create: (params: ResponseCreateParamsStreaming) => {
          capturedPayload = params;
          return {
            withResponse: async () => {
              async function* gen() {
                for (const event of mockStreamEvents) yield event;
              }
              return {
                data: gen(),
                response: {
                  status: 200,
                  headers: new Map([['content-type', 'text/event-stream']]),
                },
              };
            },
          };
        },
      };
    },
  };
});

import { streamOpenAIResponses } from '../../src/providers/openai-responses';

// ---------- service tier ----------

describe('streamOpenAIResponses — service tier pricing', () => {
  beforeEach(() => {
    mockStreamEvents = [];
    capturedPayload = null;
    capturedClientConfig = null;
  });

  it('applies flex service tier discount from the response', async () => {
    mockStreamEvents = [completedEvent('flex')];

    const stream = streamOpenAIResponses(makeModel(), makeContext(), { apiKey: 'test-key' });
    const result = await stream.result();

    expect(result.usage.cost.input).toBeCloseTo(0.000005);
    expect(result.usage.cost.output).toBeCloseTo(0.000005);
    expect(result.usage.cost.total).toBeCloseTo(0.00001);
  });

  it('applies requested flex service tier when response does not report a tier', async () => {
    mockStreamEvents = [completedEvent('default')];

    const stream = streamOpenAIResponses(makeModel(), makeContext(), {
      apiKey: 'test-key',
      serviceTier: 'flex',
    });
    const result = await stream.result();

    expect(capturedPayload?.service_tier).toBe('flex');
    expect(result.usage.cost.input).toBeCloseTo(0.000005);
    expect(result.usage.cost.output).toBeCloseTo(0.000005);
    expect(result.usage.cost.total).toBeCloseTo(0.00001);
  });
});

// ---------- session affinity ----------

describe('streamOpenAIResponses — session affinity headers', () => {
  beforeEach(() => {
    mockStreamEvents = [completedEvent('default')];
    capturedPayload = null;
    capturedClientConfig = null;
  });

  it('sets session_id and x-client-request-id headers by default', async () => {
    const stream = streamOpenAIResponses(makeModel(), makeContext(), {
      apiKey: 'test-key',
      sessionId: 'session-affinity',
    });

    await stream.result();

    expect(capturedPayload?.prompt_cache_key).toBe('session-affinity');
    expect(capturedClientConfig?.defaultHeaders?.session_id).toBe('session-affinity');
    expect(capturedClientConfig?.defaultHeaders?.['x-client-request-id']).toBe('session-affinity');
  });

  it('omits session_id but preserves x-client-request-id when sendSessionIdHeader is false', async () => {
    const stream = streamOpenAIResponses(
      makeModel({ compat: { sendSessionIdHeader: false } }),
      makeContext(),
      {
        apiKey: 'test-key',
        sessionId: 'session-affinity',
      },
    );

    await stream.result();

    expect(capturedPayload?.prompt_cache_key).toBe('session-affinity');
    expect(capturedClientConfig?.defaultHeaders?.session_id).toBeUndefined();
    expect(capturedClientConfig?.defaultHeaders?.['x-client-request-id']).toBe('session-affinity');
  });

  it('omits session affinity headers when cacheRetention is none', async () => {
    const stream = streamOpenAIResponses(makeModel(), makeContext(), {
      apiKey: 'test-key',
      sessionId: 'session-affinity',
      cacheRetention: 'none',
    });

    await stream.result();

    expect(capturedPayload?.prompt_cache_key).toBeUndefined();
    expect(capturedClientConfig?.defaultHeaders?.session_id).toBeUndefined();
    expect(capturedClientConfig?.defaultHeaders?.['x-client-request-id']).toBeUndefined();
  });

  it('lets explicit headers override generated session affinity headers', async () => {
    const stream = streamOpenAIResponses(makeModel(), makeContext(), {
      apiKey: 'test-key',
      sessionId: 'session-affinity',
      headers: {
        session_id: 'override-session',
        'x-client-request-id': 'override-request',
      },
    });

    await stream.result();

    expect(capturedClientConfig?.defaultHeaders?.session_id).toBe('override-session');
    expect(capturedClientConfig?.defaultHeaders?.['x-client-request-id']).toBe('override-request');
  });
});
