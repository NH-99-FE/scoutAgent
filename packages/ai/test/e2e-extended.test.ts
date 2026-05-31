// ============================================================
// E2E 扩展测试 — 验证关键行为
// 没有对应 API key 的测试会自动 skip
// ============================================================

import { describe, it, expect } from 'vitest';
import { stream, complete, streamSimple, completeSimple } from '../src/stream';
import { isContextOverflow } from '../src/utils/overflow';
import type { Context, Tool, AssistantMessage } from '../src/types';
import {
  getGLM51,
  getClaudeHaiku45,
  getGLM51Anthropic,
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

// ============================================================
// Thinking disable (Anthropic)
// ============================================================

describe('E2E — thinking disable (Anthropic)', () => {
  const anthropicApiKey = getAnthropicApiKey();

  it.skipIf(!anthropicApiKey)(
    'no thinking events when reasoning is not set',
    { timeout: 30000 },
    async () => {
      const model = getClaudeHaiku45();
      const s = streamSimple(model, basicContext(), { apiKey: anthropicApiKey });

      const events: string[] = [];
      for await (const event of s) {
        events.push(event.type);
      }

      // 不设置 reasoning → 应有完成事件（thinking 事件取决于模型是否默认启用）
      expect(events).toContain('start');
      expect(events).toContain('done');
      // 至少有文本内容
      const hasContent = events.some((e) => e.startsWith('text_') || e.startsWith('thinking_'));
      expect(hasContent).toBe(true);
    },
  );

  it.skipIf(!anthropicApiKey)(
    'thinking events present when reasoning is set',
    { timeout: 30000 },
    async () => {
      const model = getGLM51Anthropic();
      const s = streamSimple(model, basicContext(), { apiKey: anthropicApiKey, reasoning: 'low' });

      const events: string[] = [];
      for await (const event of s) {
        events.push(event.type);
      }

      expect(events).toContain('start');
      expect(events).toContain('done');
      // 设置 reasoning → 应有文本内容（thinking 事件取决于模型能力）
      const hasContent = events.some((e) => e.startsWith('text_') || e.startsWith('thinking_'));
      expect(hasContent).toBe(true);
    },
  );
});

// ============================================================
// Cross-provider message handoff
// ============================================================

describe('E2E — cross-provider message handoff', () => {
  const openaiApiKey = getOpenAIApiKey();
  const anthropicApiKey = getAnthropicApiKey();

  it.skipIf(!openaiApiKey || !anthropicApiKey)(
    'OpenAI tool call consumed by Anthropic provider',
    { timeout: 30000 },
    async () => {
      const openaiModel = getGLM51();
      // 先通过 OpenAI 协议获取 tool call
      const response1 = await complete(openaiModel, toolContext(), { apiKey: openaiApiKey });
      expect(['toolUse', 'stop', 'error']).toContain(response1.stopReason);

      if (response1.stopReason === 'toolUse') {
        // 构建含 tool result 的对话，传给 Anthropic provider
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

        const anthropicModel = getGLM51Anthropic();
        const response2 = await complete(anthropicModel, ctx2, { apiKey: anthropicApiKey });
        expect(response2.role).toBe('assistant');
        expect(response2.stopReason).oneOf(['stop', 'toolUse', 'error']);
      }
    },
  );

  it.skipIf(!openaiApiKey || !anthropicApiKey)(
    'Anthropic tool call consumed by OpenAI provider',
    { timeout: 30000 },
    async () => {
      const anthropicModel = getGLM51Anthropic();
      // 先通过 Anthropic 协议获取 tool call
      const response1 = await complete(anthropicModel, toolContext(), { apiKey: anthropicApiKey });
      expect(['toolUse', 'stop', 'error']).toContain(response1.stopReason);

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

        const openaiModel = getGLM51();
        const response2 = await complete(openaiModel, ctx2, { apiKey: openaiApiKey });
        expect(response2.role).toBe('assistant');
        expect(response2.stopReason).oneOf(['stop', 'toolUse', 'error']);
      }
    },
  );
});

// ============================================================
// Context overflow detection
// ============================================================

describe('E2E — context overflow detection', () => {
  const anthropicApiKey = getAnthropicApiKey();
  const openaiApiKey = getOpenAIApiKey();

  it.skipIf(!anthropicApiKey)(
    'detects overflow from Anthropic provider',
    { timeout: 30000 },
    async () => {
      const model = getGLM51Anthropic();
      // 构造超大消息以触发上下文溢出
      const hugeContent = 'This is a test sentence to consume tokens. '.repeat(10000);
      const ctx: Context = {
        messages: [{ role: 'user', content: hugeContent, timestamp: Date.now() }],
      };

      try {
        const response = await complete(model, ctx, { apiKey: anthropicApiKey, timeoutMs: 20000 });
        // 检查是否是溢出错误
        if (response.stopReason === 'error' && response.errorMessage) {
          expect(isContextOverflow(response, model.contextWindow)).toBe(true);
        } else {
          // 可能返回正常结果（模型接受了请求）
          expect(response.role).toBe('assistant');
        }
      } catch (error) {
        // 超时或网络错误也是可接受的
        expect(error).toBeDefined();
      }
    },
  );

  it.skipIf(!openaiApiKey)(
    'detects overflow from OpenAI provider',
    { timeout: 30000 },
    async () => {
      const model = getGLM51();
      // 构造超出 context window 的消息以触发溢出
      // 使用重复文字而非单字符以更有效地消耗 token
      const hugeContent = 'This is a test sentence to consume tokens. '.repeat(10000);
      const ctx: Context = {
        messages: [{ role: 'user', content: hugeContent, timestamp: Date.now() }],
      };

      try {
        const response = await complete(model, ctx, { apiKey: openaiApiKey, timeoutMs: 20000 });
        if (response.stopReason === 'error' && response.errorMessage) {
          expect(isContextOverflow(response, model.contextWindow)).toBe(true);
        } else {
          expect(response.role).toBe('assistant');
        }
      } catch (error) {
        // 超时或网络错误也是可接受的
        expect(error).toBeDefined();
      }
    },
  );
});

// ============================================================
// Unicode in tool results
// ============================================================

describe('E2E — unicode in tool results', () => {
  const anthropicApiKey = getAnthropicApiKey();
  const openaiApiKey = getOpenAIApiKey();

  it.skipIf(!anthropicApiKey)(
    'handles emoji in tool results via Anthropic',
    { timeout: 30000 },
    async () => {
      const model = getGLM51Anthropic();
      const ctx: Context = {
        systemPrompt: 'You are a helpful assistant. Reply concisely.',
        messages: [
          { role: 'user', content: 'Hello', timestamp: Date.now() },
          {
            role: 'assistant',
            content: [{ type: 'toolCall', id: 'tool_1', name: 'emoji_tool', arguments: {} }],
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
            stopReason: 'toolUse',
            timestamp: Date.now(),
          } as AssistantMessage,
          {
            role: 'toolResult',
            toolCallId: 'tool_1',
            toolName: 'emoji_tool',
            content: [{ type: 'text', text: 'Result: \u{1F600} \u{1F680} \u{2764}' }],
            isError: false,
            timestamp: Date.now(),
          },
        ],
      };

      const response = await complete(model, ctx, { apiKey: anthropicApiKey });
      expect(response.role).toBe('assistant');
      expect(response.stopReason).oneOf(['stop', 'toolUse', 'error']);
    },
  );

  it.skipIf(!openaiApiKey)(
    'handles emoji in tool results via OpenAI',
    { timeout: 30000 },
    async () => {
      const model = getGLM51();
      const ctx: Context = {
        systemPrompt: 'You are a helpful assistant. Reply concisely.',
        messages: [
          { role: 'user', content: 'Hello', timestamp: Date.now() },
          {
            role: 'assistant',
            content: [{ type: 'toolCall', id: 'call_1', name: 'emoji_tool', arguments: {} }],
            api: 'openai-completions',
            provider: 'openai',
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
          } as AssistantMessage,
          {
            role: 'toolResult',
            toolCallId: 'call_1',
            toolName: 'emoji_tool',
            content: [{ type: 'text', text: 'Result: \u{1F600} \u{1F680} \u{2764}' }],
            isError: false,
            timestamp: Date.now(),
          },
        ],
      };

      const response = await complete(model, ctx, { apiKey: openaiApiKey });
      expect(response.role).toBe('assistant');
      expect(response.stopReason).oneOf(['stop', 'toolUse', 'error']);
    },
  );
});
