// ============================================================
// Request Tracker — Webview 请求与回执关联
// ============================================================

export type ProtocolRequestKind = 'new_session_message' | 'open_task';

const pendingRequestIds = new Map<ProtocolRequestKind, string>();

export function beginProtocolRequest(kind: ProtocolRequestKind): string {
  const requestId = createRequestId();
  pendingRequestIds.set(kind, requestId);
  return requestId;
}

export function discardProtocolRequest(kind: ProtocolRequestKind): void {
  pendingRequestIds.delete(kind);
}

export function completeProtocolRequest(kind: ProtocolRequestKind, requestId: string): boolean {
  if (pendingRequestIds.get(kind) !== requestId) return false;
  pendingRequestIds.delete(kind);
  return true;
}

export function resetProtocolRequests(): void {
  pendingRequestIds.clear();
}

export function createProtocolRequestId(): string {
  return `${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function createRequestId(): string {
  return createProtocolRequestId();
}
