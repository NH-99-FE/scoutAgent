// ============================================================
// transform-messages 测试 — 跨供应商消息变换
// ============================================================

import { describe, it, expect } from 'vitest';
import { transformMessages } from '../../src/providers/transform-messages';
import type {
  Api,
  AssistantMessage,
  ImageContent,
  Message,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from '../../src/types';

// ---------- 辅助函数 ----------

function makeModel<TApi extends Api>(overrides: Partial<Model<TApi>> = {}): Model<TApi> {
  return {
    id: 'test-model',
    name: 'Test Model',
    api: 'anthropic-messages' as TApi,
    provider: 'anthropic',
    baseUrl: 'https://api.test/v1',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096,
    maxTokens: 1024,
    ...overrides,
  } as Model<TApi>;
}

function makeUserMessage(content: string | (TextContent | ImageContent)[]): UserMessage {
  return { role: 'user', content, timestamp: Date.now() };
}

function makeAssistantMessage(
  content: AssistantMessage['content'],
  overrides?: Partial<AssistantMessage>,
): AssistantMessage {
  return {
    role: 'assistant',
    content,
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
    stopReason: 'stop',
    timestamp: Date.now(),
    ...overrides,
  };
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

// ---------- 图片降级 ----------

describe('transformMessages — image downgrade', () => {
  it('preserves images for models that support them', () => {
    const model = makeModel({ input: ['text', 'image'] });
    const image: ImageContent = { type: 'image', data: 'base64data', mimeType: 'image/png' };
    const messages: Message[] = [makeUserMessage([{ type: 'text', text: 'See this' }, image])];

    const result = transformMessages(messages, model);
    expect(result[0].role).toBe('user');
    const content = (result[0] as UserMessage).content as (TextContent | ImageContent)[];
    expect(content.some((c) => c.type === 'image')).toBe(true);
  });

  it('replaces images with placeholder for non-vision models', () => {
    const model = makeModel({ input: ['text'] });
    const image: ImageContent = { type: 'image', data: 'base64data', mimeType: 'image/png' };
    const messages: Message[] = [makeUserMessage([{ type: 'text', text: 'See this' }, image])];

    const result = transformMessages(messages, model);
    const content = (result[0] as UserMessage).content as TextContent[];
    expect(content.every((c) => c.type === 'text')).toBe(true);
    expect(content.some((c) => c.text.includes('image omitted'))).toBe(true);
  });

  it('replaces images in tool results for non-vision models', () => {
    const model = makeModel({ input: ['text'] });
    const messages: Message[] = [
      makeToolResult('tc-1', 'screenshot', 'text result'),
      {
        role: 'toolResult',
        toolCallId: 'tc-2',
        toolName: 'image_tool',
        content: [{ type: 'image', data: 'base64', mimeType: 'image/png' }],
        isError: false,
        timestamp: Date.now(),
      },
    ];

    const result = transformMessages(messages, model);
    const toolResultMsg = result[1] as ToolResultMessage;
    expect(toolResultMsg.content.every((c) => c.type === 'text')).toBe(true);
  });

  it('consecutive images are collapsed into a single placeholder', () => {
    const model = makeModel({ input: ['text'] });
    const messages: Message[] = [
      makeUserMessage([
        { type: 'image', data: 'a', mimeType: 'image/png' },
        { type: 'image', data: 'b', mimeType: 'image/png' },
        { type: 'text', text: 'between' },
        { type: 'image', data: 'c', mimeType: 'image/png' },
      ]),
    ];

    const result = transformMessages(messages, model);
    const content = (result[0] as UserMessage).content as TextContent[];
    const placeholders = content.filter((c) => c.text.includes('image omitted'));
    expect(placeholders.length).toBe(2);
  });
});

// ---------- Thinking 块处理 ----------

describe('transformMessages — thinking block handling', () => {
  it('preserves thinking blocks for same model', () => {
    const model = makeModel({ provider: 'anthropic', id: 'test-model' });
    const thinking: ThinkingContent = {
      type: 'thinking',
      thinking: 'Let me think...',
      thinkingSignature: 'sig123',
    };
    const messages: Message[] = [makeAssistantMessage([thinking])];

    const result = transformMessages(messages, model);
    const content = (result[0] as AssistantMessage).content;
    expect(content.some((b) => b.type === 'thinking')).toBe(true);
  });

  it('converts thinking to text for different model', () => {
    const model = makeModel({ provider: 'openai', id: 'gpt-4o' });
    const thinking: ThinkingContent = { type: 'thinking', thinking: 'Let me think...' };
    const messages: Message[] = [
      makeAssistantMessage([thinking], {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      }),
    ];

    const result = transformMessages(messages, model);
    const content = (result[0] as AssistantMessage).content;
    expect(content.every((b) => b.type === 'text')).toBe(true);
    expect((content[0] as TextContent).text).toBe('Let me think...');
  });

  it('removes redacted thinking for different model', () => {
    const model = makeModel({ provider: 'openai', id: 'gpt-4o' });
    const thinking: ThinkingContent = {
      type: 'thinking',
      thinking: '[hidden]',
      thinkingSignature: 'encrypted',
      redacted: true,
    };
    const messages: Message[] = [
      makeAssistantMessage([thinking], {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      }),
    ];

    const result = transformMessages(messages, model);
    const content = (result[0] as AssistantMessage).content;
    expect(content.length).toBe(0);
  });

  it('preserves redacted thinking for same model', () => {
    const model = makeModel({ provider: 'anthropic', id: 'test-model' });
    const thinking: ThinkingContent = {
      type: 'thinking',
      thinking: '[hidden]',
      thinkingSignature: 'encrypted',
      redacted: true,
    };
    const messages: Message[] = [
      makeAssistantMessage([thinking], { provider: 'anthropic', model: 'test-model' }),
    ];

    const result = transformMessages(messages, model);
    const content = (result[0] as AssistantMessage).content;
    expect(content.some((b) => b.type === 'thinking')).toBe(true);
  });

  it('removes empty thinking blocks', () => {
    const model = makeModel({ provider: 'anthropic', id: 'test-model' });
    const thinking: ThinkingContent = { type: 'thinking', thinking: '' };
    const messages: Message[] = [makeAssistantMessage([thinking, { type: 'text', text: 'Hello' }])];

    const result = transformMessages(messages, model);
    const content = (result[0] as AssistantMessage).content;
    expect(content.length).toBe(1);
    expect(content[0].type).toBe('text');
  });
});

// ---------- 工具调用 ID 规范化 ----------

describe('transformMessages — tool call ID normalization', () => {
  it('normalizes tool call IDs when normalizeToolCallId is provided', () => {
    const model = makeModel({ provider: 'openai', id: 'gpt-4o' });
    const originalId = 'call_abc123!!!@#';
    const normalizedId = 'call_abc123___';

    const messages: Message[] = [
      makeAssistantMessage([makeToolCall(originalId, 'read_file')], {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      }),
      makeToolResult(originalId, 'read_file', 'file content'),
    ];

    const result = transformMessages(messages, model, (id) => {
      if (id === originalId) return normalizedId;
      return id;
    });

    const assistantMsg = result[0] as AssistantMessage;
    const toolCall = assistantMsg.content[0] as ToolCall;
    expect(toolCall.id).toBe(normalizedId);

    const toolResultMsg = result[1] as ToolResultMessage;
    expect(toolResultMsg.toolCallId).toBe(normalizedId);
  });

  it('does not normalize when normalizeToolCallId is not provided', () => {
    const model = makeModel({ provider: 'openai', id: 'gpt-4o' });
    const originalId = 'call_abc123!!!@#';

    const messages: Message[] = [
      makeAssistantMessage([makeToolCall(originalId, 'read_file')], {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      }),
    ];

    const result = transformMessages(messages, model);
    const assistantMsg = result[0] as AssistantMessage;
    const toolCall = assistantMsg.content[0] as ToolCall;
    expect(toolCall.id).toBe(originalId);
  });
});

// ---------- 孤立工具调用补全 ----------

describe('transformMessages — synthetic tool results', () => {
  it('inserts synthetic tool result for orphaned tool call at end of conversation', () => {
    const model = makeModel();
    const messages: Message[] = [
      makeUserMessage('Use the tool'),
      makeAssistantMessage([makeToolCall('tc-orphan', 'read_file')]),
    ];

    const result = transformMessages(messages, model);
    const lastMsg = result[result.length - 1] as ToolResultMessage;
    expect(lastMsg.role).toBe('toolResult');
    expect(lastMsg.toolCallId).toBe('tc-orphan');
    expect(lastMsg.isError).toBe(true);
  });

  it('does not insert synthetic result when tool result exists', () => {
    const model = makeModel();
    const messages: Message[] = [
      makeUserMessage('Use the tool'),
      makeAssistantMessage([makeToolCall('tc-1', 'read_file')]),
      makeToolResult('tc-1', 'read_file', 'file content'),
    ];

    const result = transformMessages(messages, model);
    expect(result.length).toBe(3);
    expect(
      (result[2] as ToolResultMessage).content[0].type === 'text' &&
        (result[2] as ToolResultMessage).content[0].text === 'file content',
    ).toBe(true);
  });

  it('inserts synthetic result when user message interrupts tool flow', () => {
    const model = makeModel();
    const messages: Message[] = [
      makeAssistantMessage([makeToolCall('tc-1', 'read_file')]),
      makeUserMessage('Wait, let me ask something else'),
    ];

    const result = transformMessages(messages, model);
    expect(result.length).toBe(3);
    expect(result[1].role).toBe('toolResult');
    expect(result[2].role).toBe('user');
  });

  it('handles multiple tool calls with some missing results', () => {
    const model = makeModel();
    const messages: Message[] = [
      makeAssistantMessage([makeToolCall('tc-1', 'read_file'), makeToolCall('tc-2', 'write_file')]),
      makeToolResult('tc-1', 'read_file', 'content'),
    ];

    const result = transformMessages(messages, model);
    const toolResults = result.filter((m) => m.role === 'toolResult') as ToolResultMessage[];
    expect(toolResults.length).toBe(2);
    expect(toolResults.some((t) => t.toolCallId === 'tc-2' && t.isError)).toBe(true);
  });
});

// ---------- 跳过 error/aborted 消息 ----------

describe('transformMessages — skip error/aborted messages', () => {
  it('skips assistant messages with error stopReason', () => {
    const model = makeModel();
    const messages: Message[] = [
      makeUserMessage('Hello'),
      makeAssistantMessage([{ type: 'text', text: 'Partial' }], { stopReason: 'error' }),
      makeUserMessage('Try again'),
    ];

    const result = transformMessages(messages, model);
    expect(result.length).toBe(2);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('user');
  });

  it('skips assistant messages with aborted stopReason', () => {
    const model = makeModel();
    const messages: Message[] = [
      makeUserMessage('Hello'),
      makeAssistantMessage([{ type: 'text', text: 'Partial' }], { stopReason: 'aborted' }),
      makeUserMessage('Try again'),
    ];

    const result = transformMessages(messages, model);
    expect(result.length).toBe(2);
  });

  it('keeps normal assistant messages', () => {
    const model = makeModel();
    const messages: Message[] = [
      makeUserMessage('Hello'),
      makeAssistantMessage([{ type: 'text', text: 'Hi there' }]),
    ];

    const result = transformMessages(messages, model);
    expect(result.length).toBe(2);
    expect(result[1].role).toBe('assistant');
  });
});

// ---------- 混合场景 ----------

describe('transformMessages — mixed scenarios', () => {
  it('handles a full conversation with tools', () => {
    const model = makeModel();
    const messages: Message[] = [
      makeUserMessage('Read the file'),
      makeAssistantMessage([makeToolCall('tc-1', 'read_file')]),
      makeToolResult('tc-1', 'read_file', 'file content'),
      makeAssistantMessage([{ type: 'text', text: 'The file contains: file content' }]),
    ];

    const result = transformMessages(messages, model);
    expect(result.length).toBe(4);
    expect(result.map((m) => m.role)).toEqual(['user', 'assistant', 'toolResult', 'assistant']);
  });

  it('handles string content in user messages', () => {
    const model = makeModel();
    const messages: Message[] = [makeUserMessage('Just a string')];

    const result = transformMessages(messages, model);
    expect((result[0] as UserMessage).content).toBe('Just a string');
  });

  it('thoughtSignature is removed from tool calls for different model', () => {
    const model = makeModel({ provider: 'openai', id: 'gpt-4o' });
    const toolCall = { ...makeToolCall('tc-1', 'read_file'), thoughtSignature: 'sig' };
    const messages: Message[] = [
      makeAssistantMessage([toolCall], {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      }),
    ];

    const result = transformMessages(messages, model);
    const content = (result[0] as AssistantMessage).content;
    const tc = content[0] as ToolCall;
    expect((tc as ToolCall).thoughtSignature).toBeUndefined();
  });
});
