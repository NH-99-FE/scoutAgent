// ============================================================
// streamOpenAICompletions — retry 行为测试
// 验证 maxRetries 选项正确传递给 OpenAI SDK
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions.js';
import type { OpenAICompletionsOptions } from '../../src/providers/openai-completions';
import type { Context, Model } from '../../src/types';

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

// ---------- mock — 捕获 requestOptions ----------

let mockStreamChunks: ChatCompletionChunk[] = [];
let capturedRequestOptions: any = null;

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      constructor(config: any) {
        /* no-op */
      }
      chat = {
        completions: {
          create: (_params: any, requestOptions: any) => {
            capturedRequestOptions = requestOptions;
            return {
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
            };
          },
        },
      };
    },
  };
});

import { streamOpenAICompletions } from '../../src/providers/openai-completions';

// ---------- 测试 ----------

describe('streamOpenAICompletions — retry behavior', () => {
  beforeEach(() => {
    mockStreamChunks = [];
    capturedRequestOptions = null;
  });

  it('defaults maxRetries to 0', async () => {
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedRequestOptions).not.toBeNull();
    expect(capturedRequestOptions.maxRetries).toBe(0);
  });

  it('passes maxRetries option through', async () => {
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const model = makeModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      maxRetries: 3,
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedRequestOptions.maxRetries).toBe(3);
  });

  it('passes signal and timeout options', async () => {
    mockStreamChunks = [textChunk('Hi'), textChunk('', 'stop')];

    const controller = new AbortController();
    const model = makeModel();
    const s = streamOpenAICompletions(model, basicContext(), {
      apiKey: 'test-key',
      signal: controller.signal,
      timeoutMs: 5000,
    } as OpenAICompletionsOptions);

    await s.result();
    expect(capturedRequestOptions.signal).toBe(controller.signal);
    expect(capturedRequestOptions.timeout).toBe(5000);
  });
});
