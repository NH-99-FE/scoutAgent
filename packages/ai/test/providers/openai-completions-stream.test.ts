/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================
// openai-completions 流式处理测试 — mock OpenAI 模块
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions.js';
import type { OpenAICompletionsOptions } from '../../src/providers/openai-completions';
import type { Context, Model, Tool } from '../../src/types';

// ---------- 辅助 ----------

function makeModel(
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
  return makeModel({
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: 'low', low: 'low', medium: 'medium', high: 'high' },
    ...overrides,
  });
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

/** 创建模拟的 OpenAI chunk */
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

/** 创建文本 chunk */
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

/** 创建工具调用 chunk */
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

/** 创建 reasoning chunk */
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

/** 创建带 reasoning_details 的 chunk */
function reasoningDetailsChunk(details: any[]) {
  return makeChunk({
    choices: [
      {
        index: 0,
        finish_reason: null,
        delta: { role: 'assistant', reasoning_details: details },
      },
    ],
  });
}

// ---------- 持有 mock 状态的全局变量 ----------

let mockStreamChunks: ChatCompletionChunk[] = [];
let mockOnCreate: ((params: any) => void) | null = null;
let mockClientConfig: any = null;

// Mock OpenAI 模块
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      constructor(config: any) {
        mockClientConfig = config;
      }
      chat = {
        completions: {
          create: (params: any) => {
            mockOnCreate?.(params);
            return {
              withResponse: async () => {
                async function* gen() {
                  for (const chunk of mockStreamChunks) {
                    yield chunk;
                  }
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
        },
      };
    },
  };
});

// 在 mock 设置之后导入
import {
  streamOpenAICompletions,
  streamSimpleOpenAICompletions,
} from '../../src/providers/openai-completions';

/** 收集事件流 */
async function collectEvents(s: AsyncIterable<any>) {
  const events: any[] = [];
  for await (const event of s) {
    events.push(event);
  }
  return events;
}

// ---------- 基本文本生成 ----------

describe('streamOpenAICompletions — basic text generation', () => {
  beforeEach(() => {
    mockStreamChunks = [];
    mockOnCreate = null;
  });

  it('emits correct event sequence for text response', async () => {
    mockStreamChunks = [textChunk('Hello'), textChunk(' world'), textChunk('', 'stop')];

    const model = makeModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
    } as OpenAICompletionsOptions);

    const events = await collectEvents(s);
    const types = events.map((e) => e.type);

    expect(types).toContain('start');
    expect(types).toContain('text_start');
    expect(types).toContain('text_delta');
    expect(types).toContain('text_end');
    expect(types).toContain('done');

    const result = await s.result();
    expect(result.stopReason).toBe('stop');
    const text = result.content.find((b) => b.type === 'text');
    expect(text).toBeDefined();
    expect((text as any).text).toBe('Hello world');
  });

  it('records usage stats when chunk contains usage', async () => {
    mockStreamChunks = [
      textChunk('Hi'),
      textChunk('', 'stop'),
      makeChunk({
        choices: [],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    ];

    const model = makeModel({ cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } });
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
    } as OpenAICompletionsOptions);

    const result = await s.result();
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(result.usage.cost.total).toBeGreaterThan(0);
  });

  it('parses cache tokens from prompt_tokens_details', async () => {
    mockStreamChunks = [
      textChunk('Hi'),
      textChunk('', 'stop'),
      makeChunk({
        choices: [],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 10,
          prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 5 },
        },
      }),
    ];

    const model = makeModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
    } as OpenAICompletionsOptions);

    const result = await s.result();
    expect(result.usage.cacheRead).toBe(80);
    expect(result.usage.cacheWrite).toBe(5);
    expect(result.usage.input).toBe(15);
  });
});

// ---------- 停止原因映射 ----------

describe('streamOpenAICompletions — stop reason mapping', () => {
  beforeEach(() => {
    mockStreamChunks = [];
    mockOnCreate = null;
  });

  it.each([
    ['stop', 'stop'],
    ['length', 'length'],
    ['tool_calls', 'toolUse'],
    ['content_filter', 'error'],
  ])('maps finish_reason %s to %s', async (finishReason, expectedReason) => {
    mockStreamChunks = [textChunk('Hi'), textChunk('', finishReason as string)];

    const model = makeModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
    } as OpenAICompletionsOptions);

    const result = await s.result();
    expect(result.stopReason).toBe(expectedReason);
  });

  it('maps unknown finish_reason to error', async () => {
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'some_unknown_reason')];

    const model = makeModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
    } as OpenAICompletionsOptions);

    const result = await s.result();
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).toContain('some_unknown_reason');
  });
});

// ---------- 工具调用 ----------

describe('streamOpenAICompletions — tool calls', () => {
  beforeEach(() => {
    mockStreamChunks = [];
    mockOnCreate = null;
  });

  it('emits tool call events for streaming tool calls', async () => {
    mockStreamChunks = [
      toolCallChunk(0, 'call_1', 'test_tool', undefined),
      toolCallChunk(0, undefined, undefined, '{"q":"hel'),
      toolCallChunk(0, undefined, undefined, 'lo"}'),
      makeChunk({
        choices: [{ index: 0, finish_reason: 'tool_calls', delta: { role: 'assistant' } }],
      }),
    ];

    const model = makeModel();
    const s = streamOpenAICompletions(model, toolContext(), {
      apiKey: 'test-key',
    } as OpenAICompletionsOptions);

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
    expect((toolCall as any).id).toBe('call_1');
  });

  it('handles multiple tool calls via index', async () => {
    mockStreamChunks = [
      toolCallChunk(0, 'call_1', 'tool_a', undefined),
      toolCallChunk(1, 'call_2', 'tool_b', undefined),
      toolCallChunk(0, undefined, undefined, '{"a":1}'),
      toolCallChunk(1, undefined, undefined, '{"b":2}'),
      makeChunk({
        choices: [{ index: 0, finish_reason: 'tool_calls', delta: { role: 'assistant' } }],
      }),
    ];

    const model = makeModel();
    const s = streamOpenAICompletions(model, toolContext(), {
      apiKey: 'test-key',
    } as OpenAICompletionsOptions);

    const result = await s.result();
    const toolCalls = result.content.filter((b) => b.type === 'toolCall');
    expect(toolCalls.length).toBe(2);
  });
});

// ---------- 推理/思考 ----------

describe('streamOpenAICompletions — reasoning', () => {
  beforeEach(() => {
    mockStreamChunks = [];
    mockOnCreate = null;
  });

  it('handles reasoning_content field', async () => {
    mockStreamChunks = [
      reasoningChunk('Let me think...'),
      textChunk('Answer'),
      textChunk('', 'stop'),
    ];

    const model = makeReasoningModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
    } as OpenAICompletionsOptions);

    const events = await collectEvents(s);
    const types = events.map((e) => e.type);
    expect(types).toContain('thinking_start');
    expect(types).toContain('thinking_delta');
    expect(types).toContain('thinking_end');

    const result = await s.result();
    const thinking = result.content.find((b) => b.type === 'thinking');
    expect(thinking).toBeDefined();
    expect((thinking as any).thinking).toBe('Let me think...');
  });

  it('handles reasoning field (alternative name)', async () => {
    mockStreamChunks = [
      reasoningChunk('Thinking...', 'reasoning'),
      textChunk('Answer'),
      textChunk('', 'stop'),
    ];

    const model = makeReasoningModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
    } as OpenAICompletionsOptions);

    const result = await s.result();
    const thinking = result.content.find((b) => b.type === 'thinking');
    expect(thinking).toBeDefined();
    expect((thinking as any).thinking).toBe('Thinking...');
  });
});

// ---------- reasoning_details ----------

describe('streamOpenAICompletions — reasoning_details', () => {
  beforeEach(() => {
    mockStreamChunks = [];
    mockOnCreate = null;
  });

  it('attaches reasoning_details to matching tool calls', async () => {
    mockStreamChunks = [
      toolCallChunk(0, 'call_1', 'test_tool', undefined),
      toolCallChunk(0, undefined, undefined, '{"q":"test"}'),
      reasoningDetailsChunk([
        {
          type: 'reasoning.encrypted',
          id: 'call_1',
          data: 'encrypted_data_here',
        },
      ]),
      makeChunk({
        choices: [{ index: 0, finish_reason: 'tool_calls', delta: { role: 'assistant' } }],
      }),
    ];

    const model = makeModel();
    const s = streamOpenAICompletions(model, toolContext(), {
      apiKey: 'test-key',
    } as OpenAICompletionsOptions);

    const result = await s.result();
    const toolCall = result.content.find((b) => b.type === 'toolCall') as any;
    expect(toolCall).toBeDefined();
    expect(toolCall.thoughtSignature).toBeDefined();
    const parsed = JSON.parse(toolCall.thoughtSignature);
    expect(parsed.type).toBe('reasoning.encrypted');
  });
});

// ---------- 错误处理 ----------

describe('streamOpenAICompletions — error handling', () => {
  beforeEach(() => {
    mockStreamChunks = [];
    mockOnCreate = null;
  });

  it('emits error event when stream ends without finish_reason', async () => {
    mockStreamChunks = [textChunk('Hi')];

    const model = makeModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
    } as OpenAICompletionsOptions);

    const result = await s.result();
    expect(result.stopReason).toBe('error');
  });
});

// ---------- onPayload / onResponse 回调 ----------

describe('streamOpenAICompletions — callbacks', () => {
  beforeEach(() => {
    mockStreamChunks = [];
    mockOnCreate = null;
  });

  it('calls onPayload before sending request', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      onPayload: (payload) => {
        capturedPayload = payload;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.model).toBe('test-model');
    expect(capturedPayload.stream).toBe(true);
  });

  it('calls onResponse after receiving response', async () => {
    let capturedResponse: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      onResponse: (response) => {
        capturedResponse = response;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedResponse).not.toBeNull();
    expect(capturedResponse.status).toBe(200);
  });

  it('allows onPayload to modify params', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      onPayload: (payload: any) => {
        capturedPayload = { ...payload, temperature: 0.5 };
        return capturedPayload;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedPayload.temperature).toBe(0.5);
  });
});

// ---------- responseId / responseModel ----------

describe('streamOpenAICompletions — response metadata', () => {
  beforeEach(() => {
    mockStreamChunks = [];
    mockOnCreate = null;
  });

  it('captures responseId from chunks', async () => {
    mockStreamChunks = [
      makeChunk({
        id: 'resp-123',
        choices: [{ index: 0, finish_reason: null, delta: { role: 'assistant', content: 'Hi' } }],
      }),
      textChunk('', 'stop'),
    ];

    const model = makeModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
    } as OpenAICompletionsOptions);

    const result = await s.result();
    expect(result.responseId).toBe('resp-123');
  });

  it('captures responseModel when different from request model', async () => {
    mockStreamChunks = [
      makeChunk({
        model: 'actual-deployed-model',
        choices: [{ index: 0, finish_reason: null, delta: { role: 'assistant', content: 'Hi' } }],
      }),
      textChunk('', 'stop'),
    ];

    const model = makeModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
    } as OpenAICompletionsOptions);

    const result = await s.result();
    expect(result.responseModel).toBe('actual-deployed-model');
  });

  it('leaves responseModel undefined when chunks echo the requested model id', async () => {
    mockStreamChunks = [
      makeChunk({
        model: 'test-model',
        choices: [{ index: 0, finish_reason: null, delta: { role: 'assistant', content: 'Hi' } }],
      }),
      textChunk('', 'stop'),
    ];

    const model = makeModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
    } as OpenAICompletionsOptions);

    const result = await s.result();
    expect(result.model).toBe('test-model');
    expect(result.responseModel).toBeUndefined();
  });

  it('ignores empty or missing chunk model values', async () => {
    mockStreamChunks = [
      makeChunk({
        choices: [{ index: 0, finish_reason: null, delta: { role: 'assistant', content: 'Hi' } }],
      }),
      makeChunk({
        model: '',
        choices: [{ index: 0, finish_reason: null, delta: { role: 'assistant', content: '!' } }],
      }),
      textChunk('', 'stop'),
    ];

    const model = makeModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
    } as OpenAICompletionsOptions);

    const result = await s.result();
    expect(result.responseModel).toBeUndefined();
    const text = result.content.find((block) => block.type === 'text');
    expect(text).toMatchObject({ text: 'Hi!' });
  });
});

// ---------- buildParams 间接测试（通过 onPayload） ----------

describe('streamOpenAICompletions — buildParams', () => {
  beforeEach(() => {
    mockStreamChunks = [];
    mockOnCreate = null;
  });

  it('includes temperature when provided', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      temperature: 0.7,
      onPayload: (p) => {
        capturedPayload = p;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedPayload.temperature).toBe(0.7);
  });

  it('uses max_completion_tokens by default', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      maxTokens: 2048,
      onPayload: (p) => {
        capturedPayload = p;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedPayload.max_completion_tokens).toBe(2048);
    expect(capturedPayload.max_tokens).toBeUndefined();
  });

  it('uses max_tokens when compat specifies', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel({ compat: { maxTokensField: 'max_tokens' } });
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      maxTokens: 2048,
      onPayload: (p) => {
        capturedPayload = p;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedPayload.max_tokens).toBe(2048);
    expect(capturedPayload.max_completion_tokens).toBeUndefined();
  });

  it('includes tools when context has tools', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel();
    const s = streamOpenAICompletions(model, toolContext(), {
      apiKey: 'test-key',
      onPayload: (p) => {
        capturedPayload = p;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedPayload.tools).toBeDefined();
    expect(capturedPayload.tools.length).toBe(1);
    expect(capturedPayload.tools[0].function.name).toBe('test_tool');
  });

  it('includes reasoning_effort for reasoning models', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeReasoningModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      reasoningEffort: 'high',
      onPayload: (p) => {
        capturedPayload = p;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedPayload.reasoning_effort).toBe('high');
  });

  it('sets thinking params for deepseek compat', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeReasoningModel({ compat: { thinkingFormat: 'deepseek' } });
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      reasoningEffort: 'medium',
      onPayload: (p) => {
        capturedPayload = p;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedPayload.thinking).toBeDefined();
    expect(capturedPayload.thinking.type).toBe('enabled');
  });

  it('sets reasoning for openrouter compat', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeReasoningModel({ compat: { thinkingFormat: 'openrouter' } });
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      reasoningEffort: 'high',
      onPayload: (p) => {
        capturedPayload = p;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedPayload.reasoning).toBeDefined();
    expect(capturedPayload.reasoning.effort).toBe('high');
  });

  it('sets reasoning for together compat', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeReasoningModel({ compat: { thinkingFormat: 'together' } });
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      reasoningEffort: 'medium',
      onPayload: (p) => {
        capturedPayload = p;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedPayload.reasoning).toBeDefined();
    expect(capturedPayload.reasoning.enabled).toBe(true);
  });

  it('includes prompt_cache_key for OpenAI base URL with sessionId', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel({ baseUrl: 'https://api.openai.com/v1' });
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      sessionId: 'test-session',
      onPayload: (p) => {
        capturedPayload = p;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedPayload.prompt_cache_key).toBe('test-session');
  });

  it('omits prompt_cache_key for non-OpenAI base URL', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel({ baseUrl: 'https://custom.api/v1' });
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      sessionId: 'test-session',
      onPayload: (p) => {
        capturedPayload = p;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedPayload.prompt_cache_key).toBeUndefined();
  });

  it('sets prompt_cache_retention when cacheRetention is long', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel({ baseUrl: 'https://custom.api/v1' });
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      cacheRetention: 'long',
      sessionId: 'session-long',
      onPayload: (p) => {
        capturedPayload = p;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedPayload.prompt_cache_key).toBe('session-long');
    expect(capturedPayload.prompt_cache_retention).toBe('24h');
  });

  it('uses PI_CACHE_RETENTION=long as the default cache retention', async () => {
    const original = process.env.PI_CACHE_RETENTION;
    process.env.PI_CACHE_RETENTION = 'long';
    try {
      let capturedPayload: any = null;
      mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

      const model = makeModel({ baseUrl: 'https://custom.api/v1' });
      const s = streamOpenAICompletions(model, basicContext(), {
        apiKey: 'test-key',
        sessionId: 'session-env-long',
        onPayload: (p) => {
          capturedPayload = p;
        },
      } as OpenAICompletionsOptions);

      await s.result();
      expect(capturedPayload.prompt_cache_key).toBe('session-env-long');
      expect(capturedPayload.prompt_cache_retention).toBe('24h');
    } finally {
      if (original === undefined) delete process.env.PI_CACHE_RETENTION;
      else process.env.PI_CACHE_RETENTION = original;
    }
  });

  it('omits prompt cache fields when cacheRetention is none', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel({ baseUrl: 'https://api.openai.com/v1' });
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      cacheRetention: 'none',
      sessionId: 'session-none',
      onPayload: (p) => {
        capturedPayload = p;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedPayload.prompt_cache_key).toBeUndefined();
    expect(capturedPayload.prompt_cache_retention).toBeUndefined();
  });

  it('omits prompt_cache_retention when supportsLongCacheRetention is false', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel({
      baseUrl: 'https://custom.api/v1',
      compat: { supportsLongCacheRetention: false },
    });
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      cacheRetention: 'long',
      sessionId: 'session-compat-false',
      onPayload: (p) => {
        capturedPayload = p;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedPayload.prompt_cache_key).toBeUndefined();
    expect(capturedPayload.prompt_cache_retention).toBeUndefined();
  });

  it('sends known session-affinity headers when enabled', async () => {
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel({
      baseUrl: 'https://custom.api/v1',
      compat: { sendSessionAffinityHeaders: true },
    });
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      sessionId: 'session-affinity',
    } as OpenAICompletionsOptions);

    await s.result();
    expect(mockClientConfig.defaultHeaders.session_id).toBe('session-affinity');
    expect(mockClientConfig.defaultHeaders['x-client-request-id']).toBe('session-affinity');
    expect(mockClientConfig.defaultHeaders['x-session-affinity']).toBe('session-affinity');
  });

  it('omits session-affinity headers when cacheRetention is none', async () => {
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel({
      baseUrl: 'https://custom.api/v1',
      compat: { sendSessionAffinityHeaders: true },
    });
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      cacheRetention: 'none',
      sessionId: 'session-affinity',
    } as OpenAICompletionsOptions);

    await s.result();
    expect(mockClientConfig.defaultHeaders.session_id).toBeUndefined();
    expect(mockClientConfig.defaultHeaders['x-client-request-id']).toBeUndefined();
    expect(mockClientConfig.defaultHeaders['x-session-affinity']).toBeUndefined();
  });

  it('lets explicit headers override generated session-affinity headers', async () => {
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel({
      baseUrl: 'https://custom.api/v1',
      compat: { sendSessionAffinityHeaders: true },
    });
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      sessionId: 'session-affinity',
      headers: {
        session_id: 'override-session',
        'x-client-request-id': 'override-request',
        'x-session-affinity': 'override-affinity',
      },
    } as OpenAICompletionsOptions);

    await s.result();
    expect(mockClientConfig.defaultHeaders.session_id).toBe('override-session');
    expect(mockClientConfig.defaultHeaders['x-client-request-id']).toBe('override-request');
    expect(mockClientConfig.defaultHeaders['x-session-affinity']).toBe('override-affinity');
  });

  it('includes toolChoice when provided', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel();
    const s = streamOpenAICompletions(model, toolContext(), {
      apiKey: 'test-key',
      toolChoice: 'auto',
      onPayload: (p) => {
        capturedPayload = p;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedPayload.tool_choice).toBe('auto');
  });

  it('sets reasoning_effort to off value when no reasoningEffort provided', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeReasoningModel({
      thinkingLevelMap: { off: 'none', low: 'low', medium: 'medium', high: 'high' },
    });
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      onPayload: (p) => {
        capturedPayload = p;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedPayload.reasoning_effort).toBe('none');
  });
});

// ---------- streamSimpleOpenAICompletions ----------

describe('streamSimpleOpenAICompletions', () => {
  beforeEach(() => {
    mockStreamChunks = [];
    mockOnCreate = null;
  });

  it('throws when no API key available', () => {
    const model = makeModel();
    expect(() => streamSimpleOpenAICompletions(model, basicContext())).toThrow(/No API key/);
  });

  it('delegates to streamOpenAICompletions with correct options', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeReasoningModel();
    const s = streamSimpleOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      reasoning: 'medium',
      onPayload: (payload: unknown) => {
        capturedPayload = payload;
      },
    } as any);

    await s.result();
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.reasoning_effort).toBeDefined();
  });
});
