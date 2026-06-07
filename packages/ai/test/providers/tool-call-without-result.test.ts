// ============================================================
// 孤立 tool call 的合成 tool result 补全机制测试
// 验证 transformMessages 中的 orphan tool call 处理
// ============================================================

import { describe, it, expect } from 'vitest';
import { transformMessages } from '../../src/providers/transform-messages';
import type {
  AssistantMessage,
  Message,
  Model,
  TextContent,
  ToolCall,
  ToolResultMessage,
} from '../../src/types';

// ---------- 辅助 ----------

function makeModel(
  overrides: Partial<Model<'anthropic-messages'>> = {},
): Model<'anthropic-messages'> {
  return {
    id: 'test-model',
    name: 'Test Model',
    api: 'anthropic-messages' as const,
    provider: 'anthropic',
    baseUrl: 'https://api.test/v1',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096,
    maxTokens: 1024,
    ...overrides,
  } as Model<'anthropic-messages'>;
}

function makeToolCall(id: string, name: string, args: Record<string, unknown> = {}): ToolCall {
  return { type: 'toolCall', id, name, arguments: args };
}

function makeToolResult(
  toolCallId: string,
  toolName: string,
  text: string,
  isError = false,
): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId,
    toolName,
    content: [{ type: 'text', text }],
    isError,
    timestamp: Date.now(),
  };
}

// ---------- 测试 ----------

describe('orphan tool call handling in transformMessages', () => {
  it('inserts synthetic tool result for orphaned tool call', () => {
    const model = makeModel();
    const messages: Message[] = [
      { role: 'user', content: 'Use the tool', timestamp: Date.now() },
      {
        role: 'assistant',
        content: [makeToolCall('tc-orphan', 'read_file')],
        api: 'anthropic-messages',
        provider: 'anthropic',
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
      // 注意：没有 toolResult
    ];

    const result = transformMessages(messages, model);
    const lastMsg = result[result.length - 1] as ToolResultMessage;
    expect(lastMsg.role).toBe('toolResult');
    expect(lastMsg.toolCallId).toBe('tc-orphan');
  });

  it('synthetic tool result has isError=true', () => {
    const model = makeModel();
    const messages: Message[] = [
      { role: 'user', content: 'Go', timestamp: Date.now() },
      {
        role: 'assistant',
        content: [makeToolCall('tc-1', 'search')],
        api: 'anthropic-messages',
        provider: 'anthropic',
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
    ];

    const result = transformMessages(messages, model);
    const toolResult = result.find((m) => m.role === 'toolResult') as ToolResultMessage;
    expect(toolResult).toBeDefined();
    expect(toolResult.isError).toBe(true);
  });

  it('synthetic tool result contains "No result provided"', () => {
    const model = makeModel();
    const messages: Message[] = [
      { role: 'user', content: 'Go', timestamp: Date.now() },
      {
        role: 'assistant',
        content: [makeToolCall('tc-1', 'search')],
        api: 'anthropic-messages',
        provider: 'anthropic',
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
    ];

    const result = transformMessages(messages, model);
    const toolResult = result.find((m) => m.role === 'toolResult') as ToolResultMessage;
    const textContent = toolResult.content[0] as TextContent;
    expect(textContent.text).toBe('No result provided');
  });

  it('does not insert synthetic result when tool result exists', () => {
    const model = makeModel();
    const messages: Message[] = [
      { role: 'user', content: 'Go', timestamp: Date.now() },
      {
        role: 'assistant',
        content: [makeToolCall('tc-1', 'search')],
        api: 'anthropic-messages',
        provider: 'anthropic',
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
      makeToolResult('tc-1', 'search', 'search results'),
    ];

    const result = transformMessages(messages, model);
    // 不应有额外的合成 toolResult
    const toolResults = result.filter((m) => m.role === 'toolResult') as ToolResultMessage[];
    expect(toolResults.length).toBe(1);
    expect((toolResults[0].content[0] as TextContent).text).toBe('search results');
  });

  it('handles multiple orphaned tool calls', () => {
    const model = makeModel();
    const messages: Message[] = [
      { role: 'user', content: 'Go', timestamp: Date.now() },
      {
        role: 'assistant',
        content: [makeToolCall('tc-1', 'search'), makeToolCall('tc-2', 'read_file')],
        api: 'anthropic-messages',
        provider: 'anthropic',
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
    ];

    const result = transformMessages(messages, model);
    const toolResults = result.filter((m) => m.role === 'toolResult') as ToolResultMessage[];
    // 两个孤立的 toolCall → 两个合成 toolResult
    expect(toolResults.length).toBe(2);
    expect(toolResults.every((t) => t.isError)).toBe(true);
    expect(toolResults.some((t) => t.toolCallId === 'tc-1')).toBe(true);
    expect(toolResults.some((t) => t.toolCallId === 'tc-2')).toBe(true);
  });
});
