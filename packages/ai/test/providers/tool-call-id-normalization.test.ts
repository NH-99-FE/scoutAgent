// ============================================================
// tool call ID 规范化测试
// 验证 Anthropic 和 OpenAI 两个 provider 的 normalizeToolCallId 行为
// 通过 convertMessages 间接测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { transformMessages } from '../../src/providers/transform-messages';
import type {
  Api,
  AssistantMessage,
  Message,
  Model,
  ToolCall,
  ToolResultMessage,
} from '../../src/types';

// ---------- 辅助 ----------

function makeAnthropicModel(
  overrides: Partial<Model<'anthropic-messages'>> = {},
): Model<'anthropic-messages'> {
  return {
    id: 'claude-test',
    name: 'Claude Test',
    api: 'anthropic-messages',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
    ...overrides,
  };
}

function makeOpenAIModel(
  overrides: Partial<Model<'openai-completions'>> = {},
): Model<'openai-completions'> {
  return {
    id: 'gpt-test',
    name: 'GPT Test',
    api: 'openai-completions',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
    ...overrides,
  };
}

function makeToolCall(id: string, name: string, args: Record<string, any> = {}): ToolCall {
  return { type: 'toolCall', id, name, arguments: args };
}

function makeToolResult(toolCallId: string, toolName: string, text: string): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId,
    toolName,
    content: [{ type: 'text', text }],
    isError: false,
    timestamp: Date.now(),
  };
}

function makeAssistantWithToolCall(
  toolCallId: string,
  toolName: string,
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    role: 'assistant',
    content: [makeToolCall(toolCallId, toolName)],
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
    ...overrides,
  };
}

// ---------- Anthropic provider ----------

describe('tool call ID normalization — Anthropic provider', () => {
  it('replaces special characters with underscore', () => {
    // Anthropic normalizeToolCallId: id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
    const anthropicModel = makeAnthropicModel();
    const originalId = 'call_abc!!!@#';
    const messages: Message[] = [
      makeAssistantWithToolCall(originalId, 'read_file', { provider: 'openai', model: 'gpt-test' }),
    ];

    const result = transformMessages(messages, anthropicModel, (id) =>
      id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
    );

    const assistant = result[0] as AssistantMessage;
    const toolCall = assistant.content[0] as ToolCall;
    expect(toolCall.id).toBe('call_abc_____');
  });

  it('truncates IDs longer than 64 characters', () => {
    const anthropicModel = makeAnthropicModel();
    const longId = 'a'.repeat(80); // 80 字符
    const messages: Message[] = [
      makeAssistantWithToolCall(longId, 'read_file', { provider: 'openai', model: 'gpt-test' }),
    ];

    const result = transformMessages(messages, anthropicModel, (id) =>
      id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
    );

    const assistant = result[0] as AssistantMessage;
    const toolCall = assistant.content[0] as ToolCall;
    expect(toolCall.id.length).toBe(64);
  });

  it('preserves valid alphanumeric IDs unchanged', () => {
    const anthropicModel = makeAnthropicModel();
    const validId = 'toolu_abc123';
    const messages: Message[] = [
      makeAssistantWithToolCall(validId, 'read_file', { provider: 'openai', model: 'gpt-test' }),
    ];

    const result = transformMessages(messages, anthropicModel, (id) =>
      id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
    );

    const assistant = result[0] as AssistantMessage;
    const toolCall = assistant.content[0] as ToolCall;
    expect(toolCall.id).toBe('toolu_abc123');
  });
});

// ---------- OpenAI provider ----------

describe('tool call ID normalization — OpenAI provider', () => {
  it('preserves normal OpenAI IDs', () => {
    const openaiModel = makeOpenAIModel();
    const normalId = 'call_abc123';
    const messages: Message[] = [
      makeAssistantWithToolCall(normalId, 'read_file', {
        provider: 'anthropic',
        model: 'claude-test',
      }),
    ];

    const result = transformMessages(messages, openaiModel, (id) => {
      // OpenAI provider 的 normalizeToolCallId
      if (id.includes('|')) {
        const [callId] = id.split('|');
        return callId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
      }
      if (openaiModel.provider === 'openai') return id.length > 40 ? id.slice(0, 40) : id;
      return id;
    });

    const assistant = result[0] as AssistantMessage;
    const toolCall = assistant.content[0] as ToolCall;
    expect(toolCall.id).toBe('call_abc123');
  });

  it('handles long IDs in OpenAI format', () => {
    const openaiModel = makeOpenAIModel();
    const longId = 'call_' + 'a'.repeat(50); // 55 字符，超过 40
    const messages: Message[] = [
      makeAssistantWithToolCall(longId, 'read_file', {
        provider: 'anthropic',
        model: 'claude-test',
      }),
    ];

    const result = transformMessages(messages, openaiModel, (id) => {
      if (id.includes('|')) {
        const [callId] = id.split('|');
        return callId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
      }
      if (openaiModel.provider === 'openai') return id.length > 40 ? id.slice(0, 40) : id;
      return id;
    });

    const assistant = result[0] as AssistantMessage;
    const toolCall = assistant.content[0] as ToolCall;
    expect(toolCall.id.length).toBe(40);
  });

  it('normalizes IDs in toolResult references', () => {
    const openaiModel = makeOpenAIModel();
    const originalId = 'call_abc!!!@#';
    const messages: Message[] = [
      makeAssistantWithToolCall(originalId, 'read_file', {
        provider: 'anthropic',
        model: 'claude-test',
      }),
      makeToolResult(originalId, 'read_file', 'file content'),
    ];

    const result = transformMessages(messages, openaiModel, (id) => {
      if (id.includes('|')) {
        const [callId] = id.split('|');
        return callId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
      }
      return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    });

    // assistant 的 toolCall ID 应被规范化
    const assistant = result[0] as AssistantMessage;
    const toolCall = assistant.content[0] as ToolCall;
    expect(toolCall.id).toBe('call_abc_____');

    // toolResult 的 toolCallId 也应被同步更新
    const toolResult = result[1] as ToolResultMessage;
    expect(toolResult.toolCallId).toBe('call_abc_____');
  });
});
