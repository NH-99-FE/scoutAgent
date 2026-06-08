// ============================================================
// AgentHarness Stream 配置生命周期测试
// ============================================================

import {
  createAssistantMessageEventStream,
  registerApiProvider,
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type StreamFunction,
  type ToolCall,
  unregisterApiProviders,
} from '@scout-agent/ai';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentHarness } from '../../src/harness/agent-harness.ts';
import { NodeExecutionEnv } from '../../src/harness/env/nodejs.ts';
import { InMemorySessionStorage } from '../../src/harness/session/memory-storage.ts';
import { Session } from '../../src/harness/session/session.ts';
import type { AgentTool } from '../../src/types.ts';

const SOURCE_ID = 'agent-harness-stream-test';

type TestApi = 'test-stream-api';
type ResponseFactory = (
  context: Context,
  options: SimpleStreamOptions | undefined,
  model: Model<TestApi>,
) => AssistantMessage | Promise<AssistantMessage>;

function createModel(): Model<TestApi> {
  return {
    id: 'test-model',
    name: 'Test Model',
    api: 'test-stream-api',
    provider: 'test-provider',
    baseUrl: 'https://example.com',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 4096,
  };
}

function createAssistantMessage(
  textOrContent: string | Array<{ type: 'text'; text: string } | ToolCall>,
  stopReason: Extract<AssistantMessage['stopReason'], 'stop' | 'length' | 'toolUse'> = 'stop',
): AssistantMessage {
  return {
    role: 'assistant',
    content:
      typeof textOrContent === 'string' ? [{ type: 'text', text: textOrContent }] : textOrContent,
    api: 'test-stream-api',
    provider: 'test-provider',
    model: 'test-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

function registerResponses(responses: ResponseFactory[]): void {
  const streamSimple: StreamFunction<TestApi, SimpleStreamOptions> = (model, context, options) => {
    const response = responses.shift();
    if (!response) throw new Error('No test response queued');
    const stream = createAssistantMessageEventStream();
    queueMicrotask(async () => {
      const message = await response(context, options, model);
      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        stream.push({ type: 'error', reason: message.stopReason, error: message });
        return;
      }
      stream.push({ type: 'done', reason: message.stopReason, message });
    });
    return stream;
  };

  registerApiProvider(
    {
      api: 'test-stream-api',
      stream: streamSimple,
      streamSimple,
    },
    SOURCE_ID,
  );
}

function createHarness(
  options?: Partial<ConstructorParameters<typeof AgentHarness>[0]>,
): AgentHarness {
  return new AgentHarness({
    env: new NodeExecutionEnv({ cwd: process.cwd() }),
    session: new Session(
      new InMemorySessionStorage({
        metadata: { id: 'session-1', createdAt: 'now' },
      }),
    ),
    model: createModel(),
    ...options,
  });
}

function captureOptions(options: SimpleStreamOptions | undefined): SimpleStreamOptions {
  return {
    ...options,
    headers: options?.headers ? { ...options.headers } : undefined,
    metadata: options?.metadata ? { ...options.metadata } : undefined,
  };
}

afterEach(() => {
  unregisterApiProviders(SOURCE_ID);
});

describe('AgentHarness stream configuration', () => {
  it('snapshots stream options and merges auth headers before provider request hooks', async () => {
    let capturedOptions: SimpleStreamOptions | undefined;
    registerResponses([
      (_context, options) => {
        capturedOptions = captureOptions(options);
        return createAssistantMessage('ok');
      },
    ]);

    const harness = createHarness({
      streamOptions: {
        timeoutMs: 1000,
        maxRetries: 2,
        maxRetryDelayMs: 3000,
        headers: { 'x-base': 'base' },
        metadata: { base: true },
        cacheRetention: 'none',
      },
      getApiKeyAndHeaders: async () => ({ apiKey: 'secret', headers: { 'x-auth': 'auth' } }),
    });

    harness.on('before_provider_request', (event) => {
      expect(event.sessionId).toBe('session-1');
      expect(event.streamOptions.headers).toEqual({ 'x-base': 'base', 'x-auth': 'auth' });
      return {
        streamOptions: {
          headers: { 'x-hook': 'hook' },
          metadata: { hook: true },
        },
      };
    });

    await harness.prompt('hello');

    expect(capturedOptions).toMatchObject({
      apiKey: 'secret',
      timeoutMs: 1000,
      maxRetries: 2,
      maxRetryDelayMs: 3000,
      sessionId: 'session-1',
      cacheRetention: 'none',
    });
    expect(capturedOptions?.headers).toEqual({
      'x-base': 'base',
      'x-auth': 'auth',
      'x-hook': 'hook',
    });
    expect(capturedOptions?.metadata).toEqual({ base: true, hook: true });
  });

  it('chains provider request patches and supports deletion semantics', async () => {
    let capturedOptions: SimpleStreamOptions | undefined;
    registerResponses([
      (_context, options) => {
        capturedOptions = captureOptions(options);
        return createAssistantMessage('ok');
      },
    ]);

    const harness = createHarness({
      streamOptions: {
        timeoutMs: 1000,
        maxRetries: 2,
        headers: { keep: 'base', remove: 'base' },
        metadata: { keep: 'base', remove: 'base' },
      },
    });

    harness.on('before_provider_request', (event) => {
      expect(event.streamOptions.headers).toEqual({ keep: 'base', remove: 'base' });
      return {
        streamOptions: {
          headers: { first: '1', remove: undefined },
          metadata: { first: 1, remove: undefined },
        },
      };
    });
    harness.on('before_provider_request', (event) => {
      expect(event.streamOptions.headers).toEqual({ keep: 'base', first: '1' });
      expect(event.streamOptions.metadata).toEqual({ keep: 'base', first: 1 });
      return {
        streamOptions: {
          timeoutMs: undefined,
          headers: { second: '2' },
          metadata: undefined,
        },
      };
    });

    await harness.prompt('hello');

    expect(capturedOptions?.timeoutMs).toBeUndefined();
    expect(capturedOptions?.maxRetries).toBe(2);
    expect(capturedOptions?.headers).toEqual({ keep: 'base', first: '1', second: '2' });
    expect(capturedOptions?.metadata).toBeUndefined();
  });

  it('uses updated stream options for save-point snapshots without mutating the active request', async () => {
    const capturedOptions: SimpleStreamOptions[] = [];
    registerResponses([
      (_context, options) => {
        capturedOptions.push(captureOptions(options));
        return createAssistantMessage(
          [
            {
              type: 'toolCall',
              id: 'call-1',
              name: 'calculate',
              arguments: { expression: '1 + 1' },
            },
          ],
          'toolUse',
        );
      },
      (_context, options) => {
        capturedOptions.push(captureOptions(options));
        return createAssistantMessage('done');
      },
    ]);

    const calculateTool: AgentTool = {
      name: 'calculate',
      label: 'Calculate',
      description: 'Calculate expression',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string' } },
        required: ['expression'],
      },
      execute: async (_toolCallId, input) => ({
        content: [{ type: 'text', text: String((input as { expression: string }).expression) }],
        details: input,
      }),
    };
    const harness = createHarness({
      tools: [calculateTool],
      streamOptions: { timeoutMs: 1000, headers: { turn: 'first' } },
    });

    harness.subscribe((event) => {
      if (event.type === 'tool_execution_start') {
        void harness.setStreamOptions({ timeoutMs: 2000, headers: { turn: 'second' } });
      }
    });

    await harness.prompt('hello');

    expect(capturedOptions).toHaveLength(2);
    expect(capturedOptions[0]?.timeoutMs).toBe(1000);
    expect(capturedOptions[0]?.headers).toEqual({ turn: 'first' });
    expect(capturedOptions[1]?.timeoutMs).toBe(2000);
    expect(capturedOptions[1]?.headers).toEqual({ turn: 'second' });
  });

  it('chains provider payload hooks', async () => {
    const seenPayloads: unknown[] = [];
    let finalPayload: unknown;
    registerResponses([
      async (_context, options, model) => {
        finalPayload = await options?.onPayload?.({ steps: ['provider'] }, model);
        return createAssistantMessage('ok');
      },
    ]);

    const harness = createHarness();
    harness.on('before_provider_payload', (event) => {
      seenPayloads.push(event.payload);
      return { payload: { steps: ['provider', 'first'] } };
    });
    harness.on('before_provider_payload', (event) => {
      seenPayloads.push(event.payload);
      return { payload: { steps: ['provider', 'first', 'second'] } };
    });

    await harness.prompt('hello');

    expect(seenPayloads).toEqual([{ steps: ['provider'] }, { steps: ['provider', 'first'] }]);
    expect(finalPayload).toEqual({ steps: ['provider', 'first', 'second'] });
  });

  it('runs tool_call and tool_result hooks through the direct loop', async () => {
    registerResponses([
      () =>
        createAssistantMessage(
          [
            {
              type: 'toolCall',
              id: 'call-1',
              name: 'calculate',
              arguments: { expression: '2 + 2' },
            },
          ],
          'toolUse',
        ),
    ]);
    const session = new Session(new InMemorySessionStorage());
    const calculateTool: AgentTool = {
      name: 'calculate',
      label: 'Calculate',
      description: 'Calculate expression',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string' } },
        required: ['expression'],
      },
      execute: async (_toolCallId, input) => ({
        content: [{ type: 'text', text: String((input as { expression: string }).expression) }],
        details: input,
      }),
    };
    const harness = createHarness({ session, tools: [calculateTool] });
    const seenToolCalls: Array<{ id: string; name: string; expression: unknown }> = [];

    harness.on('tool_call', (event) => {
      seenToolCalls.push({
        id: event.toolCallId,
        name: event.toolName,
        expression: (event.input as { expression?: unknown }).expression,
      });
      return undefined;
    });
    harness.on('tool_result', (event) => {
      expect(event.toolCallId).toBe('call-1');
      expect(event.toolName).toBe('calculate');
      return {
        content: [{ type: 'text', text: 'patched result' }],
        details: { patched: true },
        terminate: true,
      };
    });

    await harness.prompt('hello');

    const toolResult = (await session.getEntries()).find(
      (entry) => entry.type === 'message' && entry.message.role === 'toolResult',
    );
    expect(seenToolCalls).toEqual([{ id: 'call-1', name: 'calculate', expression: '2 + 2' }]);
    expect(toolResult).toMatchObject({
      type: 'message',
      message: {
        role: 'toolResult',
        content: [{ type: 'text', text: 'patched result' }],
        details: { patched: true },
      },
    });
  });
});
