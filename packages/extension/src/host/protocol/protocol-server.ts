// ============================================================
// Protocol server — Webview protocol envelope 分发层
// 负责：按 service/method 注册 handler，统一 response、error、cancel。
// ============================================================

import type {
  ExtensionEventMessage,
  ExtensionMessage,
  ScoutProtocolResponsePayload,
  ScoutProtocolRequest,
  WebviewRequestPayload,
} from '@scout-agent/shared';
import type { ScoutWebviewSurface } from '../webview-surface.ts';
import { ProtocolBus } from './protocol-bus.ts';
import type { ProtocolHandlerRoute } from './protocol-bus.ts';
import {
  ProtocolRequestRegistry,
  type ProtocolRequestCleanup,
  type ProtocolRequestHandle,
} from './request-registry.ts';

// ---------- 类型 ----------

export type { ProtocolHandlerRoute } from './protocol-bus.ts';

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
  respond: (payload?: ScoutProtocolResponsePayload, options?: ProtocolResponseOptions) => void;
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
  private readonly bus = new ProtocolBus();
  private readonly registry = new ProtocolRequestRegistry();
  private readonly postMessage: (message: ExtensionMessage, surface?: ScoutWebviewSurface) => void;

  constructor(options: ProtocolServerOptions) {
    this.postMessage = options.postMessage;
  }

  register(route: ProtocolHandlerRoute, handler: ProtocolHandler): void {
    this.bus.register(route, handler);
  }

  async handleRequest(request: ScoutProtocolRequest, surface: ScoutWebviewSurface): Promise<void> {
    const handle = this.registry.begin(request, surface);
    const context = this.createContext(request, surface, handle);

    try {
      await this.bus.dispatch(context);
      if (!request.streaming && !handle.isClosed() && !handle.hasResponded()) {
        context.respond();
      }
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
        };
        if (payload !== undefined) {
          message.payload = payload;
        }
        if (options?.done !== undefined) {
          message.done = options.done;
        }
        if (request.streaming) {
          message.sequence = handle.nextSequence();
        }
        handle.markResponded();
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
        handle.markResponded();
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
}
