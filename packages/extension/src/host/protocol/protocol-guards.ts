// ============================================================
// Protocol guards — Webview → Extension 边界消息校验
// ============================================================

import type { ScoutProtocolPayloadType, WebviewMessage } from '@scout-agent/shared';
import { SCOUT_PROTOCOL } from '@scout-agent/shared';
import { validateWebviewRequestPayload } from './protocol-payload-guards.ts';

export interface WebviewMessageGuardResult {
  ok: boolean;
  message?: WebviewMessage;
  requestId?: string;
  error: string;
}

export function validateWebviewMessage(value: unknown): WebviewMessageGuardResult {
  if (!isRecord(value)) {
    return { ok: false, error: 'Expected object message' };
  }

  const requestId = typeof value.requestId === 'string' ? value.requestId : undefined;
  if (value.type === 'protocol_cancel') {
    if (!requestId) {
      return { ok: false, error: 'protocol_cancel.requestId must be a string' };
    }
    return { ok: true, message: value as unknown as WebviewMessage, error: '' };
  }

  if (value.type === 'control_abort' || value.type === 'control_abort_retry') {
    return { ok: true, message: value as unknown as WebviewMessage, error: '' };
  }

  if (value.type !== 'protocol_request') {
    return { ok: false, requestId, error: `Unknown message type: ${String(value.type)}` };
  }
  if (!requestId) {
    return { ok: false, error: 'protocol_request.requestId must be a string' };
  }
  if (typeof value.service !== 'string' || typeof value.method !== 'string') {
    return {
      ok: false,
      requestId,
      error: 'protocol_request.service and method must be strings',
    };
  }
  const payload = value.payload;
  if (!isRecord(payload) || typeof payload.type !== 'string') {
    return { ok: false, requestId, error: 'protocol_request.payload.type must be a string' };
  }
  if (!isKnownPayloadType(payload.type)) {
    return { ok: false, requestId, error: `Unknown payload type: ${payload.type}` };
  }

  const route = SCOUT_PROTOCOL[payload.type];
  if (route.service !== value.service || route.method !== value.method) {
    return {
      ok: false,
      requestId,
      error: `Route mismatch for ${payload.type}: ${value.service}.${value.method}`,
    };
  }

  const payloadResult = validateWebviewRequestPayload(payload);
  if (!payloadResult.ok) {
    return { ok: false, requestId, error: payloadResult.error };
  }

  return { ok: true, message: value as unknown as WebviewMessage, error: '' };
}

function isKnownPayloadType(type: string): type is ScoutProtocolPayloadType {
  return type in SCOUT_PROTOCOL;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
