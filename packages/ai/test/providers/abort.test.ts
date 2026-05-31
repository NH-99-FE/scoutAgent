// ============================================================
// 流式传输中途 abort 行为测试
// 验证 Anthropic + OpenAI 两个 provider 的 abort 完整行为
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamAnthropic } from '../../src/providers/anthropic';
import type { AnthropicOptions } from '../../src/providers/anthropic';
import type { Api, Context, Model, Tool } from '../../src/types';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions.js';
import type { OpenAICompletionsOptions } from '../../src/providers/openai-completions';

// ============================================================
// Anthropic abort 测试
// ============================================================

// ---------- 辅助（复用 anthropic.test.ts 模式）----------

function makeAnthropicModel(
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

function createMockClient(response: Response) {
  return {
    messages: {
      create: () => ({
        asResponse: async () => response,
      }),
    },
  } as any;
}

/** 创建中途 abort 的 SSE 响应 — 产生一些内容后模拟截断 */
function createAbortableSseResponse(eventsBeforeAbort: Array<{ event: string; data: string }>): {
  response: Response;
  controller: AbortController;
} {
  const controller = new AbortController();
  // 不包含 message_stop，模拟流在中途被截断
  const body = eventsBeforeAbort
    .map(({ event, data }) => `event: ${event}\ndata: ${data}\n`)
    .join('\n');
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
  return { response, controller };
}

// ---------- streamAnthropic — abort mid-stream ----------

describe('streamAnthropic — abort mid-stream', () => {
  it('emits aborted when signal aborts after text content', async () => {
    // 模拟：流产生了一些文本内容后，signal 被中断
    // SSE 流不包含 message_stop → 触发 "stream ended before message_stop" 错误
    const { response, controller } = createAbortableSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hello'),
      textDeltaEvent(0, ' world'),
    ]);

    // 在流开始后立即 abort
    const model = makeAnthropicModel();
    const client = createMockClient(response);

    // 先 abort，让 iterateSseMessages 在读取时检测到
    controller.abort();

    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
      signal: controller.signal,
    } as AnthropicOptions);

    const result = await s.result();
    expect(result.stopReason).toBe('aborted');
  });

  it('emits aborted when signal aborts during thinking', async () => {
    const { response, controller } = createAbortableSseResponse([
      messageStartEvent(),
      thinkingStartEvent(0),
      thinkingDeltaEvent(0, 'Let me think...'),
    ]);

    controller.abort();

    const model = makeAnthropicModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
      signal: controller.signal,
      thinkingEnabled: true,
      thinkingBudgetTokens: 1024,
    } as AnthropicOptions);

    const result = await s.result();
    expect(result.stopReason).toBe('aborted');
  });

  it('emits aborted when signal aborts during tool call', async () => {
    const { response, controller } = createAbortableSseResponse([
      messageStartEvent(),
      toolUseStartEvent(0, 'tool_1', 'test_tool'),
      inputJsonDeltaEvent(0, '{"q":"hel'),
    ]);

    controller.abort();

    const model = makeAnthropicModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, toolContext(), {
      client,
      apiKey: 'test-key',
      signal: controller.signal,
    } as AnthropicOptions);

    const result = await s.result();
    expect(result.stopReason).toBe('aborted');
  });

  it('cleans up internal fields on abort', async () => {
    // SSE error 触发 catch 块，删除 index/partialJson
    const { response, controller } = createAbortableSseResponse([
      messageStartEvent(),
      toolUseStartEvent(0, 'tool_1', 'test_tool'),
      inputJsonDeltaEvent(0, '{"q":"hel'),
    ]);

    controller.abort();

    const model = makeAnthropicModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, toolContext(), {
      client,
      apiKey: 'test-key',
      signal: controller.signal,
    } as AnthropicOptions);

    const result = await s.result();
    expect(result.stopReason).toBe('aborted');
    // 验证 content blocks 无残留 index/partialJson
    for (const block of result.content) {
      expect((block as any).index).toBeUndefined();
      expect((block as any).partialJson).toBeUndefined();
    }
  });
});

// ============================================================
// OpenAI abort 测试
// ============================================================

// ---------- 辅助（复用 openai-completions-stream.test.ts 模式）----------

function makeOpenAIModel(
  overrides: Partial<Model<'openai-completions'>> = {},
): Model<'openai-completions'> {
  return {
    id: 'test-model',
    name: 'Test Model',
    api: 'openai-completions',
    provider: 'openai',
    baseUrl: 'https://api.test/v1',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096,
    maxTokens: 1024,
    ...overrides,
  };
}

function makeReasoningModel(
  overrides: Partial<Model<'openai-completions'>> = {},
): Model<'openai-completions'> {
  return makeOpenAIModel({
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: 'low', low: 'low', medium: 'medium', high: 'high' },
    ...overrides,
  });
}

function makeChunk(
  overrides: Partial<{
    id: string;
    model: string;
    choices: Array<{
      index: number;
      finish_reason: string | null;
      delta: Record<string, any>;
    }>;
    usage: any;
  }> = {},
): ChatCompletionChunk {
  return {
    id: overrides.id ?? 'chatcmpl-test',
    object: 'chat.completion.chunk',
    model: overrides.model ?? 'test-model',
    created: 0,
    choices: overrides.choices ?? [],
    usage: overrides.usage,
  } as ChatCompletionChunk;
}

function textChunk(content: string, finishReason: string | null = null) {
  return makeChunk({
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        delta: { role: 'assistant', content },
      },
    ],
  });
}

function toolCallChunk(
  index: number,
  id: string | undefined,
  name: string | undefined,
  args: string | undefined,
) {
  return makeChunk({
    choices: [
      {
        index: 0,
        finish_reason: null,
        delta: {
          role: 'assistant',
          tool_calls: [
            { index, id, type: 'function' as const, function: { name, arguments: args } },
          ],
        },
      },
    ],
  });
}

function reasoningChunk(
  content: string,
  field: 'reasoning_content' | 'reasoning' = 'reasoning_content',
) {
  return makeChunk({
    choices: [
      {
        index: 0,
        finish_reason: null,
        delta: { role: 'assistant', [field]: content },
      },
    ],
  });
}

let mockStreamChunks: ChatCompletionChunk[] = [];

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      constructor(config: any) {
        /* no-op */
      }
      chat = {
        completions: {
          create: () => ({
            withResponse: async () => {
              async function* gen() {
                for (const chunk of mockStreamChunks) yield chunk;
              }
              return {
                data: gen(),
                response: {
                  status: 200,
                  headers: new Map([['content-type', 'text/event-stream']]),
                },
              };
            },
          }),
        },
      };
    },
  };
});

import { streamOpenAICompletions } from '../../src/providers/openai-completions';

// ---------- streamOpenAICompletions — abort mid-stream ----------

describe('streamOpenAICompletions — abort mid-stream', () => {
  beforeEach(() => {
    mockStreamChunks = [];
  });

  it('emits aborted when signal aborts after text content', async () => {
    // 提供一些文本 chunk 但不包含 finish_reason → 流被 abort 后触发错误
    const controller = new AbortController();
    mockStreamChunks = [
      textChunk('Hello'),
      textChunk(' world'),
      // 没有 finish_reason 的 chunk
    ];

    // 流开始后 abort
    controller.abort();

    const model = makeOpenAIModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      signal: controller.signal,
    } as OpenAICompletionsOptions);

    const result = await s.result();
    expect(result.stopReason).toBe('aborted');
  });

  it('emits aborted when signal aborts during tool call streaming', async () => {
    const controller = new AbortController();
    mockStreamChunks = [
      toolCallChunk(0, 'call_1', 'test_tool', undefined),
      toolCallChunk(0, undefined, undefined, '{"q":"hel'),
      // 没有 finish_reason
    ];

    controller.abort();

    const model = makeOpenAIModel();
    const s = streamOpenAICompletions(model, toolContext(), {
      apiKey: 'test-key',
      signal: controller.signal,
    } as OpenAICompletionsOptions);

    const result = await s.result();
    expect(result.stopReason).toBe('aborted');
  });

  it('handles abort during reasoning content streaming', async () => {
    const controller = new AbortController();
    mockStreamChunks = [
      reasoningChunk('Let me think...'),
      // 没有 finish_reason
    ];

    controller.abort();

    const model = makeReasoningModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      signal: controller.signal,
    } as OpenAICompletionsOptions);

    const result = await s.result();
    expect(result.stopReason).toBe('aborted');
  });

  it('cleans up internal fields on abort', async () => {
    const controller = new AbortController();
    mockStreamChunks = [
      toolCallChunk(0, 'call_1', 'test_tool', undefined),
      toolCallChunk(0, undefined, undefined, '{"q":"test'),
      // 没有 finish_reason
    ];

    controller.abort();

    const model = makeOpenAIModel();
    const s = streamOpenAICompletions(model, toolContext(), {
      apiKey: 'test-key',
      signal: controller.signal,
    } as OpenAICompletionsOptions);

    const result = await s.result();
    expect(result.stopReason).toBe('aborted');
    // 验证无残留 partialArgs/streamIndex
    for (const block of result.content) {
      expect((block as any).partialArgs).toBeUndefined();
      expect((block as any).streamIndex).toBeUndefined();
    }
  });
});
