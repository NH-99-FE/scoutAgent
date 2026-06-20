import { describe, expect, it } from 'vitest';
import { SCOUT_PROTOCOL, type WebviewRequestPayload } from '@scout-agent/shared';
import { validateWebviewMessage } from '../../../src/host/protocol/protocol-guards.ts';

function request(payload: WebviewRequestPayload | Record<string, unknown>) {
  const payloadType = payload.type;
  const route =
    typeof payloadType === 'string' && payloadType in SCOUT_PROTOCOL
      ? SCOUT_PROTOCOL[payloadType as WebviewRequestPayload['type']]
      : { service: 'session' as const, method: 'unknown' };
  return {
    type: 'protocol_request',
    requestId: 'request-1',
    service: route.service,
    method: route.method,
    payload,
  };
}

describe('validateWebviewMessage', () => {
  it('accepts high-priority control abort messages without protocol envelope fields', () => {
    expect(validateWebviewMessage({ type: 'control_abort' })).toMatchObject({
      ok: true,
      message: { type: 'control_abort' },
    });
    expect(validateWebviewMessage({ type: 'control_abort_retry' })).toMatchObject({
      ok: true,
      message: { type: 'control_abort_retry' },
    });
  });

  it('accepts a valid protocol request with optional undefined fields', () => {
    const result = validateWebviewMessage(
      request({ type: 'request_file_mentions', query: 'src', limit: undefined }),
    );

    expect(result.ok).toBe(true);
    expect(result.message?.type).toBe('protocol_request');
  });

  it('rejects missing required payload fields', () => {
    const result = validateWebviewMessage(request({ type: 'user_message' }));

    expect(result).toMatchObject({
      ok: false,
      requestId: 'request-1',
      error: 'user_message.text must be a string',
    });
  });

  it('rejects invalid payload enum values', () => {
    const result = validateWebviewMessage(
      request({ type: 'fork_session', entryId: 'entry-1', position: 'after' }),
    );

    expect(result).toMatchObject({
      ok: false,
      requestId: 'request-1',
      error: 'fork_session.position must be one of before, at',
    });
  });

  it('rejects unexpected payload fields', () => {
    const result = validateWebviewMessage(
      request({ type: 'request_state', extensionInternalState: true }),
    );

    expect(result).toMatchObject({
      ok: false,
      requestId: 'request-1',
      error: 'request_state.extensionInternalState is not a protocol field',
    });
  });

  it('rejects malformed image payloads', () => {
    const result = validateWebviewMessage(
      request({
        type: 'new_session_message',
        text: 'hello',
        images: [{ type: 'image', data: 'base64', mimeType: 1 }],
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      requestId: 'request-1',
      error: 'new_session_message.images[0].mimeType must be a string',
    });
  });

  it('keeps route mismatch errors separate from payload schema errors', () => {
    const route = SCOUT_PROTOCOL.request_config;
    const result = validateWebviewMessage({
      type: 'protocol_request',
      requestId: 'request-1',
      service: 'session',
      method: route.method,
      payload: { type: 'request_config' },
    });

    expect(result).toMatchObject({
      ok: false,
      requestId: 'request-1',
      error: 'Route mismatch for request_config: session.request_config',
    });
  });
});
