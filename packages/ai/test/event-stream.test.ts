// ============================================================
// event-stream 测试 — 异步推送队列
// ============================================================

import { describe, it, expect } from 'vitest';
import { EventStream, createAssistantMessageEventStream } from '../src/event-stream';
import type { AssistantMessage } from '../src/types';

// ---------- 辅助函数 ----------

function makeAssistantMessage(overrides?: Partial<AssistantMessage>): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
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

async function collectEvents<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

// ---------- EventStream ----------

describe('EventStream', () => {
  it('delivers pushed events via async iteration', async () => {
    const es = new EventStream<number, number>(
      (e) => e === 3,
      (e) => e,
    );
    const events: number[] = [];

    const iterPromise = (async () => {
      for await (const event of es) {
        events.push(event);
      }
    })();

    es.push(1);
    es.push(2);
    es.push(3);

    await iterPromise;
    expect(events).toEqual([1, 2, 3]);
  });

  it('resolves result() with the extracted value when complete', async () => {
    const es = new EventStream<string, string>(
      (e) => e === 'done',
      (e) => e.toUpperCase(),
    );

    const resultPromise = es.result();

    es.push('pending');
    es.push('done');

    const result = await resultPromise;
    expect(result).toBe('DONE');
  });

  it('queues events pushed before iterator starts', async () => {
    const es = new EventStream<number, number>(
      (e) => e === 99,
      (e) => e,
    );

    es.push(1);
    es.push(2);
    es.push(99);

    const events = await collectEvents(es);
    expect(events).toEqual([1, 2, 99]);
  });

  it('end() terminates iteration without result if no result given', async () => {
    const es = new EventStream<number, number>(
      (e) => e === 999,
      (e) => e,
    );

    es.push(1);
    es.end();

    const events = await collectEvents(es);
    expect(events).toEqual([1]);
  });

  it('end(result) resolves the result promise', async () => {
    const es = new EventStream<number, string>(
      () => false,
      () => 'default',
    );

    const resultPromise = es.result();
    es.end('final-value');

    const result = await resultPromise;
    expect(result).toBe('final-value');
  });

  it('ignores pushes after done', async () => {
    const es = new EventStream<number, number>(
      (e) => e === 1,
      (e) => e,
    );

    const events: number[] = [];
    const iterPromise = (async () => {
      for await (const event of es) {
        events.push(event);
      }
    })();

    es.push(1);
    es.push(2);

    await iterPromise;
    expect(events).toEqual([1]);
  });
});

// ---------- AssistantMessageEventStream ----------

describe('AssistantMessageEventStream', () => {
  it('delivers text events and resolves to final message', async () => {
    const stream = createAssistantMessageEventStream();
    const msg = makeAssistantMessage();

    (async () => {
      stream.push({ type: 'start', partial: msg });
      stream.push({ type: 'text_start', contentIndex: 0, partial: msg });
      stream.push({ type: 'text_delta', contentIndex: 0, delta: 'Hello', partial: msg });
      stream.push({ type: 'text_delta', contentIndex: 0, delta: ' world', partial: msg });
      stream.push({ type: 'text_end', contentIndex: 0, content: 'Hello world', partial: msg });
      stream.push({ type: 'done', reason: 'stop', message: msg });
      stream.end();
    })();

    const events = await collectEvents(stream);
    expect(events.map((e) => e.type)).toEqual([
      'start',
      'text_start',
      'text_delta',
      'text_delta',
      'text_end',
      'done',
    ]);

    const result = await stream.result();
    expect(result.role).toBe('assistant');
    expect(result.stopReason).toBe('stop');
  });

  it('resolves with error message on error event', async () => {
    const stream = createAssistantMessageEventStream();
    const errorMsg = makeAssistantMessage({ stopReason: 'error', errorMessage: 'API failed' });

    (async () => {
      stream.push({ type: 'start', partial: errorMsg });
      stream.push({ type: 'error', reason: 'error', error: errorMsg });
      stream.end();
    })();

    const result = await stream.result();
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).toBe('API failed');
  });

  it('resolves with aborted message on aborted event', async () => {
    const stream = createAssistantMessageEventStream();
    const abortedMsg = makeAssistantMessage({ stopReason: 'aborted' });

    (async () => {
      stream.push({ type: 'start', partial: abortedMsg });
      stream.push({ type: 'error', reason: 'aborted', error: abortedMsg });
      stream.end();
    })();

    const result = await stream.result();
    expect(result.stopReason).toBe('aborted');
  });

  it('delivers tool call events', async () => {
    const stream = createAssistantMessageEventStream();
    const msg = makeAssistantMessage({ stopReason: 'toolUse' });
    const toolCall = {
      type: 'toolCall' as const,
      id: 'tc-1',
      name: 'read_file',
      arguments: { path: '/tmp/test.txt' },
    };

    (async () => {
      stream.push({ type: 'start', partial: msg });
      stream.push({ type: 'toolcall_start', contentIndex: 0, partial: msg });
      stream.push({ type: 'toolcall_delta', contentIndex: 0, delta: '{"path":', partial: msg });
      stream.push({
        type: 'toolcall_delta',
        contentIndex: 0,
        delta: '"/tmp/test.txt"}',
        partial: msg,
      });
      stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: msg });
      stream.push({ type: 'done', reason: 'toolUse', message: msg });
      stream.end();
    })();

    const events = await collectEvents(stream);
    const types = events.map((e) => e.type);
    expect(types).toContain('toolcall_start');
    expect(types).toContain('toolcall_end');
    expect(types).toContain('done');

    const result = await stream.result();
    expect(result.stopReason).toBe('toolUse');
  });

  it('delivers thinking events', async () => {
    const stream = createAssistantMessageEventStream();
    const msg = makeAssistantMessage();

    (async () => {
      stream.push({ type: 'start', partial: msg });
      stream.push({ type: 'thinking_start', contentIndex: 0, partial: msg });
      stream.push({ type: 'thinking_delta', contentIndex: 0, delta: 'Hmm...', partial: msg });
      stream.push({ type: 'thinking_end', contentIndex: 0, content: 'Hmm...', partial: msg });
      stream.push({ type: 'done', reason: 'stop', message: msg });
      stream.end();
    })();

    const events = await collectEvents(stream);
    const types = events.map((e) => e.type);
    expect(types).toContain('thinking_start');
    expect(types).toContain('thinking_delta');
    expect(types).toContain('thinking_end');
  });
});
