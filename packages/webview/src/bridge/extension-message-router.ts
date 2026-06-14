// ============================================================
// Extension message router — Extension → Webview transport 分流
// ============================================================

import type { ExtensionMessage } from '@scout-agent/shared';
import { EXTENSION_EVENT_TYPES, projectExtensionEvent } from './extension-event-projector';
import { routeProtocolResponse } from './transport-client';

export function routeExtensionMessage(message: ExtensionMessage): void {
  if (message.type === 'protocol_response') {
    routeProtocolResponse(message);
    return;
  }
  projectExtensionEvent(message);
}

export function startExtensionMessageRouter(): () => void {
  const handler = (event: MessageEvent<unknown>) => {
    if (!isExtensionMessage(event.data)) return;
    routeExtensionMessage(event.data);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as { type?: unknown; requestId?: unknown };
  if (typeof message.type !== 'string') return false;
  if (message.type === 'protocol_response') {
    return typeof message.requestId === 'string';
  }
  return EXTENSION_EVENT_TYPES.has(message.type);
}
