// ============================================================
// Protocol server — Webview protocol envelope 分发层
// 负责：按 service/method 注册 handler，统一 response、error、cancel。
// ============================================================

import type {
  ExtensionEventMessage,
  ExtensionMessage,
  ExtensionResponsePayload,
  ScoutProtocolRequest,
  ScoutProtocolService,
  WebviewRequestPayload,
} from '@scout-agent/shared';
import type { ScoutWebviewSurface } from '../webview-surface.ts';
import {
  ProtocolRequestRegistry,
  type ProtocolRequestCleanup,
  type ProtocolRequestHandle,
} from './request-registry.ts';

// ---------- 类型 ----------

export interface ProtocolHandlerRoute {
  service: ScoutProtocolService;
  method: string;
  payloadType?: WebviewRequestPayload['type'];
}

export interface ProtocolPostOptions {
  broadcast?: boolean;
  surface?: ScoutWebviewSurface;
}

export interface ProtocolResponseOptions {
  done?: boolean;
}

export interface ProtocolHandlerContext {
  request: ScoutProtocolRequest;
  payload: WebviewRequestPayload;
  surface: ScoutWebviewSurface;
  signal: AbortSignal;
  respond: (payload: ExtensionResponsePayload, options?: ProtocolResponseOptions) => void;
  error: (code: string, message: string) => void;
  post: (message: ExtensionEventMessage, options?: ProtocolPostOptions) => void;
  onCleanup: (cleanup: ProtocolRequestCleanup) => void;
  isCanceled: () => boolean;
}

export type ProtocolHandler = (context: ProtocolHandlerContext) => void | Promise<void>;

export interface ProtocolServerOptions {
  postMessage: (message: ExtensionMessage, surface?: ScoutWebviewSurface) => void;
}

// ---------- Server ----------

export class ProtocolServer {
  private readonly handlers = new Map<string, ProtocolHandler>();
  private readonly routes = new Map<string, ProtocolHandlerRoute>();
  private readonly registry = new ProtocolRequestRegistry();
  private readonly postMessage: (message: ExtensionMessage, surface?: ScoutWebviewSurface) => void;

  constructor(options: ProtocolServerOptions) {
    this.postMessage = options.postMessage;
  }

  register(route: ProtocolHandlerRoute, handler: ProtocolHandler): void {
    const key = this.getRouteKey(route.service, route.method);
    if (this.handlers.has(key)) {
      throw new Error(`Protocol handler already registered: ${route.service}.${route.method}`);
    }
    this.routes.set(key, route);
    this.handlers.set(key, handler);
  }

  async handleRequest(request: ScoutProtocolRequest, surface: ScoutWebviewSurface): Promise<void> {
    const handle = this.registry.begin(request, surface);
    const routeKey = this.getRouteKey(request.service, request.method);
    const route = this.routes.get(routeKey);
    const handler = this.handlers.get(routeKey);
    const context = this.createContext(request, surface, handle);

    try {
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
    } catch (error) {
      context.error('handler_failed', error instanceof Error ? error.message : String(error));
    } finally {
      if (!request.streaming) {
        this.registry.finish(request.requestId);
      }
    }
  }

  cancel(requestId: string): boolean {
    return this.registry.cancel(requestId);
  }

  dispose(): void {
    this.registry.dispose();
  }

  private createContext(
    request: ScoutProtocolRequest,
    surface: ScoutWebviewSurface,
    handle: ProtocolRequestHandle,
  ): ProtocolHandlerContext {
    return {
      request,
      payload: request.payload,
      surface,
      signal: handle.signal,
      respond: (payload, options) => {
        if (handle.isClosed()) return;
        const message: ExtensionMessage = {
          type: 'protocol_response',
          requestId: request.requestId,
          payload,
        };
        if (options?.done !== undefined) {
          message.done = options.done;
        }
        if (request.streaming) {
          message.sequence = handle.nextSequence();
        }
        this.postMessage(message, surface);
        if (request.streaming && options?.done !== false) {
          this.registry.finish(request.requestId);
        }
        if (!request.streaming) {
          this.registry.finish(request.requestId);
        }
      },
      error: (code, message) => {
        if (handle.isClosed()) return;
        this.postMessage(
          {
            type: 'protocol_response',
            requestId: request.requestId,
            error: { code, message },
          },
          surface,
        );
        this.registry.finish(request.requestId);
      },
      post: (message, options) => {
        if (handle.isClosed()) return;
        this.postMessage(message, options?.broadcast ? undefined : (options?.surface ?? surface));
      },
      onCleanup: (cleanup) => handle.registerCleanup(cleanup),
      isCanceled: () => handle.isCanceled(),
    };
  }

  private getRouteKey(service: ScoutProtocolService, method: string): string {
    return `${service}.${method}`;
  }
}
