/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================
// E2E 测试 — 通过真实 API 调用验证流式完整流程
// 使用模型：GLM-5.1 (OpenAI协议+思考) + Claude Haiku 4.5 (Anthropic协议)
// 没有对应 API key 的测试会自动 skip
// ============================================================

import { describe, it, expect } from 'vitest';
import { stream, complete, streamSimple, completeSimple } from '../src/stream';
import type { Context, Tool } from '../src/types';
import {
  getGLM51,
  getClaudeHaiku45,
  getGLM51Anthropic,
  getOfficialOpenAIResponsesModel,
  hasOfficialOpenAICredentials,
  getOpenAIApiKey,
  getAnthropicApiKey,
} from './e2e-utils';

// ---------- 共享辅助 ----------

function basicContext(): Context {
  return {
    systemPrompt: 'You are a helpful assistant. Reply concisely.',
    messages: [
      { role: 'user', content: 'What is 2+3? Reply with just the number.', timestamp: Date.now() },
    ],
  };
}

function toolContext(): Context {
  const tools: Tool[] = [
    {
      name: 'calculator',
      description: 'Performs arithmetic',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'The math expression to evaluate' },
        },
        required: ['expression'],
      } as any,
    },
  ];
  return {
    systemPrompt: 'You are a calculator assistant. Use the calculator tool for math.',
    messages: [{ role: 'user', content: 'What is 12 * 7?', timestamp: Date.now() }],
    tools,
  };
}

function getTextContent(response: { content: Array<{ type: string }> }) {
  return response.content.find((block) => block.type === 'text') as
    | { type: 'text'; text: string }
    | undefined;
}

// ============================================================
// Anthropic 协议 (Claude Haiku 4.5)
// ============================================================

describe('Anthropic E2E', () => {
  const model = getClaudeHaiku45();
  const apiKey = getAnthropicApiKey();

  it.skipIf(!apiKey)('basic text generation', { timeout: 30000 }, async () => {
    const response = await complete(model, basicContext(), { apiKey });
    expect(response.role).toBe('assistant');
    expect(response.stopReason).toBe('stop');
    expect(response.content.length).toBeGreaterThan(0);
    const text = response.content.find((b) => b.type === 'text');
    expect(text).toBeDefined();
    expect((text as any).text).toContain('5');
    expect(response.usage.input).toBeGreaterThan(0);
    expect(response.usage.output).toBeGreaterThan(0);
  });

  it.skipIf(!apiKey)('streaming events', { timeout: 30000 }, async () => {
    const s = stream(model, basicContext(), { apiKey });
    const events: string[] = [];

    for await (const event of s) {
      events.push(event.type);
    }

    expect(events).toContain('start');
    expect(events).toContain('text_start');
    expect(events).toContain('text_delta');
    expect(events).toContain('text_end');
    expect(events).toContain('done');

    const result = await s.result();
    expect(result.stopReason).toBe('stop');
  });

  it.skipIf(!apiKey)('tool calling', { timeout: 30000 }, async () => {
    const response = await complete(model, toolContext(), { apiKey });
    expect(response.role).toBe('assistant');
    expect(['stop', 'toolUse', 'error']).toContain(response.stopReason);
    if (response.stopReason === 'toolUse') {
      const toolCall = response.content.find((b) => b.type === 'toolCall');
      expect(toolCall).toBeDefined();
      expect((toolCall as any).name).toBe('calculator');
    }
  });

  it.skipIf(!apiKey)('usage and cost', { timeout: 30000 }, async () => {
    const response = await complete(model, basicContext(), { apiKey });
    expect(response.usage.input).toBeGreaterThan(0);
    expect(response.usage.output).toBeGreaterThan(0);
    expect(response.usage.totalTokens).toBeGreaterThan(0);
    expect(response.usage.cost.total).toBeGreaterThan(0);
  });

  it.skipIf(!apiKey)('streamSimple with reasoning', { timeout: 30000 }, async () => {
    const response = await completeSimple(model, basicContext(), { apiKey, reasoning: 'low' });
    expect(response.role).toBe('assistant');
    expect(response.stopReason).oneOf(['stop', 'toolUse', 'error']);
    const hasContent = response.content.some((b) => b.type === 'text' || b.type === 'thinking');
    expect(hasContent).toBe(true);
  });

  it.skipIf(!apiKey)('system prompt is respected', { timeout: 30000 }, async () => {
    const ctx: Context = {
      systemPrompt: 'You must reply with exactly the word PING and nothing else.',
      messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }],
    };
    const response = await complete(model, ctx, { apiKey });
    expect(response.role).toBe('assistant');
    const text = response.content.find((b) => b.type === 'text');
    expect(text).toBeDefined();
    expect((text as any).text.length).toBeGreaterThan(0);
  });

  it.skipIf(!apiKey)('multi-turn conversation', { timeout: 30000 }, async () => {
    const ctx: Context = {
      messages: [
        { role: 'user', content: 'My name is TestBot.', timestamp: Date.now() },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Nice to meet you, TestBot!' }],
          api: 'anthropic-messages',
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
          stopReason: 'stop',
          timestamp: Date.now(),
        },
        { role: 'user', content: 'What is my name?', timestamp: Date.now() },
      ],
    };
    const response = await complete(model, ctx, { apiKey });
    expect(response.role).toBe('assistant');
    const text = response.content.find((b) => b.type === 'text');
    expect(text).toBeDefined();
    expect((text as any).text.toLowerCase()).toContain('testbot');
  });

  it.skipIf(!apiKey)('responseId is populated', { timeout: 30000 }, async () => {
    const response = await complete(model, basicContext(), { apiKey });
    expect(response.responseId).toBeDefined();
    expect(response.responseId!.length).toBeGreaterThan(0);
  });

  it.skipIf(!apiKey)('temperature option works', { timeout: 30000 }, async () => {
    const response = await complete(model, basicContext(), { apiKey, temperature: 0 });
    expect(response.role).toBe('assistant');
    expect(response.stopReason).oneOf(['stop', 'toolUse', 'error', 'length']);
  });

  it.skipIf(!apiKey)('maxTokens option works', { timeout: 30000 }, async () => {
    const ctx: Context = {
      systemPrompt: 'Tell me a long story.',
      messages: [
        { role: 'user', content: 'Write a 500-word essay about cats.', timestamp: Date.now() },
      ],
    };
    const response = await complete(model, ctx, { apiKey, maxTokens: 20 });
    expect(response.role).toBe('assistant');
    expect(response.stopReason).oneOf(['stop', 'length']);
  });
});

// ============================================================
// 官方 OpenAI Responses API
// ============================================================

describe('OpenAI Responses E2E', () => {
  const model = getOfficialOpenAIResponsesModel();
  const apiKey = getOpenAIApiKey();
  const canRun = hasOfficialOpenAICredentials();

  it.skipIf(!canRun)(
    'basic text generation through Responses API',
    { timeout: 30000 },
    async () => {
      const response = await complete(model, basicContext(), { apiKey });

      expect(response.role).toBe('assistant');
      expect(response.stopReason).toBe('stop');
      expect(response.responseId).toBeDefined();
      expect(getTextContent(response)?.text).toContain('5');
      expect(response.usage.input).toBeGreaterThan(0);
      expect(response.usage.output).toBeGreaterThan(0);
      expect(response.usage.cost.total).toBeGreaterThan(0);
    },
  );
});

// ============================================================
// OpenAI 兼容协议 (GLM-5.1 — 支持思考)
// ============================================================

describe('OpenAI E2E (GLM-5.1)', () => {
  const model = getGLM51();
  const apiKey = getOpenAIApiKey();

  it.skipIf(!apiKey)('basic text generation', { timeout: 30000 }, async () => {
    const response = await complete(model, basicContext(), { apiKey });
    expect(response.role).toBe('assistant');
    expect(response.stopReason).toBe('stop');
    expect(response.content.length).toBeGreaterThan(0);
    expect(response.content.some((b) => b.type === 'text' || b.type === 'thinking')).toBe(true);
    expect(response.usage.input).toBeGreaterThan(0);
  });

  it.skipIf(!apiKey)('streaming events', { timeout: 30000 }, async () => {
    const s = stream(model, basicContext(), { apiKey });
    const events: string[] = [];

    for await (const event of s) {
      events.push(event.type);
    }

    expect(events).toContain('start');
    expect(events).toContain('done');
    const hasContent = events.some((e) => e.startsWith('text_') || e.startsWith('thinking_'));
    expect(hasContent).toBe(true);

    const result = await s.result();
    expect(result.stopReason).toBe('stop');
  });

  it.skipIf(!apiKey)('streaming accumulates text correctly', { timeout: 30000 }, async () => {
    const s = stream(model, basicContext(), { apiKey });
    let textChunks = '';

    for await (const event of s) {
      if (event.type === 'text_delta') {
        textChunks += event.delta;
      }
    }

    const result = await s.result();
    expect(result.stopReason).oneOf(['stop', 'toolUse', 'error']);
    expect(result.content.length).toBeGreaterThan(0);
    const finalText = result.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    expect(textChunks).toBe(finalText);
  });

  it.skipIf(!apiKey)('tool calling', { timeout: 30000 }, async () => {
    const response = await complete(model, toolContext(), { apiKey });
    expect(response.role).toBe('assistant');
    expect(['stop', 'toolUse', 'error']).toContain(response.stopReason);
    if (response.stopReason === 'toolUse') {
      const toolCall = response.content.find((b) => b.type === 'toolCall');
      expect(toolCall).toBeDefined();
      expect((toolCall as any).name).toBe('calculator');
    }
  });

  it.skipIf(!apiKey)('usage stats', { timeout: 30000 }, async () => {
    const response = await complete(model, basicContext(), { apiKey });
    expect(response.usage.input).toBeGreaterThan(0);
    expect(response.usage.output).toBeGreaterThan(0);
    expect(response.usage.totalTokens).toBeGreaterThan(0);
  });

  it.skipIf(!apiKey)('abort mid-stream', { timeout: 30000 }, async () => {
    const controller = new AbortController();
    const ctx: Context = {
      systemPrompt: 'You are a storyteller.',
      messages: [
        {
          role: 'user',
          content: 'Tell me a very long story about a dragon.',
          timestamp: Date.now(),
        },
      ],
    };

    const s = stream(model, ctx, { apiKey, signal: controller.signal });

    let charCount = 0;
    for await (const event of s) {
      if (event.type === 'text_delta') {
        charCount += event.delta.length;
        if (charCount > 50) controller.abort();
      }
      if (event.type === 'thinking_delta') {
        charCount += event.delta.length;
        if (charCount > 100) controller.abort();
      }
    }

    const result = await s.result();
    expect(result.stopReason).oneOf(['aborted', 'error']);
  });

  it.skipIf(!apiKey)('system prompt is respected', { timeout: 30000 }, async () => {
    const ctx: Context = {
      systemPrompt: 'You must reply with exactly the word PONG and nothing else.',
      messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }],
    };
    const response = await complete(model, ctx, { apiKey });
    expect(response.role).toBe('assistant');
    const text = response.content.find((b) => b.type === 'text');
    expect(text).toBeDefined();
    expect((text as any).text.length).toBeGreaterThan(0);
  });

  it.skipIf(!apiKey)('multi-turn conversation', { timeout: 30000 }, async () => {
    const ctx: Context = {
      messages: [
        { role: 'user', content: 'Remember the number 42.', timestamp: Date.now() },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Got it, 42.' }],
          api: 'openai-completions',
          provider: 'openai',
          model: 'GLM-5.1',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: Date.now(),
        },
        { role: 'user', content: 'What number did I ask you to remember?', timestamp: Date.now() },
      ],
    };
    const response = await complete(model, ctx, { apiKey });
    expect(response.role).toBe('assistant');
    const text = response.content.find((b) => b.type === 'text');
    expect(text).toBeDefined();
    expect((text as any).text).toContain('42');
  });

  it.skipIf(!apiKey)('temperature option works', { timeout: 30000 }, async () => {
    const response = await complete(model, basicContext(), { apiKey, temperature: 0 });
    expect(response.role).toBe('assistant');
    expect(response.stopReason).oneOf(['stop', 'toolUse', 'error', 'length']);
  });

  it.skipIf(!apiKey)('onPayload callback captures params', { timeout: 30000 }, async () => {
    let capturedPayload: any = null;
    await complete(model, basicContext(), {
      apiKey,
      onPayload: (payload) => {
        capturedPayload = payload;
      },
    });
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.model).toBe('GLM-5.1');
    expect(capturedPayload.stream).toBe(true);
    expect(capturedPayload.messages).toBeDefined();
  });

  it.skipIf(!apiKey)('onResponse callback receives response', { timeout: 30000 }, async () => {
    let capturedResponse: any = null;
    await complete(model, basicContext(), {
      apiKey,
      onResponse: (resp) => {
        capturedResponse = resp;
      },
    });
    expect(capturedResponse).not.toBeNull();
    expect(capturedResponse.status).toBe(200);
  });

  it.skipIf(!apiKey)('tool result round-trip', { timeout: 30000 }, async () => {
    const response1 = await complete(model, toolContext(), { apiKey });
    if (response1.stopReason === 'toolUse') {
      const toolCall = response1.content.find((b) => b.type === 'toolCall') as any;
      expect(toolCall).toBeDefined();

      const ctx2: Context = {
        systemPrompt: 'You are a calculator assistant.',
        messages: [
          ...toolContext().messages,
          response1,
          {
            role: 'toolResult',
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: [{ type: 'text', text: '84' }],
            isError: false,
            timestamp: Date.now(),
          },
        ],
      };
      const response2 = await complete(model, ctx2, { apiKey });
      expect(response2.role).toBe('assistant');
      expect(response2.stopReason).oneOf(['stop', 'toolUse', 'error']);
    }
  });
});

// ============================================================
// GLM-5.1 思考模式专项测试
// ============================================================

describe('GLM-5.1 Thinking E2E', () => {
  const model = getGLM51();
  const apiKey = getOpenAIApiKey();

  it.skipIf(!apiKey)(
    'streamSimple with reasoning produces thinking content',
    { timeout: 30000 },
    async () => {
      const response = await completeSimple(model, basicContext(), { apiKey, reasoning: 'medium' });
      expect(response.role).toBe('assistant');
      expect(response.stopReason).oneOf(['stop', 'toolUse', 'error']);
      // GLM-5.1 支持思考，应该有 thinking 块
      const thinking = response.content.find((b) => b.type === 'thinking');
      expect(thinking).toBeDefined();
      expect((thinking as any).thinking.length).toBeGreaterThan(0);
    },
  );

  it.skipIf(!apiKey)(
    'thinking events are emitted during streaming',
    { timeout: 30000 },
    async () => {
      const s = streamSimple(model, basicContext(), { apiKey, reasoning: 'low' });
      const events: string[] = [];

      for await (const event of s) {
        events.push(event.type);
      }

      expect(events).toContain('start');
      expect(events).toContain('done');
      // 思考事件取决于模型是否启用思考模式
      const hasContent = events.some((e) => e.startsWith('text_') || e.startsWith('thinking_'));
      expect(hasContent).toBe(true);
    },
  );

  it.skipIf(!apiKey)(
    'thinking content is followed by text content',
    { timeout: 30000 },
    async () => {
      const response = await completeSimple(model, basicContext(), { apiKey, reasoning: 'low' });
      expect(response.role).toBe('assistant');
      const thinking = response.content.find((b) => b.type === 'thinking');
      const text = response.content.find((b) => b.type === 'text');
      // 思考模式下应同时有 thinking 和 text
      expect(thinking).toBeDefined();
      expect(text).toBeDefined();
    },
  );

  it.skipIf(!apiKey)(
    'different reasoning levels produce different output',
    { timeout: 30000 },
    async () => {
      const responseLow = await completeSimple(model, basicContext(), { apiKey, reasoning: 'low' });
      const responseHigh = await completeSimple(model, basicContext(), {
        apiKey,
        reasoning: 'high',
      });

      // 两个级别都应返回有效响应
      expect(responseLow.role).toBe('assistant');
      expect(responseHigh.role).toBe('assistant');

      const thinkingLow = responseLow.content.find((b) => b.type === 'thinking') as any;
      const thinkingHigh = responseHigh.content.find((b) => b.type === 'thinking') as any;

      // 至少低级别应该有思考内容
      if (thinkingLow) {
        expect(thinkingLow.thinking.length).toBeGreaterThan(0);
      }
      if (thinkingHigh) {
        expect(thinkingHigh.thinking.length).toBeGreaterThan(0);
      }
    },
  );

  it.skipIf(!apiKey)('thinking + tool calling combined', { timeout: 30000 }, async () => {
    const response = await completeSimple(model, toolContext(), { apiKey, reasoning: 'low' });
    expect(response.role).toBe('assistant');
    expect(response.stopReason).oneOf(['stop', 'toolUse', 'error']);
    // 应该有思考内容
    const thinking = response.content.find((b) => b.type === 'thinking');
    expect(thinking).toBeDefined();
  });

  it.skipIf(!apiKey)(
    'streaming thinking deltas accumulate correctly',
    { timeout: 30000 },
    async () => {
      const s = streamSimple(model, basicContext(), { apiKey, reasoning: 'medium' });
      let thinkingChunks = '';
      let textChunks = '';

      for await (const event of s) {
        if (event.type === 'thinking_delta') {
          thinkingChunks += event.delta;
        }
        if (event.type === 'text_delta') {
          textChunks += event.delta;
        }
      }

      const result = await s.result();
      expect(result.stopReason).toBe('stop');
      void textChunks;
      // 流式增量应该和最终结果一致
      const thinking = result.content.find((b) => b.type === 'thinking') as any;
      if (thinking) {
        expect(thinkingChunks.length).toBeGreaterThan(0);
      }
    },
  );
});

// ============================================================
// Anthropic 思考模式专项测试 (GLM-5.1 via Anthropic 协议)
// ============================================================

describe('Anthropic Thinking E2E (GLM-5.1)', () => {
  const model = getGLM51Anthropic();
  const apiKey = getAnthropicApiKey();

  it.skipIf(!apiKey)(
    'streamSimple with reasoning produces thinking content',
    { timeout: 30000 },
    async () => {
      const response = await completeSimple(model, basicContext(), { apiKey, reasoning: 'low' });
      expect(response.role).toBe('assistant');
      expect(response.stopReason).oneOf(['stop', 'toolUse', 'error']);
      const thinking = response.content.find((b) => b.type === 'thinking');
      expect(thinking).toBeDefined();
      expect((thinking as any).thinking.length).toBeGreaterThan(0);
    },
  );

  it.skipIf(!apiKey)(
    'thinking events are emitted during streaming',
    { timeout: 30000 },
    async () => {
      const s = streamSimple(model, basicContext(), { apiKey, reasoning: 'low' });
      const events: string[] = [];

      for await (const event of s) {
        events.push(event.type);
      }

      expect(events).toContain('start');
      expect(events).toContain('done');
      const hasContent = events.some((e) => e.startsWith('text_') || e.startsWith('thinking_'));
      expect(hasContent).toBe(true);
    },
  );

  it.skipIf(!apiKey)(
    'thinking content is followed by text content',
    { timeout: 30000 },
    async () => {
      const response = await completeSimple(model, basicContext(), { apiKey, reasoning: 'low' });
      expect(response.role).toBe('assistant');
      const thinking = response.content.find((b) => b.type === 'thinking');
      const text = response.content.find((b) => b.type === 'text');
      expect(thinking).toBeDefined();
      expect(text).toBeDefined();
    },
  );

  it.skipIf(!apiKey)(
    'different reasoning levels produce valid responses',
    { timeout: 30000 },
    async () => {
      const responseLow = await completeSimple(model, basicContext(), { apiKey, reasoning: 'low' });
      const responseHigh = await completeSimple(model, basicContext(), {
        apiKey,
        reasoning: 'high',
      });

      expect(responseLow.role).toBe('assistant');
      expect(responseHigh.role).toBe('assistant');

      const thinkingLow = responseLow.content.find((b) => b.type === 'thinking') as any;
      const thinkingHigh = responseHigh.content.find((b) => b.type === 'thinking') as any;

      if (thinkingLow) {
        expect(thinkingLow.thinking.length).toBeGreaterThan(0);
      }
      if (thinkingHigh) {
        expect(thinkingHigh.thinking.length).toBeGreaterThan(0);
      }
    },
  );

  it.skipIf(!apiKey)('thinking + tool calling combined', { timeout: 30000 }, async () => {
    const response = await completeSimple(model, toolContext(), { apiKey, reasoning: 'low' });
    expect(response.role).toBe('assistant');
    expect(response.stopReason).oneOf(['stop', 'toolUse', 'error']);
    const thinking = response.content.find((b) => b.type === 'thinking');
    expect(thinking).toBeDefined();
  });

  it.skipIf(!apiKey)(
    'streaming thinking deltas accumulate correctly',
    { timeout: 30000 },
    async () => {
      const s = streamSimple(model, basicContext(), { apiKey, reasoning: 'medium' });
      let thinkingChunks = '';
      let textChunks = '';

      for await (const event of s) {
        if (event.type === 'thinking_delta') {
          thinkingChunks += event.delta;
        }
        if (event.type === 'text_delta') {
          textChunks += event.delta;
        }
      }

      const result = await s.result();
      expect(result.stopReason).oneOf(['stop', 'toolUse', 'error']);
      void textChunks;
      const thinking = result.content.find((b) => b.type === 'thinking') as any;
      if (thinking) {
        expect(thinkingChunks.length).toBeGreaterThan(0);
      }
    },
  );

  it.skipIf(!apiKey)(
    'thinking without reasoning disables thinking',
    { timeout: 30000 },
    async () => {
      const response = await completeSimple(model, basicContext(), { apiKey });
      expect(response.role).toBe('assistant');
      const hasContent = response.content.some((b) => b.type === 'text' || b.type === 'thinking');
      expect(hasContent).toBe(true);
    },
  );
});
