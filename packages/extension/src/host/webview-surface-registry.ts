// ============================================================
// Webview surface registry — Webview surface 绑定与消息投递
// 负责：按 chat/settings/tree surface 管理 Webview listener 和定向 postMessage。
// ============================================================

import * as vscode from 'vscode';
import type { ExtensionMessage, WebviewMessage } from '@scout-agent/shared';
import { validateWebviewMessage } from './protocol/protocol-guards.ts';
import type { ScoutWebviewSurface } from './webview-surface.ts';

// ---------- 类型 ----------

export interface WebviewSurfaceRegistryOptions {
  onMessage: (message: WebviewMessage, surface: ScoutWebviewSurface) => void;
  onInvalidMessage?: (message: string, surface: ScoutWebviewSurface) => void;
}

interface WebviewBinding {
  webview: vscode.Webview;
  listener: vscode.Disposable;
}

// ---------- Registry ----------

export class WebviewSurfaceRegistry implements vscode.Disposable {
  private readonly onMessage: (message: WebviewMessage, surface: ScoutWebviewSurface) => void;
  private readonly onInvalidMessage?: (message: string, surface: ScoutWebviewSurface) => void;
  private readonly bindings = new Map<ScoutWebviewSurface, Set<WebviewBinding>>();

  constructor(options: WebviewSurfaceRegistryOptions) {
    this.onMessage = options.onMessage;
    this.onInvalidMessage = options.onInvalidMessage;
  }

  bindWebview(webview: vscode.Webview, surface: ScoutWebviewSurface = 'chat'): vscode.Disposable {
    const listener = webview.onDidReceiveMessage((message: unknown) => {
      const result = validateWebviewMessage(message);
      if (result.ok && result.message) {
        this.onMessage(result.message, surface);
        return;
      }
      this.onInvalidMessage?.(result.error, surface);
      if (result.requestId) {
        void webview.postMessage({
          type: 'protocol_response',
          requestId: result.requestId,
          error: { code: 'invalid_message', message: result.error },
        });
      }
    });
    const binding: WebviewBinding = { webview, listener };
    const bindings = this.bindings.get(surface) ?? new Set<WebviewBinding>();
    bindings.add(binding);
    this.bindings.set(surface, bindings);

    return new vscode.Disposable(() => {
      this.unbind(surface, binding);
    });
  }

  postMessage(message: ExtensionMessage, surface?: ScoutWebviewSurface): void {
    const targetSets = surface ? [this.bindings.get(surface)] : [...this.bindings.values()];
    for (const bindings of targetSets) {
      if (!bindings) continue;
      for (const binding of bindings) {
        void binding.webview.postMessage(message);
      }
    }
  }

  dispose(): void {
    for (const bindings of this.bindings.values()) {
      for (const binding of bindings) {
        binding.listener.dispose();
      }
    }
    this.bindings.clear();
  }

  private unbind(surface: ScoutWebviewSurface, binding: WebviewBinding): void {
    const bindings = this.bindings.get(surface);
    if (!bindings) return;
    binding.listener.dispose();
    bindings.delete(binding);
    if (bindings.size === 0) {
      this.bindings.delete(surface);
    }
  }
}
