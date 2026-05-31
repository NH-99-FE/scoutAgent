// ============================================================
// openai-completions convertMessages 测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { convertMessages } from '../../src/providers/openai-completions';
import type {
  Api,
  Context,
  ImageContent,
  Message,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
} from '../../src/types';

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
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096,
    maxTokens: 1024,
    ...overrides,
  };
}

// 默认 compat
const defaultCompat = {
  supportsStore: true,
  supportsDeveloperRole: true,
  supportsReasoningEffort: true,
  supportsUsageInStreaming: true,
  maxTokensField: 'max_completion_tokens' as const,
  requiresToolResultName: false,
  requiresAssistantAfterToolResult: false,
  requiresThinkingAsText: false,
  requiresReasoningContentOnAssistantMessages: false,
  thinkingFormat: 'openai' as const,
  openRouterRouting: {},
  vercelGatewayRouting: {},
  zaiToolStream: false,
  supportsStrictMode: true,
  supportsLongCacheRetention: true,
  sendSessionAffinityHeaders: false,
  cacheControlFormat: undefined,
};

// ---------- systemPrompt ----------

describe('convertMessages — systemPrompt', () => {
  it('uses developer role for reasoning models with supportsDeveloperRole', () => {
    const model = makeModel({ reasoning: true });
    const ctx: Context = { systemPrompt: 'You are helpful.', messages: [] };
    const result = convertMessages(model, ctx, defaultCompat);
    expect(result[0].role).toBe('developer');
    expect((result[0] as any).content).toBe('You are helpful.');
  });

  it('uses system role for non-reasoning models', () => {
    const model = makeModel({ reasoning: false });
    const ctx: Context = { systemPrompt: 'You are helpful.', messages: [] };
    const result = convertMessages(model, ctx, defaultCompat);
    expect(result[0].role).toBe('system');
  });

  it('uses system role when supportsDeveloperRole is false', () => {
    const model = makeModel({ reasoning: true });
    const ctx: Context = { systemPrompt: 'You are helpful.', messages: [] };
    const result = convertMessages(model, ctx, { ...defaultCompat, supportsDeveloperRole: false });
    expect(result[0].role).toBe('system');
  });

  it('omits system message when no systemPrompt', () => {
    const model = makeModel();
    const ctx: Context = { messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }] };
    const result = convertMessages(model, ctx, defaultCompat);
    expect(result[0].role).toBe('user');
  });
});

// ---------- user messages ----------

describe('convertMessages — user messages', () => {
  it('converts string content', () => {
    const model = makeModel();
    const ctx: Context = { messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }] };
    const result = convertMessages(model, ctx, defaultCompat);
    expect(result[0]).toEqual({ role: 'user', content: 'hello' });
  });

  it('converts multimodal content with images', () => {
    const model = makeModel();
    const ctx: Context = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'See this' } as TextContent,
            { type: 'image', data: 'base64data', mimeType: 'image/png' } as ImageContent,
          ],
          timestamp: Date.now(),
        },
      ],
    };
    const result = convertMessages(model, ctx, defaultCompat);
    const content = (result[0] as any).content as any[];
    expect(content[0].type).toBe('text');
    expect(content[1].type).toBe('image_url');
    expect(content[1].image_url.url).toContain('data:image/png;base64,base64data');
  });
});

// ---------- assistant messages ----------

describe('convertMessages — assistant messages', () => {
  it('converts text content', () => {
    const model = makeModel();
    const ctx: Context = {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello world' }],
          api: 'openai-completions',
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
          stopReason: 'stop',
          timestamp: Date.now(),
        },
      ],
    };
    const result = convertMessages(model, ctx, defaultCompat);
    expect(result[0].role).toBe('assistant');
    expect((result[0] as any).content).toBe('Hello world');
  });

  it('converts tool calls', () => {
    const model = makeModel();
    const toolCall: ToolCall = {
      type: 'toolCall',
      id: 'call_1',
      name: 'read_file',
      arguments: { path: '/tmp/test' },
    };
    const ctx: Context = {
      messages: [
        {
          role: 'assistant',
          content: [toolCall],
          api: 'openai-completions',
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
        },
      ],
    };
    const result = convertMessages(model, ctx, defaultCompat);
    const assistant = result[0] as any;
    expect(assistant.tool_calls).toBeDefined();
    expect(assistant.tool_calls[0].id).toBe('call_1');
    expect(assistant.tool_calls[0].function.name).toBe('read_file');
    expect(assistant.tool_calls[0].function.arguments).toBe('{"path":"/tmp/test"}');
  });

  it('sends thinking via reasoning_content when requiresThinkingAsText is false', () => {
    const model = makeModel();
    const thinking: ThinkingContent = { type: 'thinking', thinking: 'Let me think...' };
    const ctx: Context = {
      messages: [
        {
          role: 'assistant',
          content: [thinking, { type: 'text', text: 'Answer' }],
          api: 'openai-completions',
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
          stopReason: 'stop',
          timestamp: Date.now(),
        },
      ],
    };
    const result = convertMessages(model, ctx, defaultCompat);
    const assistant = result[0] as any;
    expect(assistant.content).toBe('Answer');
    // reasoning_content is set via thinkingSignature field
    expect(assistant.reasoning_content).toBe('Let me think...');
  });

  it('sends thinking as text when requiresThinkingAsText is true', () => {
    const model = makeModel();
    const thinking: ThinkingContent = { type: 'thinking', thinking: 'Let me think...' };
    const ctx: Context = {
      messages: [
        {
          role: 'assistant',
          content: [thinking, { type: 'text', text: 'Answer' }],
          api: 'openai-completions',
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
          stopReason: 'stop',
          timestamp: Date.now(),
        },
      ],
    };
    const result = convertMessages(model, ctx, { ...defaultCompat, requiresThinkingAsText: true });
    const assistant = result[0] as any;
    // Content should be array with thinking text and answer
    expect(Array.isArray(assistant.content)).toBe(true);
    expect(assistant.content[0].text).toBe('Let me think...');
  });

  it('skips empty assistant messages', () => {
    const model = makeModel();
    const ctx: Context = {
      messages: [
        { role: 'user', content: 'hi', timestamp: Date.now() },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '   ' }], // whitespace only
          api: 'openai-completions',
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
          stopReason: 'stop',
          timestamp: Date.now(),
        },
      ],
    };
    const result = convertMessages(model, ctx, defaultCompat);
    // Only the user message should remain
    expect(result.length).toBe(1);
    expect(result[0].role).toBe('user');
  });
});

// ---------- toolResult messages ----------

describe('convertMessages — toolResult messages', () => {
  it('converts tool results', () => {
    const model = makeModel();
    const ctx: Context = {
      messages: [
        {
          role: 'toolResult',
          toolCallId: 'call_1',
          toolName: 'read_file',
          content: [{ type: 'text', text: 'file content' }],
          isError: false,
          timestamp: Date.now(),
        },
      ],
    };
    const result = convertMessages(model, ctx, defaultCompat);
    expect(result[0].role).toBe('tool');
    expect((result[0] as any).tool_call_id).toBe('call_1');
    expect((result[0] as any).content).toBe('file content');
  });

  it('includes tool name when requiresToolResultName is true', () => {
    const model = makeModel();
    const ctx: Context = {
      messages: [
        {
          role: 'toolResult',
          toolCallId: 'call_1',
          toolName: 'read_file',
          content: [{ type: 'text', text: 'file content' }],
          isError: false,
          timestamp: Date.now(),
        },
      ],
    };
    const result = convertMessages(model, ctx, { ...defaultCompat, requiresToolResultName: true });
    expect((result[0] as any).name).toBe('read_file');
  });

  it('converts consecutive tool results', () => {
    const model = makeModel();
    const ctx: Context = {
      messages: [
        {
          role: 'toolResult',
          toolCallId: 'call_1',
          toolName: 'a',
          content: [{ type: 'text', text: 'result 1' }],
          isError: false,
          timestamp: Date.now(),
        },
        {
          role: 'toolResult',
          toolCallId: 'call_2',
          toolName: 'b',
          content: [{ type: 'text', text: 'result 2' }],
          isError: false,
          timestamp: Date.now(),
        },
      ],
    };
    const result = convertMessages(model, ctx, defaultCompat);
    expect(result.length).toBe(2);
    expect(result.every((m) => m.role === 'tool')).toBe(true);
  });
});
