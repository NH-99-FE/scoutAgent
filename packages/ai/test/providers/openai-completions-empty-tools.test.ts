// ============================================================
// streamOpenAICompletions — 空 tools 处理测试
// 验证空 tools 数组不序列化为 tools: []
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions.js';
import type { OpenAICompletionsOptions } from '../../src/providers/openai-completions';
import type { Api, AssistantMessage, Context, Model, Tool } from '../../src/types';

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

function basicContext(): Context {
  return {
    systemPrompt: 'You are helpful.',
    messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }],
  };
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

// ---------- mock ----------

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

// ---------- 测试 ----------

describe('streamOpenAICompletions — empty tools handling', () => {
  beforeEach(() => {
    mockStreamChunks = [];
  });

  it('omits tools field when context.tools is empty array', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel();
    const ctx: Context = {
      ...basicContext(),
      tools: [], // 空 tools 数组
    };

    const s = streamOpenAICompletions(model, ctx, {
      apiKey: 'test-key',
      onPayload: (p) => {
        capturedPayload = p;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    // 空 tools 数组且无 tool history → 不发送 tools 字段
    expect(!('tools' in capturedPayload)).toBe(true);
  });

  it('omits tools field when context has no tools', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel();
    // 不设置 tools 属性
    const ctx = basicContext();

    const s = streamOpenAICompletions(model, ctx, {
      apiKey: 'test-key',
      onPayload: (p) => {
        capturedPayload = p;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    expect(!('tools' in capturedPayload)).toBe(true);
  });

  it('sends tools: [] when conversation has tool history', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel();
    // 对话有历史 toolCall + toolResult 但 ctx.tools 为空
    const ctx: Context = {
      systemPrompt: 'Use tools.',
      messages: [
        { role: 'user', content: 'Run tool', timestamp: Date.now() },
        {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'call_1', name: 'test_tool', arguments: {} }],
          api: 'openai-completions' as const,
          provider: 'openai',
          model: 'test-model',
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
        } as AssistantMessage,
        {
          role: 'toolResult',
          toolCallId: 'call_1',
          toolName: 'test_tool',
          content: [{ type: 'text', text: 'result' }],
          isError: false,
          timestamp: Date.now(),
        },
        { role: 'user', content: 'Now what?', timestamp: Date.now() },
      ],
      tools: [], // 空 tools 但有 tool history
    };

    const s = streamOpenAICompletions(model, ctx, {
      apiKey: 'test-key',
      onPayload: (p) => {
        capturedPayload = p;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    // 有 tool history → 需要发送 tools: [] 以避免 API 错误
    expect(capturedPayload.tools).toBeDefined();
    expect(capturedPayload.tools).toEqual([]);
  });

  it('sends tools array when context has tools', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel();
    const tools: Tool[] = [
      {
        name: 'test_tool',
        description: 'A test tool',
        parameters: {
          type: 'object',
          properties: { q: { type: 'string' } },
          required: ['q'],
        } as any,
      },
    ];
    const ctx: Context = {
      ...basicContext(),
      tools,
    };

    const s = streamOpenAICompletions(model, ctx, {
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

  it('omits default max token fields', async () => {
    let capturedPayload: any = null;
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      onPayload: (p) => {
        capturedPayload = p;
      },
    } as OpenAICompletionsOptions);

    await s.result();
    // 不提供 maxTokens 时不应设置 max_tokens/max_completion_tokens
    expect(capturedPayload.max_tokens).toBeUndefined();
    expect(capturedPayload.max_completion_tokens).toBeUndefined();
  });
});
