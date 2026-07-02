// ============================================================
// ScoutController — Webview 路由层 + 事件转发
// 职责仅剩：Webview 消息路由 → 委托 ExtensionSessionCoordinator
//            ExtensionSessionCoordinator 事件 → 转发 Webview
// ============================================================

import * as vscode from 'vscode';
import type { ExtensionMessage, WebviewMessage } from '@scout-agent/shared';
import { ConfigManager } from './config-manager.ts';
import { getDefaultUserConfigDir } from './settings-manager.ts';
import { ExtensionSessionCoordinator } from './host/session-coordinator.ts';
import type { ScoutWebviewSurface } from './host/webview-surface.ts';
import { WebviewSurfaceRegistry } from './host/webview-surface-registry.ts';
import { SessionIndex } from './host/session-index.ts';
import type { FileReviewTurnSnapshot } from './core/review/file-review.ts';
import type { FileReviewArtifact } from './host/review/file-review-artifact.ts';
import { ProtocolServer } from './host/protocol/protocol-server.ts';
import {
  createScoutProtocolHostServices,
  type ScoutProtocolHostServices,
} from './host/protocol/scout-protocol-host-services.ts';
import { registerScoutProtocolServices } from './host/protocol/services/index.ts';

// ---------- 接口 ----------

export interface ScoutControllerOptions {
  extensionUri: vscode.Uri;
  outputChannel: vscode.OutputChannel;
  cwd: string;
  openSettingsPanel?: () => void | Promise<void>;
  openTreePanel?: () => void | Promise<void>;
  openChangesReviewPanel?: (
    review: FileReviewTurnSnapshot | FileReviewArtifact,
    options: { allowCurrentFileContextExpansion?: boolean; cwd: string; recordId?: string },
  ) => void | Promise<void>;
}

// ---------- Controller ----------

export class ScoutController implements vscode.Disposable {
  private readonly extensionUri: vscode.Uri;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly cwd: string;
  private readonly agentDir: string;
  private readonly configManager: ConfigManager;
  private readonly sessionManager: ExtensionSessionCoordinator;
  private readonly sessionIndex: SessionIndex;
  private readonly protocolHostServices: ScoutProtocolHostServices;
  private readonly protocolServer: ProtocolServer;
  private readonly webviewRegistry: WebviewSurfaceRegistry;
  private readonly disposables: vscode.Disposable[] = [];

  private unsubscribeSession?: () => void;
  private disposePromise?: Promise<void>;

  constructor(options: ScoutControllerOptions) {
    this.extensionUri = options.extensionUri;
    this.outputChannel = options.outputChannel;
    this.cwd = options.cwd;
    this.agentDir = getDefaultUserConfigDir();
    this.configManager = new ConfigManager({
      cwd: this.cwd,
      userConfigDir: this.agentDir,
    });

    this.sessionManager = new ExtensionSessionCoordinator({
      cwd: this.cwd,
      agentDir: this.agentDir,
      outputChannel: this.outputChannel,
      configManager: this.configManager,
    });
    this.sessionIndex = new SessionIndex({
      listWorkspace: () => this.sessionManager.listSessions(),
      listAll: () => this.sessionManager.listSessions({ all: true }),
    });
    this.webviewRegistry = new WebviewSurfaceRegistry({
      onMessage: (message, surface) => this.handleWebviewMessage(message, surface),
      onInvalidMessage: (message, surface) =>
        this.outputChannel.appendLine(`[scout] Invalid webview message (${surface}): ${message}`),
    });
    this.protocolHostServices = createScoutProtocolHostServices({
      cwd: this.cwd,
      agentDir: this.agentDir,
      sessionManager: this.sessionManager,
      configManager: this.configManager,
      sessionIndex: this.sessionIndex,
      postMessage: (message, surface) => this.postMessage(message, surface),
      openSettingsPanel: options.openSettingsPanel,
      openTreePanel: options.openTreePanel,
      openChangesReviewPanel: options.openChangesReviewPanel,
      openTextFile: async (filePath) => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        await vscode.window.showTextDocument(document);
      },
      showErrorMessage: (message) => {
        void vscode.window.showErrorMessage(message);
      },
      log: (message) => this.outputChannel.appendLine(message),
    });
    this.protocolServer = new ProtocolServer({
      postMessage: (message, surface) => this.postMessage(message, surface),
    });
    registerScoutProtocolServices(this.protocolServer, this.protocolHostServices.protocolServices);

    // 监听 ExtensionSessionCoordinator 事件
    this.unsubscribeSession = this.sessionManager.subscribe((event) =>
      this.protocolHostServices.sessionEventForwarder.handle(event),
    );
  }

  // ---------- 公开 API ----------

  bindWebview(webview: vscode.Webview, surface: ScoutWebviewSurface = 'chat'): vscode.Disposable {
    return this.webviewRegistry.bindWebview(webview, surface);
  }

  handleWebviewMessage(message: WebviewMessage, surface: ScoutWebviewSurface = 'chat'): void {
    switch (message.type) {
      case 'control_abort':
        void this.sessionManager.abort();
        break;
      case 'control_abort_retry':
        void this.sessionManager.abortRetry();
        break;
      case 'protocol_request':
        void this.protocolServer.handleRequest(message, surface);
        break;
      case 'protocol_cancel':
        this.protocolServer.cancel(message.requestId);
        break;
    }
  }

  async disposeAsync(): Promise<void> {
    if (this.disposePromise) {
      return this.disposePromise;
    }

    this.disposePromise = (async () => {
      this.unsubscribeSession?.();
      this.unsubscribeSession = undefined;
      this.protocolServer.dispose();
      const sessionManager = this.sessionManager as ExtensionSessionCoordinator & {
        disposeAsync?: () => Promise<void>;
      };
      if (sessionManager.disposeAsync) {
        await sessionManager.disposeAsync();
      } else {
        sessionManager.dispose();
      }
      for (const d of this.disposables) d.dispose();
      this.disposables.length = 0;
      this.webviewRegistry.dispose();
    })();

    return this.disposePromise;
  }

  dispose(): void {
    this.unsubscribeSession?.();
    void this.disposeAsync();
  }

  // ---------- 通信 ----------

  private postMessage(message: ExtensionMessage, surface?: ScoutWebviewSurface): void {
    this.webviewRegistry.postMessage(message, surface);
  }
}
