// ============================================================
// Extension UI request broker — 扩展 UI 请求生命周期
// ============================================================

import type { ExtensionEventMessage, ScoutExtensionUIRequest } from '@scout-agent/shared';
import type {
  ExtensionUIContext,
  ExtensionUIDialogOptions,
} from '../../../core/extensions/index.ts';
import type { ProtocolPayload } from './types.ts';

// ---------- 类型 ----------

type ExtensionUIRequestMethod = 'confirm' | 'select' | 'input';
type ExtensionUIRequestClosedReason = Extract<
  ExtensionEventMessage,
  { type: 'extension_ui_request_closed' }
>['reason'];

type PendingExtensionUIRequest =
  | {
      method: 'confirm';
      request: Extract<ScoutExtensionUIRequest, { method: 'confirm' }>;
      resolve: (value: boolean) => void;
      cleanup: () => void;
    }
  | {
      method: 'select' | 'input';
      request: Extract<ScoutExtensionUIRequest, { method: 'select' | 'input' }>;
      resolve: (value: string | undefined) => void;
      cleanup: () => void;
    };

interface ExtensionUIRequestBrokerOptions {
  publishEvent: (message: ExtensionEventMessage) => void;
  notify: (message: string, type?: 'info' | 'warning' | 'error') => void;
}

// ---------- Broker ----------

export class ExtensionUIRequestBroker {
  private readonly publishEvent: (message: ExtensionEventMessage) => void;
  private readonly notifyFn: (message: string, type?: 'info' | 'warning' | 'error') => void;
  private readonly pendingRequests = new Map<string, PendingExtensionUIRequest>();

  constructor(options: ExtensionUIRequestBrokerOptions) {
    this.publishEvent = options.publishEvent;
    this.notifyFn = options.notify;
  }

  createContext(): ExtensionUIContext {
    return {
      select: (title, options, opts) => this.requestSelect(title, options, opts),
      confirm: (title, message, opts) => this.requestConfirm(title, message, opts),
      input: (title, placeholder, opts) => this.requestInput(title, placeholder, opts),
      notify: (message, type = 'info') => this.notifyFn(message, type),
    };
  }

  getPendingRequests(): ScoutExtensionUIRequest[] {
    return Array.from(this.pendingRequests.values(), (pending) => pending.request);
  }

  respond(message: ProtocolPayload<'extension_ui_response'>): void {
    const pending = this.pendingRequests.get(message.id);
    if (!pending) return;

    this.close(message.id, pending, 'responded');

    if (message.action === 'cancel') {
      this.resolveCancelled(pending);
      return;
    }
    if (pending.method === 'confirm') {
      pending.resolve(message.action === 'confirm');
      return;
    }
    if (pending.method === message.action) {
      pending.resolve(message.value);
      return;
    }
    this.resolveCancelled(pending);
  }

  cancelAll(reason: ExtensionUIRequestClosedReason): void {
    for (const [id, pending] of this.pendingRequests) {
      this.close(id, pending, reason);
      this.resolveCancelled(pending);
    }
  }

  private requestConfirm(
    title: string,
    message: string,
    opts?: ExtensionUIDialogOptions,
  ): Promise<boolean> {
    if (opts?.signal?.aborted) return Promise.resolve(false);
    const id = createExtensionUIRequestId();
    return new Promise((resolve) => {
      const cleanup = this.registerPendingRequest(id, 'confirm', opts);
      const request: ScoutExtensionUIRequest = {
        type: 'extension_ui_request',
        id,
        method: 'confirm',
        title,
        message,
        timeout: opts?.timeout,
        variant: opts?.variant,
        body: opts?.body,
      };
      this.pendingRequests.set(id, { method: 'confirm', request, resolve, cleanup });
      this.publishEvent(request);
    });
  }

  private requestSelect(
    title: string,
    options: string[],
    opts?: ExtensionUIDialogOptions,
  ): Promise<string | undefined> {
    if (opts?.signal?.aborted) return Promise.resolve(undefined);
    const id = createExtensionUIRequestId();
    return new Promise((resolve) => {
      const cleanup = this.registerPendingRequest(id, 'select', opts);
      const request: ScoutExtensionUIRequest = {
        type: 'extension_ui_request',
        id,
        method: 'select',
        title,
        options,
        timeout: opts?.timeout,
        variant: opts?.variant,
        body: opts?.body,
      };
      this.pendingRequests.set(id, { method: 'select', request, resolve, cleanup });
      this.publishEvent(request);
    });
  }

  private requestInput(
    title: string,
    placeholder?: string,
    opts?: ExtensionUIDialogOptions,
  ): Promise<string | undefined> {
    if (opts?.signal?.aborted) return Promise.resolve(undefined);
    const id = createExtensionUIRequestId();
    return new Promise((resolve) => {
      const cleanup = this.registerPendingRequest(id, 'input', opts);
      const request: ScoutExtensionUIRequest = {
        type: 'extension_ui_request',
        id,
        method: 'input',
        title,
        placeholder,
        timeout: opts?.timeout,
        variant: opts?.variant,
        body: opts?.body,
      };
      this.pendingRequests.set(id, { method: 'input', request, resolve, cleanup });
      this.publishEvent(request);
    });
  }

  private registerPendingRequest(
    id: string,
    method: ExtensionUIRequestMethod,
    opts?: ExtensionUIDialogOptions,
  ): () => void {
    let timeoutHandle: NodeJS.Timeout | undefined;
    const settle = (reason: ExtensionUIRequestClosedReason) => {
      const pending = this.pendingRequests.get(id);
      if (!pending) return;
      this.close(id, pending, reason);
      this.resolveCancelled(pending);
    };
    const abortHandler = () => settle('aborted');

    if (opts?.timeout !== undefined && opts.timeout > 0) {
      timeoutHandle = setTimeout(() => settle('timeout'), opts.timeout);
    }
    opts?.signal?.addEventListener('abort', abortHandler, { once: true });

    return () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      opts?.signal?.removeEventListener('abort', abortHandler);
    };
  }

  private close(
    id: string,
    pending: PendingExtensionUIRequest,
    reason: ExtensionUIRequestClosedReason,
  ): void {
    this.pendingRequests.delete(id);
    pending.cleanup();
    this.publishEvent({ type: 'extension_ui_request_closed', id, reason });
  }

  private resolveCancelled(pending: PendingExtensionUIRequest): void {
    if (pending.method === 'confirm') {
      pending.resolve(false);
    } else {
      pending.resolve(undefined);
    }
  }
}

function createExtensionUIRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `extension-ui:${Date.now()}:${Math.random().toString(36).slice(2)}`
  );
}
