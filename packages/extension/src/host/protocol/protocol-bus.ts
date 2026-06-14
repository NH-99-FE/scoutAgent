// ============================================================
// Protocol bus — Webview protocol manifest 分发层
// 负责：按 shared manifest 校验 route，并把请求派发给已注册 handler。
// ============================================================

import type { ScoutProtocolService, WebviewRequestPayload } from '@scout-agent/shared';
import { SCOUT_PROTOCOL } from '@scout-agent/shared';
import type { ProtocolHandler, ProtocolHandlerContext } from './protocol-server.ts';

// ---------- 类型 ----------

export interface ProtocolHandlerRoute {
  service: ScoutProtocolService;
  method: string;
  payloadType?: WebviewRequestPayload['type'];
}

// ---------- Bus ----------

export class ProtocolBus {
  private readonly handlers = new Map<string, ProtocolHandler>();
  private readonly routes = new Map<string, ProtocolHandlerRoute>();

  register(route: ProtocolHandlerRoute, handler: ProtocolHandler): void {
    const key = this.getRouteKey(route.service, route.method);
    if (this.handlers.has(key)) {
      throw new Error(`Protocol handler already registered: ${route.service}.${route.method}`);
    }
    this.routes.set(key, route);
    this.handlers.set(key, handler);
  }

  async dispatch(context: ProtocolHandlerContext): Promise<void> {
    const request = context.request;
    const routeKey = this.getRouteKey(request.service, request.method);
    const route = this.routes.get(routeKey);
    const handler = this.handlers.get(routeKey);
    const expectedRoute = SCOUT_PROTOCOL[request.payload.type];

    if (!expectedRoute) {
      context.error('invalid_payload', `Unknown protocol payload: ${request.payload.type}`);
      return;
    }
    if (expectedRoute.service !== request.service || expectedRoute.method !== request.method) {
      context.error(
        'invalid_route',
        `Protocol route mismatch: ${request.payload.type} received ${routeKey}, expected ${this.getRouteKey(
          expectedRoute.service,
          expectedRoute.method,
        )}`,
      );
      return;
    }
    const allowedSurfaces = expectedRoute.surfaces as readonly string[] | undefined;
    if (allowedSurfaces && !allowedSurfaces.includes(context.surface)) {
      context.error(
        'invalid_surface',
        `Protocol surface mismatch: ${request.payload.type} received ${context.surface}, expected ${allowedSurfaces.join(
          ', ',
        )}`,
      );
      return;
    }
    if (!handler || !route) {
      context.error('method_not_found', `Unknown protocol method: ${routeKey}`);
      return;
    }
    if (route.payloadType && request.payload.type !== route.payloadType) {
      context.error(
        'invalid_payload',
        `Protocol payload mismatch: ${routeKey} received ${request.payload.type}, expected ${route.payloadType}`,
      );
      return;
    }

    await handler(context);
  }

  private getRouteKey(service: ScoutProtocolService, method: string): string {
    return `${service}.${method}`;
  }
}
