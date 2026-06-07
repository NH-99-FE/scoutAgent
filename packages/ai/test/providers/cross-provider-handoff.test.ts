// ============================================================
// 跨 provider 消息交接测试
// 验证 OpenAI 生成的消息可被 Anthropic 消费，反之亦然
// ============================================================

import { describe, it, expect } from 'vitest';
import type { AssistantMessage, Message, Model, TextContent, ToolCall } from '../../src/types';

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
    thinkingLevelMap: { off: null, minimal: 'low', low: 'low', medium: 'medium', high: 'high' },
    input: ['text', 'image'],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
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
    thinkingLevelMap: { off: null, minimal: 'low', low: 'low', medium: 'medium', high: 'high' },
    input: ['text', 'image'],
    cost: { input: 5, output: 15, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
    ...overrides,
  };
}

function makeOpenAIAssistantWithToolCall(toolCallId: string, toolName: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [
      { type: 'text', text: 'I will use the tool.' },
      { type: 'toolCall', id: toolCallId, name: toolName, arguments: { q: 'hello' } },
    ],
    api: 'openai-completions',
    provider: 'openai',
    model: 'gpt-test',
    usage: {
      input: 100,
      output: 50,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 150,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'toolUse',
    timestamp: Date.now(),
  };
}

function makeAnthropicAssistantWithToolCall(
  toolCallId: string,
  toolName: string,
): AssistantMessage {
  return {
    role: 'assistant',
    content: [
      { type: 'text', text: 'I will use the tool.' },
      { type: 'toolCall', id: toolCallId, name: toolName, arguments: { q: 'hello' } },
    ],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-test',
    usage: {
      input: 100,
      output: 50,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 150,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'toolUse',
    timestamp: Date.now(),
  };
}

// ---------- 测试 ----------

describe('Cross-provider message handoff', () => {
  it('OpenAI assistant with toolCall converts to Anthropic format', async () => {
    // convertMessages 在 anthropic.ts 中不是 exported，需要通过 buildParams 间接测试
    // 实际上通过 streamAnthropic 的 onPayload 捕获 messages 来测试
    // 但这里我们可以用 transformMessages 来测试消息变换
    const { transformMessages } = await import('../../src/providers/transform-messages');

    const anthropicModel = makeAnthropicModel();
    const openaiAssistant = makeOpenAIAssistantWithToolCall('call_abc123', 'read_file');
    const messages: Message[] = [
      { role: 'user', content: 'Use the tool', timestamp: Date.now() },
      openaiAssistant,
    ];

    // transformMessages 应该规范化跨 provider 的 tool call ID
    const result = transformMessages(messages, anthropicModel, (id) =>
      id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
    );

    const assistant = result.find((m) => m.role === 'assistant') as AssistantMessage;
    expect(assistant).toBeDefined();
    const toolCall = assistant.content.find((b) => b.type === 'toolCall') as ToolCall;
    expect(toolCall).toBeDefined();
    expect(toolCall.id).toBe('call_abc123');
    expect(toolCall.name).toBe('read_file');
  });

  it('Anthropic assistant with toolCall converts to OpenAI format', async () => {
    const { transformMessages } = await import('../../src/providers/transform-messages');

    const openaiModel = makeOpenAIModel();
    const anthropicAssistant = makeAnthropicAssistantWithToolCall('toolu_abc123', 'read_file');
    const messages: Message[] = [
      { role: 'user', content: 'Use the tool', timestamp: Date.now() },
      anthropicAssistant,
    ];

    const result = transformMessages(messages, openaiModel, (id) => {
      // OpenAI provider 的 normalizeToolCallId 逻辑
      if (id.includes('|')) {
        const [callId] = id.split('|');
        return callId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
      }
      if (openaiModel.provider === 'openai') return id.length > 40 ? id.slice(0, 40) : id;
      return id;
    });

    const assistant = result.find((m) => m.role === 'assistant') as AssistantMessage;
    expect(assistant).toBeDefined();
    const toolCall = assistant.content.find((b) => b.type === 'toolCall') as ToolCall;
    expect(toolCall).toBeDefined();
    expect(toolCall.id).toBe('toolu_abc123');
  });

  it('toolCall IDs are normalized when crossing providers', async () => {
    const { transformMessages } = await import('../../src/providers/transform-messages');

    const anthropicModel = makeAnthropicModel();
    // OpenAI 风格的 ID 含特殊字符
    const openaiAssistant: AssistantMessage = {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'call_abc!!!@#', name: 'read_file', arguments: {} }],
      api: 'openai-completions',
      provider: 'openai',
      model: 'gpt-test',
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
    };
    const toolResult: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: 'call_abc!!!@#',
      toolName: 'read_file',
      content: [{ type: 'text', text: 'result' }],
      isError: false,
      timestamp: Date.now(),
    };

    const messages: Message[] = [
      { role: 'user', content: 'Go', timestamp: Date.now() },
      openaiAssistant,
      toolResult,
    ];

    const result = transformMessages(messages, anthropicModel, (id) =>
      id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
    );

    // assistant 的 toolCall ID 应被规范化
    const assistant = result.find((m) => m.role === 'assistant') as AssistantMessage;
    const toolCall = assistant.content.find((b) => b.type === 'toolCall') as ToolCall;
    expect(toolCall.id).toBe('call_abc_____');

    // toolResult 的 toolCallId 也应被同步更新
    const toolResultMsg = result.find((m) => m.role === 'toolResult') as ToolResultMessage;
    expect(toolResultMsg.toolCallId).toBe('call_abc_____');
  });

  it('thinking blocks convert to text when crossing providers', async () => {
    const { transformMessages } = await import('../../src/providers/transform-messages');

    const openaiModel = makeOpenAIModel();
    const anthropicAssistant: AssistantMessage = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Let me reason about this...', thinkingSignature: 'sig123' },
        { type: 'text', text: 'The answer is 42.' },
      ],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'claude-test',
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
    };

    const messages: Message[] = [anthropicAssistant];
    const result = transformMessages(messages, openaiModel);

    const assistant = result[0] as AssistantMessage;
    // thinking 块在跨 provider 时应转为 text
    expect(assistant.content.every((b) => b.type === 'text')).toBe(true);
    const thinkingAsText = assistant.content.find(
      (b) => (b as TextContent).text === 'Let me reason about this...',
    ) as TextContent;
    expect(thinkingAsText).toBeDefined();
  });

  it('redacted thinking is removed when crossing to different provider', async () => {
    const { transformMessages } = await import('../../src/providers/transform-messages');

    const openaiModel = makeOpenAIModel();
    const anthropicAssistant: AssistantMessage = {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking: '[hidden]',
          thinkingSignature: 'encrypted-data',
          redacted: true,
        },
        { type: 'text', text: 'Answer.' },
      ],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'claude-test',
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
    };

    const messages: Message[] = [anthropicAssistant];
    const result = transformMessages(messages, openaiModel);

    const assistant = result[0] as AssistantMessage;
    // redacted thinking 在跨 provider 时应被丢弃
    expect(assistant.content.length).toBe(1);
    expect(assistant.content[0].type).toBe('text');
  });

  it('complete round-trip: Anthropic -> OpenAI -> Anthropic', async () => {
    const { transformMessages } = await import('../../src/providers/transform-messages');

    const normalizeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

    // 初始对话（Anthropic provider 生成）
    const originalMessages: Message[] = [
      { role: 'user', content: 'Use the tool', timestamp: Date.now() },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will use the tool.' },
          {
            type: 'toolCall',
            id: 'toolu_abc123',
            name: 'read_file',
            arguments: { path: '/tmp/test.txt' },
          },
        ],
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: 'claude-test',
        usage: {
          input: 100,
          output: 50,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 150,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'toolUse',
        timestamp: Date.now(),
      } as AssistantMessage,
      {
        role: 'toolResult',
        toolCallId: 'toolu_abc123',
        toolName: 'read_file',
        content: [{ type: 'text', text: 'file content here' }],
        isError: false,
        timestamp: Date.now(),
      } as ToolResultMessage,
    ];

    // 第一次转换：Anthropic -> OpenAI
    const openaiModel = makeOpenAIModel();
    const afterOpenAI = transformMessages(originalMessages, openaiModel, normalizeId);

    // 验证结构完整
    expect(afterOpenAI.length).toBe(3);
    const assistantAfterOpenAI = afterOpenAI[1] as AssistantMessage;
    const toolCallAfterOpenAI = assistantAfterOpenAI.content.find(
      (b) => b.type === 'toolCall',
    ) as ToolCall;
    expect(toolCallAfterOpenAI).toBeDefined();
    expect(toolCallAfterOpenAI.id).toBe('toolu_abc123');

    // 第二次转换：OpenAI -> Anthropic
    const anthropicModel = makeAnthropicModel();
    const afterAnthropic = transformMessages(afterOpenAI, anthropicModel, normalizeId);

    // 验证双次转换后结构完整
    expect(afterAnthropic.length).toBe(3);
    const assistantAfterRoundTrip = afterAnthropic[1] as AssistantMessage;
    const toolCallAfterRoundTrip = assistantAfterRoundTrip.content.find(
      (b) => b.type === 'toolCall',
    ) as ToolCall;
    expect(toolCallAfterRoundTrip).toBeDefined();
    expect(toolCallAfterRoundTrip.id).toBe('toolu_abc123');
    expect(toolCallAfterRoundTrip.name).toBe('read_file');
    expect(toolCallAfterRoundTrip.arguments).toEqual({ path: '/tmp/test.txt' });

    // toolResult 也应保留
    const toolResultAfterRoundTrip = afterAnthropic[2] as ToolResultMessage;
    expect(toolResultAfterRoundTrip.toolCallId).toBe('toolu_abc123');
    expect((toolResultAfterRoundTrip.content[0] as TextContent).text).toBe('file content here');
  });
});
