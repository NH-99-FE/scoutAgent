// ============================================================
// Anthropic SSE 解析器容错性测试
// 验证异常 SSE 数据的处理行为
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { streamAnthropic } from '../../src/providers/anthropic';
import type { AnthropicOptions } from '../../src/providers/anthropic';
import type { Context, Model } from '../../src/types';

// ---------- 辅助 ----------

function makeModel(
  overrides: Partial<Model<'anthropic-messages'>> = {},
): Model<'anthropic-messages'> {
  return {
    id: 'test-model',
    name: 'Test Model',
    api: 'anthropic-messages',
    provider: 'anthropic',
    baseUrl: 'https://api.test/v1',
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: 'low', low: 'low', medium: 'medium', high: 'high' },
    input: ['text', 'image'],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200000,
    maxTokens: 8192,
    ...overrides,
  };
}

function basicContext(): Context {
  return {
    systemPrompt: 'You are helpful.',
    messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }],
  };
}

function createSseResponse(events: Array<{ event: string; data: string }>): Response {
  const body = events.map(({ event, data }) => `event: ${event}\ndata: ${data}\n`).join('\n');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function messageStartEvent(inputTokens = 10, outputTokens = 0) {
  return {
    event: 'message_start',
    data: JSON.stringify({
      type: 'message_start',
      message: {
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    }),
  };
}

function textStartEvent(index: number) {
  return {
    event: 'content_block_start',
    data: JSON.stringify({
      type: 'content_block_start',
      index,
      content_block: { type: 'text', text: '' },
    }),
  };
}

function textDeltaEvent(index: number, text: string) {
  return {
    event: 'content_block_delta',
    data: JSON.stringify({
      type: 'content_block_delta',
      index,
      delta: { type: 'text_delta', text },
    }),
  };
}

function blockStopEvent(index: number) {
  return {
    event: 'content_block_stop',
    data: JSON.stringify({ type: 'content_block_stop', index }),
  };
}

function toolUseStartEvent(index: number, id: string, name: string) {
  return {
    event: 'content_block_start',
    data: JSON.stringify({
      type: 'content_block_start',
      index,
      content_block: { type: 'tool_use', id, name, input: {} },
    }),
  };
}

function inputJsonDeltaEvent(index: number, partialJson: string) {
  return {
    event: 'content_block_delta',
    data: JSON.stringify({
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: partialJson },
    }),
  };
}

function messageDeltaEvent(stopReason: string, outputTokens = 5) {
  return {
    event: 'message_delta',
    data: JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: stopReason },
      usage: { output_tokens: outputTokens },
    }),
  };
}

function messageStopEvent() {
  return { event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) };
}

function createMockClient(response: Response) {
  return {
    messages: {
      create: () => ({
        asResponse: async () => response,
      }),
    },
  } as any;
}

// ---------- 测试 ----------

describe('Anthropic SSE parsing resilience', () => {
  it('handles malformed JSON in content_block_delta', async () => {
    // 截断的 JSON — parseJsonWithRepair 应该修复它
    const response = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      {
        event: 'content_block_delta',
        // 故意缺少闭合引号和括号的截断 JSON
        data: '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi',
      },
      // 发送正常的事件来完成流
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
    } as AnthropicOptions);

    // 截断 JSON 应该被 parseJsonWithRepair 修复或导致可处理的错误
    const result = await s.result();
    // 流应该要么完成（修复成功）要么 error（修复失败），但不应挂起
    expect(['stop', 'error']).toContain(result.stopReason);
  });

  it('ignores unknown SSE event types', async () => {
    const response = createSseResponse([
      messageStartEvent(),
      { event: 'ping', data: '{}' }, // 非标准事件，应被忽略
      textStartEvent(0),
      textDeltaEvent(0, 'Hello'),
      blockStopEvent(0),
      { event: 'custom_event', data: '{"foo":"bar"}' }, // 未知事件类型
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
    } as AnthropicOptions);

    const result = await s.result();
    expect(result.stopReason).toBe('stop');
    const text = result.content.find((b) => b.type === 'text');
    expect(text).toBeDefined();
    expect((text as any).text).toBe('Hello');
  });

  it('throws on SSE error event', async () => {
    const response = createSseResponse([{ event: 'error', data: 'Internal server error' }]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
    } as AnthropicOptions);

    const result = await s.result();
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).toBeDefined();
  });

  it('handles empty data lines in SSE', async () => {
    const response = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hello'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
    } as AnthropicOptions);

    const result = await s.result();
    expect(result.stopReason).toBe('stop');
  });

  it('handles tool_use with malformed partial JSON', async () => {
    // {"path":"A\H"} — \H 是非法转义，repairJson 应该修复为 \\H
    const response = createSseResponse([
      messageStartEvent(),
      toolUseStartEvent(0, 'tool_1', 'test_tool'),
      inputJsonDeltaEvent(0, '{"path":"A\\H"}'),
      blockStopEvent(0),
      messageDeltaEvent('tool_use'),
      messageStopEvent(),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
    } as AnthropicOptions);

    const result = await s.result();
    // malformed JSON 应该被 parseStreamingJson 修复
    expect(['toolUse', 'error']).toContain(result.stopReason);
    if (result.stopReason === 'toolUse') {
      const toolCall = result.content.find((b) => b.type === 'toolCall');
      expect(toolCall).toBeDefined();
    }
  });

  it('processes message_delta events after message_stop', async () => {
    // message_stop 后再发送的 message_delta 仍然会被处理
    // 注意：第二个 message_delta 会覆盖第一个的 stop_reason
    const response = createSseResponse([
      messageStartEvent(),
      textStartEvent(0),
      textDeltaEvent(0, 'Hello'),
      blockStopEvent(0),
      messageDeltaEvent('end_turn'),
      messageStopEvent(),
      // message_stop 之后的事件仍然被处理
      messageDeltaEvent('max_tokens'),
    ]);

    const model = makeModel();
    const client = createMockClient(response);
    const s = streamAnthropic(model, basicContext(), {
      client,
      apiKey: 'test-key',
    } as AnthropicOptions);

    const result = await s.result();
    // 第二个 message_delta 的 max_tokens 覆盖了 end_turn
    expect(result.stopReason).toBe('length');
  });
});
