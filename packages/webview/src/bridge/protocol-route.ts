// ============================================================
// Protocol Route — Webview payload 到 Extension service 的路由表
// ============================================================

import {
  SCOUT_PROTOCOL,
  type ScoutProtocolService,
  type WebviewRequestPayload,
} from '@scout-agent/shared';

// ---------- 类型 ----------

export interface ProtocolRoute {
  service: ScoutProtocolService;
  method: string;
}

// ---------- 路由 ----------

export function resolveProtocolRoute(payload: WebviewRequestPayload): ProtocolRoute {
  const route = SCOUT_PROTOCOL[payload.type];
  return { service: route.service, method: route.method };
}
