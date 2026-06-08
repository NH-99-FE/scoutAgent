/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================
// anthropic provider 测试 — mock client 注入
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamAnthropic, streamSimpleAnthropic } from '../../src/providers/anthropic';
import type { AnthropicOptions } from '../../src/providers/anthropic';
import type { Context, Model, Tool } from '../../src/types';

// ---------- vi.mock 让 streamSimpleAnthropic 内部创建的 Anthropic 客户端走 mock ----------

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

function toolContext(): Context {
  const tools: Tool[] = [
    {
      name: 'test_tool',
      description: 'A test tool',
      parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } as any,
    },
  ];
  return {
    systemPrompt: 'Use tools when needed.',
    messages: [{ role: 'user', content: 'Run the tool', timestamp: Date.now() }],
    tools,
  };
}

/** 创建模拟 Anthropic SSE 响应 */
function createSseResponse(events: Array<{ event: string; data: string }>): Response {
  const body = events.map(({ event, data }) => `event: ${event}\ndata: ${data}\n`).join('\n');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** 构造 message_start 事件 */
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

/** 构造 text content_block_start */
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

/** 构造 text_delta */
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

/** 构造 content_block_stop */
function blockStopEvent(index: number) {
  return {
    event: 'content_block_stop',
    data: JSON.stringify({ type: 'content_block_stop', index }),
  };
}

/** 构造 tool_use content_block_start */
function toolUseStartEvent(index: number, id: string, name: string) {
  return {
    event: 'content_block_start',
    data: JSON.stringify({
      type: 'content_block_start',
      index,
      content_block: { type: 'tool_use', id, name, input: {} },
    }),
  };
}

/** 构造 input_json_delta */
function inputJsonDeltaEvent(index: number, partialJson: string) {
  return {
    event: 'content_block_delta',
    data: JSON.stringify({
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: partialJson },
    }),
  };
}

/** 构造 thinking content_block_start */
function thinkingStartEvent(index: number) {
  return {
    event: 'content_block_start',
    data: JSON.stringify({
      type: 'content_block_start',
      index,
      content_block: { type: 'thinking', thinking: '' },
    }),
  };
}

/** 构造 thinking_delta */
function thinkingDeltaEvent(index: number, thinking: string) {
  return {
    event: 'content_block_delta',
    data: JSON.stringify({
      type: 'content_block_delta',
      index,
      delta: { type: 'thinking_delta', thinking },
    }),
  };
}

/** 构造 signature_delta */
function signatureDeltaEvent(index: number, signature: string) {
  return {
    event: 'content_block_delta',
    data: JSON.stringify({
      type: 'content_block_delta',
      index,
      delta: { type: 'signature_delta', signature },
    }),
  };
}

/** 构造 message_delta（stop reason + usage） */
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

/** 构造 message_stop */
function messageStopEvent() {
  return { event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) };
}

/** 创建 mock Anthropic client */
function createMockClient(response: Response) {
  return {
    messages: {
      create: () => ({
        asResponse: async () => response,
      }),
    },
  } as any;
}

/** 收集事件流 */
async function collectEvents(s: AsyncIterable<any>) {
  const events: any[] = [];
  for await (const event of s) {
    events.push(event);
  }
  return events;
}

// ---------- 基本文本生成 ----------

describe('streamAnthropic — basic text generation', () => {
  it('emits correct event sequence for text response', async () => {
    const response = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hello'),
      textDeltaEvent(0, ' world'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
    } as AnthropicOptions);

    const events = await collectEvents(s);
    const types = events.map((e) => e.type);

    expect(types).toContain('start');
    expect(types).toContain('text_start');
    expect(types).toContain('text_delta');
    expect(types).toContain('text_end');
    expect(types).toContain('done');

    const result = await s.result();
    expect(result.stopReason).toBe('stop');
    expect(result.content.length).toBeGreaterThan(0);
    const text = result.content.find((b) => b.type === 'text');
    expect(text).toBeDefined();
    expect((text as any).text).toBe('Hello world');
  });

  it('records usage stats', async () => {
    const response = createSseResponse([
      messageStartEvent(100, 20),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn', 30),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
    } as AnthropicOptions);

    const result = await s.result();
    expect(result.usage.input).toBe(100);
    expect(result.usage.output).toBeGreaterThan(0);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(result.usage.cost.total).toBeGreaterThan(0);
  });
});

// ---------- 工具调用 ----------

describe('streamAnthropic — tool calling', () => {
  it('emits tool call events', async () => {
    const response = createSseResponse([
      messageStartEvent(),
      toolUseStartEvent(0, 'tool_1', 'test_tool'),
      inputJsonDeltaEvent(0, '{"q":"hel'),
      inputJsonDeltaEvent(0, 'lo"}'),
      blockStopEvent(0),
      messageDeltaEvent('tool_use'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, toolContext(), {
      client,
      apiKey: 'test-key',
    } as AnthropicOptions);

    const events = await collectEvents(s);
    const types = events.map((e) => e.type);

    expect(types).toContain('toolcall_start');
    expect(types).toContain('toolcall_delta');
    expect(types).toContain('toolcall_end');
    expect(types).toContain('done');

    const result = await s.result();
    expect(result.stopReason).toBe('toolUse');
    const toolCall = result.content.find((b) => b.type === 'toolCall');
    expect(toolCall).toBeDefined();
    expect((toolCall as any).name).toBe('test_tool');
    expect((toolCall as any).id).toBe('tool_1');
  });
});

// ---------- 思考模式 ----------

describe('streamAnthropic — thinking', () => {
  it('emits thinking events', async () => {
    const response = createSseResponse([
      messageStartEvent(),
      thinkingStartEvent(0),
      thinkingDeltaEvent(0, 'Hmm...'),
      signatureDeltaEvent(0, 'sig123'),
      blockStopEvent(0),
      textStartEvent(1),
      textDeltaEvent(1, 'Answer'),
      blockStopEvent(1),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
      thinkingEnabled: true,
      thinkingBudgetTokens: 1024,
    } as AnthropicOptions);

    const events = await collectEvents(s);
    const types = events.map((e) => e.type);

    expect(types).toContain('thinking_start');
    expect(types).toContain('thinking_delta');
    expect(types).toContain('thinking_end');
    expect(types).toContain('text_start');

    const result = await s.result();
    const thinking = result.content.find((b) => b.type === 'thinking');
    expect(thinking).toBeDefined();
    expect((thinking as any).thinking).toBe('Hmm...');
    expect((thinking as any).thinkingSignature).toBe('sig123');
  });
});

// ---------- 停止原因映射 ----------

describe('streamAnthropic — stop reason mapping', () => {
  it.each([
    ['end_turn', 'stop'],
    ['max_tokens', 'length'],
    ['tool_use', 'toolUse'],
    ['stop_sequence', 'stop'],
  ])('maps %s to %s', async (anthropicReason, expectedReason) => {
    const response = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent(anthropicReason),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
    } as AnthropicOptions);
    const result = await s.result();
    expect(result.stopReason).toBe(expectedReason);
  });
});

// ---------- 错误处理 ----------

describe('streamAnthropic — error handling', () => {
  it('emits error event when SSE stream contains error event', async () => {
    const response = createSseResponse([{ event: 'error', data: 'Rate limit exceeded' }]);
    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
    } as AnthropicOptions);

    const result = await s.result();
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).toBeDefined();
  });
});

// ---------- onPayload 回调 ----------

describe('streamAnthropic — onPayload', () => {
  it('captures the payload via onPayload callback', async () => {
    let capturedPayload: any = null;
    const response = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);

    // onPayload intercepts before the request; we need the stream to complete
    // so use a real-enough flow: the client is already mocked
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    } as AnthropicOptions);

    await s.result();
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.model).toBe('test-model');
    expect(capturedPayload.stream).toBe(true);
    expect(capturedPayload.messages).toBeDefined();
  });
});

// ---------- streamSimpleAnthropic ----------

describe('streamSimpleAnthropic', () => {
  afterEach(() => {
    mockAnthropicResponse = null;
  });

  it('disables thinking when reasoning is not set', async () => {
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
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.thinking).toEqual({ type: 'disabled' });
  });

  it('enables thinking with budget when reasoning is set', async () => {
    let capturedPayload: any = null;
    mockAnthropicResponse = createSseResponse([
      messageStartEvent(),
      thinkingStartEvent(0),
      thinkingDeltaEvent(0, 'Thinking...'),
      signatureDeltaEvent(0, 'sig'),
      blockStopEvent(0),
      textStartEvent(1),
      textDeltaEvent(1, 'Answer'),
      blockStopEvent(1),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel({
      compat: {
        supportsEagerToolInputStreaming: true,
        supportsLongCacheRetention: true,
        forceAdaptiveThinking: false,
      },
    });

    const s = streamSimpleAnthropic(model, basicContext(), {
      apiKey: 'test-key',
      reasoning: 'medium',
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    });

    await s.result();
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.thinking).toBeDefined();
    expect(capturedPayload.thinking.type).toBe('enabled');
  });

  it('uses adaptive thinking when forceAdaptiveThinking is true', async () => {
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

    const s = streamSimpleAnthropic(model, basicContext(), {
      apiKey: 'test-key',
      reasoning: 'high',
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    });

    await s.result();
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.thinking).toBeDefined();
    expect(capturedPayload.thinking.type).toBe('adaptive');
  });

  it('throws when no API key available', () => {
    const model = makeModel();
    expect(() => streamSimpleAnthropic(model, basicContext())).toThrow(/No API key/);
  });
});

// ---------- 更多 stop reason 映射 ----------

describe('streamAnthropic — additional stop reasons', () => {
  it.each([
    ['refusal', 'error'],
    ['pause_turn', 'stop'],
    ['sensitive', 'error'],
  ])('maps %s to %s', async (anthropicReason, expectedReason) => {
    const response = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent(anthropicReason),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
    } as AnthropicOptions);

    const result = await s.result();
    // refusal/sensitive map to error, which triggers error path
    expect(result.stopReason).toBe(expectedReason);
  });
});

// ---------- redacted_thinking ----------

describe('streamAnthropic — redacted thinking', () => {
  it('handles redacted_thinking content block', async () => {
    const response = createSseResponse([
      messageStartEvent(),
      {
        event: 'content_block_start',
        data: JSON.stringify({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'redacted_thinking', data: 'redacted-signature-data' },
        }),
      },
      textStartEvent(1),
      textDeltaEvent(1, 'Answer'),
      blockStopEvent(1),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
    } as AnthropicOptions);

    const events = await collectEvents(s);
    const types = events.map((e) => e.type);
    expect(types).toContain('thinking_start');

    const result = await s.result();
    const thinking = result.content.find((b) => b.type === 'thinking') as any;
    expect(thinking).toBeDefined();
    expect(thinking.redacted).toBe(true);
    expect(thinking.thinkingSignature).toBe('redacted-signature-data');
  });
});

// ---------- abort ----------

describe('streamAnthropic — abort', () => {
  it('emits aborted event when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const response = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
      signal: controller.signal,
    } as AnthropicOptions);

    const result = await s.result();
    expect(result.stopReason).toBe('aborted');
  });
});

// ---------- error 路径清理 index/partialJson ----------

describe('streamAnthropic — error path cleanup', () => {
  it('cleans up internal fields on error', async () => {
    // SSE error event triggers catch block which deletes index/partialJson
    const response = createSseResponse([{ event: 'error', data: 'Something went wrong' }]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
    } as AnthropicOptions);

    const result = await s.result();
    expect(result.stopReason).toBe('error');
    // No content blocks should have internal 'index' or 'partialJson' fields
    for (const block of result.content) {
      expect((block as any).index).toBeUndefined();
      expect((block as any).partialJson).toBeUndefined();
    }
  });
});

// ---------- message_delta cache token 更新 ----------

describe('streamAnthropic — message_delta cache tokens', () => {
  it('updates cache tokens from message_delta', async () => {
    const response = createSseResponse([
      messageStartEvent(100, 0),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      {
        event: 'message_delta',
        data: JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: {
            output_tokens: 20,
            cache_read_input_tokens: 50,
            cache_creation_input_tokens: 10,
          },
        }),
      },
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
    } as AnthropicOptions);

    const result = await s.result();
    expect(result.usage.cacheRead).toBe(50);
    expect(result.usage.cacheWrite).toBe(10);
    expect(result.usage.output).toBe(20);
  });
});

// ---------- buildParams 间接测试 ----------

describe('streamAnthropic — buildParams', () => {
  it('includes temperature when thinking is not enabled', async () => {
    let capturedPayload: any = null;
    const response = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
      temperature: 0.5,
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    } as AnthropicOptions);

    await s.result();
    expect(capturedPayload.temperature).toBe(0.5);
  });

  it('omits temperature when thinking is enabled', async () => {
    let capturedPayload: any = null;
    const response = createSseResponse([
      messageStartEvent(),
      thinkingStartEvent(0),
      thinkingDeltaEvent(0, 'Hmm'),
      signatureDeltaEvent(0, 'sig'),
      blockStopEvent(0),
      textStartEvent(1),
      textDeltaEvent(1, 'Answer'),
      blockStopEvent(1),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
      thinkingEnabled: true,
      thinkingBudgetTokens: 2048,
      temperature: 0.5,
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    } as AnthropicOptions);

    await s.result();
    expect(capturedPayload.temperature).toBeUndefined();
  });

  it('sets thinking to disabled when thinkingEnabled is false', async () => {
    let capturedPayload: any = null;
    const response = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
      thinkingEnabled: false,
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    } as AnthropicOptions);

    await s.result();
    expect(capturedPayload.thinking).toEqual({ type: 'disabled' });
  });

  it('includes system prompt as array', async () => {
    let capturedPayload: any = null;
    const response = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    } as AnthropicOptions);

    await s.result();
    expect(capturedPayload.system).toBeDefined();
    expect(Array.isArray(capturedPayload.system)).toBe(true);
    expect(capturedPayload.system[0].type).toBe('text');
  });

  it('includes toolChoice when provided', async () => {
    let capturedPayload: any = null;
    const response = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
      toolChoice: 'auto',
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    } as AnthropicOptions);

    await s.result();
    expect(capturedPayload.tool_choice).toEqual({ type: 'auto' });
  });

  it('sets adaptive thinking with effort when forceAdaptiveThinking and reasoning enabled', async () => {
    let capturedPayload: any = null;
    const response = createSseResponse([
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
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
      thinkingEnabled: true,
      effort: 'high',
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    } as AnthropicOptions);

    await s.result();
    expect(capturedPayload.thinking.type).toBe('adaptive');
    expect(capturedPayload.output_config).toBeDefined();
    expect(capturedPayload.output_config.effort).toBe('high');
  });

  it('sets adaptive thinking with xhigh effort', async () => {
    let capturedPayload: any = null;
    const response = createSseResponse([
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
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
      thinkingEnabled: true,
      effort: 'xhigh',
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    } as AnthropicOptions);

    await s.result();
    expect(capturedPayload.thinking.type).toBe('adaptive');
    expect(capturedPayload.output_config.effort).toBe('xhigh');
  });
});

// ---------- onResponse 回调 ----------

describe('streamAnthropic — onResponse', () => {
  it('calls onResponse callback with response info', async () => {
    let capturedResponse: any = null;
    const response = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
      onResponse: (resp) => {
        capturedResponse = resp;
      },
    } as AnthropicOptions);

    await s.result();
    expect(capturedResponse).not.toBeNull();
    expect(capturedResponse.status).toBe(200);
  });
});

// ---------- mapThinkingLevelToEffort 覆盖 ----------

describe('streamSimpleAnthropic — thinking level mapping', () => {
  afterEach(() => {
    mockAnthropicResponse = null;
  });

  it('maps minimal to low effort via switch fallback', async () => {
    let capturedPayload: any = null;
    mockAnthropicResponse = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    // forceAdaptiveThinking + no thinkingLevelMap → switch fallback path
    const model = makeModel({
      thinkingLevelMap: undefined,
      compat: {
        supportsEagerToolInputStreaming: true,
        supportsLongCacheRetention: true,
        forceAdaptiveThinking: true,
      },
    });
    const s = streamSimpleAnthropic(model, basicContext(), {
      apiKey: 'test-key',
      reasoning: 'minimal',
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    });

    await s.result();
    expect(capturedPayload.thinking).toBeDefined();
    expect(capturedPayload.thinking.type).toBe('adaptive');
    expect(capturedPayload.output_config.effort).toBe('low');
  });

  it('maps medium effort via switch fallback', async () => {
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
      thinkingLevelMap: undefined,
      compat: {
        supportsEagerToolInputStreaming: true,
        supportsLongCacheRetention: true,
        forceAdaptiveThinking: true,
      },
    });
    const s = streamSimpleAnthropic(model, basicContext(), {
      apiKey: 'test-key',
      reasoning: 'medium',
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    });

    await s.result();
    expect(capturedPayload.output_config.effort).toBe('medium');
  });

  it('maps xhigh to default high via switch fallback', async () => {
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
      thinkingLevelMap: undefined,
      compat: {
        supportsEagerToolInputStreaming: true,
        supportsLongCacheRetention: true,
        forceAdaptiveThinking: true,
      },
    });
    const s = streamSimpleAnthropic(model, basicContext(), {
      apiKey: 'test-key',
      reasoning: 'xhigh',
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    });

    await s.result();
    expect(capturedPayload.output_config.effort).toBe('high');
  });

  it('maps high to high via switch fallback', async () => {
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
      thinkingLevelMap: undefined,
      compat: {
        supportsEagerToolInputStreaming: true,
        supportsLongCacheRetention: true,
        forceAdaptiveThinking: true,
      },
    });
    const s = streamSimpleAnthropic(model, basicContext(), {
      apiKey: 'test-key',
      reasoning: 'high',
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    });

    await s.result();
    expect(capturedPayload.output_config.effort).toBe('high');
  });

  it('uses thinkingLevelMap string value when available', async () => {
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
      thinkingLevelMap: { off: null, low: 'low', medium: 'medium', high: 'high' },
      compat: {
        supportsEagerToolInputStreaming: true,
        supportsLongCacheRetention: true,
        forceAdaptiveThinking: true,
      },
    });
    const s = streamSimpleAnthropic(model, basicContext(), {
      apiKey: 'test-key',
      reasoning: 'low',
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    });

    await s.result();
    expect(capturedPayload.thinking.type).toBe('adaptive');
    expect(capturedPayload.output_config.effort).toBe('low');
  });
});

// ---------- responseId ----------

describe('streamAnthropic — responseId', () => {
  it('captures responseId from message_start', async () => {
    const response = createSseResponse([
      {
        event: 'message_start',
        data: JSON.stringify({
          type: 'message_start',
          message: {
            id: 'msg-test-123',
            usage: {
              input_tokens: 10,
              output_tokens: 0,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          },
        }),
      },
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
    } as AnthropicOptions);

    const result = await s.result();
    expect(result.responseId).toBe('msg-test-123');
  });
});

// ---------- metadata user_id ----------

describe('streamAnthropic — metadata user_id', () => {
  it('includes metadata.user_id in payload when provided', async () => {
    let capturedPayload: any = null;
    const response = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
      metadata: { user_id: 'user-abc' },
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    } as AnthropicOptions);

    await s.result();
    expect(capturedPayload.metadata).toBeDefined();
    expect(capturedPayload.metadata.user_id).toBe('user-abc');
  });
});

// ---------- 非 adaptive 的 enabled thinking（budget_tokens） ----------

describe('streamAnthropic — enabled thinking with budget (non-adaptive)', () => {
  it('sends thinking enabled with budget_tokens when not adaptive', async () => {
    let capturedPayload: any = null;
    const response = createSseResponse([
      messageStartEvent(),
      thinkingStartEvent(0),
      thinkingDeltaEvent(0, 'Hmm'),
      signatureDeltaEvent(0, 'sig'),
      blockStopEvent(0),
      textStartEvent(1),
      textDeltaEvent(1, 'Answer'),
      blockStopEvent(1),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel({
      compat: {
        supportsEagerToolInputStreaming: true,
        supportsLongCacheRetention: true,
        forceAdaptiveThinking: false,
      },
    });
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
      thinkingEnabled: true,
      thinkingBudgetTokens: 4096,
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    } as AnthropicOptions);

    await s.result();
    expect(capturedPayload.thinking).toBeDefined();
    expect(capturedPayload.thinking.type).toBe('enabled');
    expect(capturedPayload.thinking.budget_tokens).toBe(4096);
  });
});

// ---------- 未知 stop reason 的 default case ----------

describe('streamAnthropic — unhandled stop reason', () => {
  it('emits error event for unknown stop reason', async () => {
    const response = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('unknown_reason'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
    } as AnthropicOptions);

    const result = await s.result();
    expect(result.stopReason).toBe('error');
  });
});

// ---------- cache_control on tool results ----------

describe('streamAnthropic — cache_control with tool results', () => {
  it('adds cache_control to string user messages by default', async () => {
    let capturedPayload: any = null;
    const response = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    } as AnthropicOptions);

    await s.result();
    expect(capturedPayload).not.toBeNull();
    const lastMessage = capturedPayload.messages[capturedPayload.messages.length - 1];
    expect(Array.isArray(lastMessage.content)).toBe(true);
    const lastBlock = lastMessage.content[lastMessage.content.length - 1];
    expect(lastBlock.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('sets 1h cache TTL when cacheRetention is long', async () => {
    let capturedPayload: any = null;
    const response = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
      cacheRetention: 'long',
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    } as AnthropicOptions);

    await s.result();
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('uses PI_CACHE_RETENTION=long as the default cache retention', async () => {
    const original = process.env.PI_CACHE_RETENTION;
    process.env.PI_CACHE_RETENTION = 'long';
    try {
      let capturedPayload: any = null;
      const response = createSseResponse([
        messageStartEvent(),
        textStartEvent(0),
        textDeltaEvent(0, 'Hi'),
        blockStopEvent(0),
        messageDeltaEvent('end_turn'),
        messageStopEvent(),
      ]);

      const model = makeModel();
      const client = createMockClient(response);
      const s = streamAnthropic(model, basicContext(), {
        client,
        apiKey: 'test-key',
        onPayload: (payload: unknown) => {
          capturedPayload = payload;
        },
      } as AnthropicOptions);

      await s.result();
      expect(capturedPayload).not.toBeNull();
      expect(capturedPayload.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    } finally {
      if (original === undefined) delete process.env.PI_CACHE_RETENTION;
      else process.env.PI_CACHE_RETENTION = original;
    }
  });

  it('omits ttl when supportsLongCacheRetention is false', async () => {
    let capturedPayload: any = null;
    const response = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel({ compat: { supportsLongCacheRetention: false } });
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
      cacheRetention: 'long',
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    } as AnthropicOptions);

    await s.result();
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('omits cache_control when cacheRetention is none', async () => {
    let capturedPayload: any = null;
    const response = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
      cacheRetention: 'none',
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    } as AnthropicOptions);

    await s.result();
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.system[0].cache_control).toBeUndefined();
    const lastMessage = capturedPayload.messages[capturedPayload.messages.length - 1];
    expect(lastMessage.content).toBe('Hello');
  });

  it('applies cache_control to last tool result content block', async () => {
    let capturedPayload: any = null;
    const response = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hi'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const ctx: Context = {
      systemPrompt: 'Use tools.',
      messages: [
        { role: 'user', content: 'Run tool', timestamp: Date.now() },
        {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'tool_1', name: 'test_tool', arguments: {} }],
          api: 'anthropic-messages' as const,
          provider: 'anthropic',
          model: 'test',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'toolUse',
          timestamp: Date.now(),
        },
        {
          role: 'toolResult',
          toolCallId: 'tool_1',
          toolName: 'test_tool',
          content: [{ type: 'text', text: 'result' }],
          isError: false,
          timestamp: Date.now(),
        },
        { role: 'user', content: 'Now what?', timestamp: Date.now() },
      ],
      tools: [
        {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {
            type: 'object',
            properties: { q: { type: 'string' } },
            required: ['q'],
          } as any,
        },
      ],
    };

    const s = streamAnthropic(model, ctx, {
      client,
      apiKey: 'test-key',
      cacheRetention: 'short',
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    } as AnthropicOptions);

    await s.result();
    expect(capturedPayload).not.toBeNull();
    // The last user message should have cache_control
    const lastUserMsg = capturedPayload.messages[capturedPayload.messages.length - 1];
    if (lastUserMsg && lastUserMsg.role === 'user' && Array.isArray(lastUserMsg.content)) {
      const lastBlock = lastUserMsg.content[lastUserMsg.content.length - 1];
      expect(lastBlock.cache_control).toBeDefined();
    }
  });
});
