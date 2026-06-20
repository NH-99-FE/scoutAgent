import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  cancelProtocolRequest,
  discardProtocolRequest,
  resetProtocolTransport,
  routeProtocolResponse,
  sendControlMessage,
  sendProtocolRequest,
  setDefaultProtocolErrorHandler,
} from '@/bridge/transport-client';
import type { ScoutProtocolResponsePayload } from '@scout-agent/shared';

const postMessage = vi.fn();

const TASK_HISTORY_RESPONSE: ScoutProtocolResponsePayload = {
  type: 'task_history_result',
  query: '',
  purpose: 'panel',
  tasks: [],
  offset: 0,
  hasMore: false,
  nextOffset: 0,
};

function sendTaskHistoryRequest(onResponse = vi.fn()): string {
  return sendProtocolRequest(
    {
      type: 'request_task_history',
      query: '',
      purpose: 'panel',
    },
    {
      service: 'task',
      method: 'request_task_history',
      onResponse,
    },
  );
}

describe('transport-client', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'acquireVsCodeApi', {
      configurable: true,
      value: () => ({
        getState: () => undefined,
        setState: () => undefined,
        postMessage,
      }),
    });
  });

  afterEach(() => {
    postMessage.mockClear();
    resetProtocolTransport();
  });

  it('generates a transport requestId and posts a protocol envelope', () => {
    const requestId = sendTaskHistoryRequest();

    expect(requestId).toEqual(expect.any(String));
    expect(postMessage).toHaveBeenCalledWith({
      type: 'protocol_request',
      requestId,
      service: 'task',
      method: 'request_task_history',
      payload: {
        type: 'request_task_history',
        query: '',
        purpose: 'panel',
      },
    });
  });

  it('posts control messages without allocating a protocol request', () => {
    sendControlMessage({ type: 'control_abort' });

    expect(postMessage).toHaveBeenCalledWith({ type: 'control_abort' });
  });

  it('routes responses only to the pending callback with the same requestId', () => {
    const firstResponse = vi.fn();
    const secondResponse = vi.fn();
    const firstRequestId = sendTaskHistoryRequest(firstResponse);
    const secondRequestId = sendTaskHistoryRequest(secondResponse);

    routeProtocolResponse({
      type: 'protocol_response',
      requestId: secondRequestId,
      payload: TASK_HISTORY_RESPONSE,
    });

    expect(firstRequestId).not.toBe(secondRequestId);
    expect(firstResponse).not.toHaveBeenCalled();
    expect(secondResponse).toHaveBeenCalledWith(TASK_HISTORY_RESPONSE);
  });

  it('sends protocol cancellation and ignores late responses', () => {
    const onResponse = vi.fn();
    const requestId = sendTaskHistoryRequest(onResponse);
    postMessage.mockClear();

    cancelProtocolRequest(requestId);
    routeProtocolResponse({
      type: 'protocol_response',
      requestId,
      payload: TASK_HISTORY_RESPONSE,
    });

    expect(postMessage).toHaveBeenCalledWith({ type: 'protocol_cancel', requestId });
    expect(onResponse).not.toHaveBeenCalled();
  });

  it('discards local callbacks without sending cancellation for superseded requests', () => {
    const onResponse = vi.fn();
    const requestId = sendTaskHistoryRequest(onResponse);
    postMessage.mockClear();

    discardProtocolRequest(requestId);
    cancelProtocolRequest(requestId);
    routeProtocolResponse({
      type: 'protocol_response',
      requestId,
      payload: TASK_HISTORY_RESPONSE,
    });

    expect(postMessage).not.toHaveBeenCalled();
    expect(onResponse).not.toHaveBeenCalled();
  });

  it('routes protocol errors to the default handler when no pending callback exists', () => {
    const onError = vi.fn();
    setDefaultProtocolErrorHandler(onError);

    routeProtocolResponse({
      type: 'protocol_response',
      requestId: 'missing-request',
      error: { code: 'handler_failed', message: 'boom' },
    });

    expect(onError).toHaveBeenCalledWith('boom', 'handler_failed');
  });
});
