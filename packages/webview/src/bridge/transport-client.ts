// ============================================================
// Transport Client — Webview protocol envelope correlation
// ============================================================

import type {
  ScoutProtocolResponsePayload,
  ScoutProtocolRequest,
  ScoutProtocolResponse,
  ScoutProtocolService,
  WebviewRequestPayload,
} from '@scout-agent/shared';
import { getVsCodeApi } from './vscode-api';

// ---------- 类型 ----------

interface SendProtocolRequestOptions {
  service: ScoutProtocolService;
  method: string;
  streaming?: boolean;
  onResponse?: (payload: ScoutProtocolResponsePayload) => void;
  onError?: (message: string, code: string) => void;
}

interface PendingProtocolRequest {
  onResponse?: (payload: ScoutProtocolResponsePayload) => void;
  onError?: (message: string, code: string) => void;
}

// ---------- 状态 ----------

const pendingRequests = new Map<string, PendingProtocolRequest>();
const activeRequests = new Set<string>();
let defaultErrorHandler: ((message: string, code: string) => void) | undefined;

export function setDefaultProtocolErrorHandler(
  handler: ((message: string, code: string) => void) | undefined,
): void {
  defaultErrorHandler = handler;
}

// ---------- 发送 ----------

export function sendProtocolRequest(
  payload: WebviewRequestPayload,
  options: SendProtocolRequestOptions,
): string {
  const requestId = createProtocolRequestId();
  activeRequests.add(requestId);
  if (options.onResponse || options.onError) {
    pendingRequests.set(requestId, {
      onResponse: options.onResponse,
      onError: options.onError,
    });
  }

  const message: ScoutProtocolRequest = {
    type: 'protocol_request',
    requestId,
    service: options.service,
    method: options.method,
    payload,
  };
  if (options.streaming) {
    message.streaming = true;
  }
  getVsCodeApi().postMessage(message);
  return requestId;
}

export function cancelProtocolRequest(requestId: string): void {
  if (!activeRequests.has(requestId)) return;
  activeRequests.delete(requestId);
  pendingRequests.delete(requestId);
  getVsCodeApi().postMessage({ type: 'protocol_cancel', requestId });
}

export function discardProtocolRequest(requestId: string | undefined): void {
  if (!requestId) return;
  activeRequests.delete(requestId);
  pendingRequests.delete(requestId);
}

// ---------- 回包 ----------

export function routeProtocolResponse(message: ScoutProtocolResponse): void {
  if (message.done !== false) {
    activeRequests.delete(message.requestId);
  }
  const pending = pendingRequests.get(message.requestId);

  if (message.done !== false) {
    pendingRequests.delete(message.requestId);
  }

  if (message.error) {
    const onError = pending?.onError ?? defaultErrorHandler;
    onError?.(message.error.message, message.error.code);
    return;
  }
  if (message.payload && pending) {
    pending.onResponse?.(message.payload);
  }
}

export function resetProtocolTransport(): void {
  pendingRequests.clear();
  activeRequests.clear();
  defaultErrorHandler = undefined;
}

function createProtocolRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random().toString(36).slice(2)}`
  );
}
