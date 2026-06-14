import { describe, expect, it, vi } from 'vitest';
import type { WebviewRequestPayload } from '@scout-agent/shared';
import { ProtocolServer } from '../../../src/host/protocol/protocol-server.ts';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

type TaskHistoryRequestPayload = Extract<WebviewRequestPayload, { type: 'request_task_history' }>;

function taskHistoryPayload(
  overrides: Partial<TaskHistoryRequestPayload> = {},
): TaskHistoryRequestPayload {
  return {
    type: 'request_task_history' as const,
    query: '',
    purpose: 'panel' as const,
    ...overrides,
  };
}

describe('ProtocolServer', () => {
  it('routes a request by service and method', async () => {
    const postMessage = vi.fn();
    const server = new ProtocolServer({ postMessage });

    server.register(
      { service: 'task', method: 'request_task_history', payloadType: 'request_task_history' },
      (context) => {
        context.respond({
          type: 'task_history_result',
          query: context.payload.type === 'request_task_history' ? context.payload.query : '',
          purpose: 'panel',
          tasks: [],
          offset: 0,
          hasMore: false,
          nextOffset: 0,
        });
      },
    );

    await server.handleRequest(
      {
        type: 'protocol_request',
        requestId: 'request-1',
        service: 'task',
        method: 'request_task_history',
        payload: taskHistoryPayload({ query: 'abc' }),
      },
      'chat',
    );

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'protocol_response',
        requestId: 'request-1',
        payload: {
          type: 'task_history_result',
          query: 'abc',
          purpose: 'panel',
          tasks: [],
          offset: 0,
          hasMore: false,
          nextOffset: 0,
        },
      },
      'chat',
    );
  });

  it('suppresses responses after cancellation and runs cleanup', async () => {
    const postMessage = vi.fn();
    const cleanup = vi.fn();
    const deferred = createDeferred();
    const server = new ProtocolServer({ postMessage });

    server.register(
      { service: 'task', method: 'request_task_history', payloadType: 'request_task_history' },
      async (context) => {
        context.onCleanup(cleanup);
        await deferred.promise;
        context.respond({
          type: 'task_history_result',
          query: '',
          purpose: 'panel',
          tasks: [],
          offset: 0,
          hasMore: false,
          nextOffset: 0,
        });
      },
    );

    const running = server.handleRequest(
      {
        type: 'protocol_request',
        requestId: 'request-2',
        service: 'task',
        method: 'request_task_history',
        payload: taskHistoryPayload(),
      },
      'chat',
    );
    expect(server.cancel('request-2')).toBe(true);
    deferred.resolve();
    await running;

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('keeps streaming requests active until cancellation', async () => {
    const postMessage = vi.fn();
    const cleanup = vi.fn();
    const server = new ProtocolServer({ postMessage });

    server.register(
      { service: 'task', method: 'request_task_history', payloadType: 'request_task_history' },
      (context) => {
        context.onCleanup(cleanup);
        context.respond(
          {
            type: 'task_history_result',
            query: '',
            purpose: 'panel',
            tasks: [],
            offset: 0,
            hasMore: false,
            nextOffset: 0,
          },
          { done: false },
        );
      },
    );

    await server.handleRequest(
      {
        type: 'protocol_request',
        requestId: 'stream-1',
        service: 'task',
        method: 'request_task_history',
        streaming: true,
        payload: taskHistoryPayload(),
      },
      'chat',
    );

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'protocol_response',
        requestId: 'stream-1',
        done: false,
        sequence: 1,
      }),
      'chat',
    );
    expect(server.cancel('stream-1')).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('finishes streaming requests when a final response is sent', async () => {
    const postMessage = vi.fn();
    const cleanup = vi.fn();
    const server = new ProtocolServer({ postMessage });

    server.register(
      { service: 'task', method: 'request_task_history', payloadType: 'request_task_history' },
      (context) => {
        context.onCleanup(cleanup);
        context.respond({
          type: 'task_history_result',
          query: '',
          purpose: 'panel',
          tasks: [],
          offset: 0,
          hasMore: false,
          nextOffset: 0,
        });
      },
    );

    await server.handleRequest(
      {
        type: 'protocol_request',
        requestId: 'stream-2',
        service: 'task',
        method: 'request_task_history',
        streaming: true,
        payload: taskHistoryPayload(),
      },
      'chat',
    );

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'protocol_response',
        requestId: 'stream-2',
        sequence: 1,
      }),
      'chat',
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(server.cancel('stream-2')).toBe(false);
  });

  it('returns a protocol error for unknown methods', async () => {
    const postMessage = vi.fn();
    const server = new ProtocolServer({ postMessage });

    await server.handleRequest(
      {
        type: 'protocol_request',
        requestId: 'bad-1',
        service: 'task',
        method: 'request_task_history',
        payload: taskHistoryPayload(),
      },
      'chat',
    );

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'protocol_response',
        requestId: 'bad-1',
        error: {
          code: 'method_not_found',
          message: 'Unknown protocol method: task.request_task_history',
        },
      },
      'chat',
    );
  });

  it('returns a protocol error when the envelope route does not match the payload', async () => {
    const postMessage = vi.fn();
    const server = new ProtocolServer({ postMessage });

    await server.handleRequest(
      {
        type: 'protocol_request',
        requestId: 'bad-route',
        service: 'session',
        method: 'request_sessions',
        payload: taskHistoryPayload(),
      },
      'chat',
    );

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'protocol_response',
        requestId: 'bad-route',
        error: {
          code: 'invalid_route',
          message:
            'Protocol route mismatch: request_task_history received session.request_sessions, expected task.request_task_history',
        },
      },
      'chat',
    );
  });

  it('returns a protocol error when the source surface is not allowed', async () => {
    const postMessage = vi.fn();
    const server = new ProtocolServer({ postMessage });

    server.register(
      { service: 'task', method: 'request_task_history', payloadType: 'request_task_history' },
      () => undefined,
    );

    await server.handleRequest(
      {
        type: 'protocol_request',
        requestId: 'bad-surface',
        service: 'task',
        method: 'request_task_history',
        payload: taskHistoryPayload(),
      },
      'tree',
    );

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'protocol_response',
        requestId: 'bad-surface',
        error: {
          code: 'invalid_surface',
          message: 'Protocol surface mismatch: request_task_history received tree, expected chat',
        },
      },
      'tree',
    );
  });

  it('sends a terminal ack when a unary handler returns without a response', async () => {
    const postMessage = vi.fn();
    const server = new ProtocolServer({ postMessage });

    server.register(
      { service: 'task', method: 'request_task_history', payloadType: 'request_task_history' },
      () => undefined,
    );

    await server.handleRequest(
      {
        type: 'protocol_request',
        requestId: 'ack-1',
        service: 'task',
        method: 'request_task_history',
        payload: taskHistoryPayload(),
      },
      'chat',
    );

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'protocol_response',
        requestId: 'ack-1',
      },
      'chat',
    );
  });

  it('treats a unary response as final and suppresses later handler errors', async () => {
    const postMessage = vi.fn();
    const server = new ProtocolServer({ postMessage });

    server.register(
      { service: 'task', method: 'request_task_history', payloadType: 'request_task_history' },
      (context) => {
        context.respond({
          type: 'task_history_result',
          query: '',
          purpose: 'panel',
          tasks: [],
          offset: 0,
          hasMore: false,
          nextOffset: 0,
        });
        throw new Error('late failure');
      },
    );

    await server.handleRequest(
      {
        type: 'protocol_request',
        requestId: 'request-final',
        service: 'task',
        method: 'request_task_history',
        payload: taskHistoryPayload(),
      },
      'chat',
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'protocol_response',
        requestId: 'request-final',
        payload: expect.objectContaining({ type: 'task_history_result' }),
      }),
      'chat',
    );
  });
});
