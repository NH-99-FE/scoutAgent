/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================
// streamAnthropic — thinking 禁用路径测试
// 验证 thinkingEnabled=false 时不产生 thinking 事件
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamAnthropic, streamSimpleAnthropic } from '../../src/providers/anthropic';
import type { AnthropicOptions } from '../../src/providers/anthropic';
import type { Context, Model } from '../../src/types';

// ---------- vi.mock ----------

let mockAnthropicResponse: Response | null = null;

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      constructor(_config?: any) {
        /* no-op */
      }
      messages = {
        create: () => ({
          asResponse: async () => mockAnthropicResponse,
        }),
      };
    },
  };
});

// ---------- 辅助 ----------

function makeModel(
  overrides: Partial<Model<'anthropic-messages'>> = {},
): Model<'anthropic-messages'> {
  return {
    id: 'test-model',
    name: 'Test Model',
    api: 'anthropic-messages',
    provider: 'anthropic',
    baseUrl: 'https://api.test/v1',
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: 'low', low: 'low', medium: 'medium', high: 'high' },
    input: ['text', 'image'],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200000,
    maxTokens: 8192,
    ...overrides,
  };
}

function basicContext(): Context {
  return {
    systemPrompt: 'You are helpful.',
    messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }],
  };
}

function createSseResponse(events: Array<{ event: string; data: string }>): Response {
  const body = events.map(({ event, data }) => `event: ${event}\ndata: ${data}\n`).join('\n');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function messageStartEvent(inputTokens = 10, outputTokens = 0) {
  return {
    event: 'message_start',
    data: JSON.stringify({
      type: 'message_start',
      message: {
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    }),
  };
}

function textStartEvent(index: number) {
  return {
    event: 'content_block_start',
    data: JSON.stringify({
      type: 'content_block_start',
      index,
      content_block: { type: 'text', text: '' },
    }),
  };
}

function textDeltaEvent(index: number, text: string) {
  return {
    event: 'content_block_delta',
    data: JSON.stringify({
      type: 'content_block_delta',
      index,
      delta: { type: 'text_delta', text },
    }),
  };
}

function blockStopEvent(index: number) {
  return {
    event: 'content_block_stop',
    data: JSON.stringify({ type: 'content_block_stop', index }),
  };
}

function messageDeltaEvent(stopReason: string, outputTokens = 5) {
  return {
    event: 'message_delta',
    data: JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: stopReason },
      usage: { output_tokens: outputTokens },
    }),
  };
}

function messageStopEvent() {
  return { event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) };
}

/** 收集事件流 */
async function collectEvents(s: AsyncIterable<any>) {
  const events: any[] = [];
  for await (const event of s) {
    events.push(event);
  }
  return events;
}

// ---------- 测试 ----------

describe('streamAnthropic — thinking disable path', () => {
  afterEach(() => {
    mockAnthropicResponse = null;
  });

  it('sends thinking.type=disabled when thinkingEnabled is false', async () => {
    let capturedPayload: any = null;
    mockAnthropicResponse = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const s = streamAnthropic(model, basicContext(), {
      apiKey: 'test-key',
      thinkingEnabled: false,
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    } as AnthropicOptions);

    await s.result();
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.thinking).toEqual({ type: 'disabled' });
  });

  it('does not emit thinking events when thinking is disabled', async () => {
    // SSE 流只包含 text 事件
    mockAnthropicResponse = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hello'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const s = streamAnthropic(model, basicContext(), {
      apiKey: 'test-key',
      thinkingEnabled: false,
    } as AnthropicOptions);

    const events = await collectEvents(s);
    const types = events.map((e) => e.type);

    // 不应有任何 thinking 事件
    expect(types).not.toContain('thinking_start');
    expect(types).not.toContain('thinking_delta');
    expect(types).not.toContain('thinking_end');
    // 应有 text 事件
    expect(types).toContain('text_start');
    expect(types).toContain('text_delta');
  });

  it('includes temperature when thinking is disabled', async () => {
    let capturedPayload: any = null;
    mockAnthropicResponse = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const s = streamAnthropic(model, basicContext(), {
      apiKey: 'test-key',
      thinkingEnabled: false,
      temperature: 0.7,
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    } as AnthropicOptions);

    await s.result();
    // thinking 禁用时应发送 temperature
    expect(capturedPayload.temperature).toBe(0.7);
    expect(capturedPayload.thinking).toEqual({ type: 'disabled' });
  });

  it('works with streamSimple when reasoning is not set', async () => {
    let capturedPayload: any = null;
    mockAnthropicResponse = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const s = streamSimpleAnthropic(model, basicContext(), {
      apiKey: 'test-key',
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    });

    await s.result();
    // 不设置 reasoning → thinkingEnabled: false → thinking.type=disabled
    expect(capturedPayload.thinking).toEqual({ type: 'disabled' });
  });

  it('does not set output_config when thinking is disabled', async () => {
    let capturedPayload: any = null;
    mockAnthropicResponse = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel({
      compat: {
        supportsEagerToolInputStreaming: true,
        supportsLongCacheRetention: true,
        forceAdaptiveThinking: true,
      },
    });
    const s = streamAnthropic(model, basicContext(), {
      apiKey: 'test-key',
      thinkingEnabled: false,
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    } as AnthropicOptions);

    await s.result();
    expect(capturedPayload.thinking).toEqual({ type: 'disabled' });
    // output_config 只在 thinking enabled + effort 时设置
    expect(capturedPayload.output_config).toBeUndefined();
  });
});
