// ============================================================
// openai-responses 共享层测试
// 覆盖 Responses 消息转换与事件流解析
// ============================================================

import { describe, expect, it } from 'vitest';
import type { ResponseStreamEvent } from 'openai/resources/responses/responses.js';
import type { TSchema } from 'typebox';
import { AssistantMessageEventStream } from '../../src/event-stream';
import {
  convertResponsesMessages,
  convertResponsesTools,
  processResponsesStream,
} from '../../src/providers/openai-responses-shared';
import type { AssistantMessage, Context, Model, Tool } from '../../src/types';

// ---------- 夹具 ----------

function makeModel(overrides: Partial<Model<'openai-responses'>> = {}): Model<'openai-responses'> {
  return {
    id: 'gpt-5',
    name: 'GPT-5',
    api: 'openai-responses',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    reasoning: true,
    thinkingLevelMap: { off: null },
    input: ['text', 'image'],
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
    ...overrides,
  };
}

function makeOutput(model: Model<'openai-responses'> = makeModel()): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
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
}

function makeTool(): Tool {
  return {
    name: 'read_file',
    description: 'Read a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    } as unknown as TSchema,
  };
}

async function* makeEventStream(events: ResponseStreamEvent[]): AsyncIterable<ResponseStreamEvent> {
  for (const event of events) yield event;
}

async function collectEvents(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function eventTypes(events: unknown[]): string[] {
  return events.map((event) => (event as { type: string }).type);
}

// ---------- 消息转换 ----------

describe('convertResponsesMessages', () => {
  it('uses developer role for reasoning model system prompts', () => {
    const context: Context = {
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }],
    };

    const messages = convertResponsesMessages(makeModel(), context, new Set(['openai']));

    expect(messages[0]).toMatchObject({ role: 'developer', content: 'You are helpful.' });
    expect(messages[1]).toMatchObject({
      role: 'user',
      content: [{ type: 'input_text', text: 'hello' }],
    });
  });

  it('converts assistant text signatures and tool calls for replay', () => {
    const context: Context = {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'answer',
              textSignature: JSON.stringify({ v: 1, id: 'msg_123', phase: 'final_answer' }),
            },
            {
              type: 'toolCall',
              id: 'call_123|fc_123',
              name: 'read_file',
              arguments: { path: 'a' },
            },
          ],
          api: 'openai-responses',
          provider: 'openai',
          model: 'gpt-5',
          usage: makeOutput().usage,
          stopReason: 'toolUse',
          timestamp: Date.now(),
        },
      ],
    };

    const messages = convertResponsesMessages(makeModel(), context, new Set(['openai']));

    expect(messages[0]).toMatchObject({
      type: 'message',
      id: 'msg_123',
      phase: 'final_answer',
    });
    expect(messages[1]).toMatchObject({
      type: 'function_call',
      id: 'fc_123',
      call_id: 'call_123',
      name: 'read_file',
      arguments: '{"path":"a"}',
    });
  });

  it('converts multimodal tool results into function_call_output content lists', () => {
    const context: Context = {
      messages: [
        {
          role: 'toolResult',
          toolCallId: 'call_123|fc_123',
          toolName: 'read_file',
          content: [
            { type: 'text', text: 'screenshot' },
            { type: 'image', mimeType: 'image/png', data: 'abc123' },
          ],
          isError: false,
          timestamp: Date.now(),
        },
      ],
    };

    const messages = convertResponsesMessages(makeModel(), context, new Set(['openai']));

    expect(messages[0]).toMatchObject({ type: 'function_call_output', call_id: 'call_123' });
    expect((messages[0] as { output?: unknown }).output).toEqual([
      { type: 'input_text', text: 'screenshot' },
      { type: 'input_image', detail: 'auto', image_url: 'data:image/png;base64,abc123' },
    ]);
  });
});

describe('convertResponsesTools', () => {
  it('converts Scout tools to Responses function tools', () => {
    const tools = convertResponsesTools([makeTool()]);

    expect(tools[0]).toMatchObject({
      type: 'function',
      name: 'read_file',
      description: 'Read a file',
      strict: false,
    });
  });
});

// ---------- 流解析 ----------

describe('processResponsesStream', () => {
  it('emits text events and records usage', async () => {
    const model = makeModel();
    const output = makeOutput(model);
    const stream = new AssistantMessageEventStream();
    const events = [
      { type: 'response.created', response: { id: 'resp_123' } },
      {
        type: 'response.output_item.added',
        item: { type: 'message', id: 'msg_123', role: 'assistant', content: [] },
      },
      {
        type: 'response.content_part.added',
        part: { type: 'output_text', text: '', annotations: [] },
      },
      { type: 'response.output_text.delta', delta: 'hello' },
      {
        type: 'response.output_item.done',
        item: {
          type: 'message',
          id: 'msg_123',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'hello', annotations: [] }],
          status: 'completed',
        },
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp_123',
          status: 'completed',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
            input_tokens_details: { cached_tokens: 4 },
          },
        },
      },
    ] as ResponseStreamEvent[];

    await processResponsesStream(makeEventStream(events), output, stream, model);
    stream.end();
    const emitted = await collectEvents(stream);

    expect(eventTypes(emitted)).toEqual(['text_start', 'text_delta', 'text_end']);
    expect(output.responseId).toBe('resp_123');
    expect(output.content[0]).toMatchObject({ type: 'text', text: 'hello' });
    expect(output.usage).toMatchObject({ input: 6, output: 5, cacheRead: 4, totalTokens: 15 });
    expect(output.usage.cost.total).toBeGreaterThan(0);
  });

  it('emits tool call events and marks the response as toolUse', async () => {
    const model = makeModel();
    const output = makeOutput(model);
    const stream = new AssistantMessageEventStream();
    const events = [
      {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          id: 'fc_123',
          call_id: 'call_123',
          name: 'read_file',
          arguments: '',
        },
      },
      { type: 'response.function_call_arguments.delta', delta: '{"path":"' },
      { type: 'response.function_call_arguments.delta', delta: 'README.md"}' },
      {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          id: 'fc_123',
          call_id: 'call_123',
          name: 'read_file',
          arguments: '{"path":"README.md"}',
        },
      },
      { type: 'response.completed', response: { id: 'resp_tool', status: 'completed' } },
    ] as ResponseStreamEvent[];

    await processResponsesStream(makeEventStream(events), output, stream, model);
    stream.end();
    const emitted = await collectEvents(stream);

    expect(eventTypes(emitted)).toEqual([
      'toolcall_start',
      'toolcall_delta',
      'toolcall_delta',
      'toolcall_end',
    ]);
    expect(output.stopReason).toBe('toolUse');
    expect(output.content[0]).toMatchObject({
      type: 'toolCall',
      id: 'call_123|fc_123',
      name: 'read_file',
      arguments: { path: 'README.md' },
    });
  });

  it('applies priority service tier pricing', async () => {
    const model = makeModel();
    const output = makeOutput(model);
    const stream = new AssistantMessageEventStream();
    const events = [
      {
        type: 'response.completed',
        response: {
          id: 'resp_priority',
          status: 'completed',
          service_tier: 'priority',
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        },
      },
    ] as ResponseStreamEvent[];

    await processResponsesStream(makeEventStream(events), output, stream, model, {
      serviceTier: 'priority',
      applyServiceTierPricing: (usage) => {
        usage.cost.input *= 2;
        usage.cost.output *= 2;
        usage.cost.total *= 2;
      },
    });

    expect(output.usage.cost.input).toBeCloseTo(0.00002);
    expect(output.usage.cost.output).toBeCloseTo(0.00002);
    expect(output.usage.cost.total).toBeCloseTo(0.00004);
  });
});
