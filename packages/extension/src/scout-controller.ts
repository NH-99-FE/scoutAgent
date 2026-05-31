// ============================================================
// ScoutController — Webview 路由层 + 事件转发
// 职责仅剩：Webview 消息路由 → 委托 SessionManager
//            SessionManager 事件 → 转发 Webview
// ============================================================

import * as vscode from 'vscode';
import type { ExtensionMessage, ScoutWebviewState, WebviewMessage } from '@scout-agent/shared';
import { ConfigManager } from './config-manager.ts';
import { SessionManager, type ScoutSessionEvent } from './session-manager.ts';

// ---------- 接口 ----------

export interface ScoutControllerOptions {
  extensionUri: vscode.Uri;
  outputChannel: vscode.OutputChannel;
  cwd: string;
}

// ---------- Controller ----------

export class ScoutController implements vscode.Disposable {
  private readonly extensionUri: vscode.Uri;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly cwd: string;
  private readonly agentDir: string;
  private readonly configManager: ConfigManager;
  private readonly sessionManager: SessionManager;
  private readonly disposables: vscode.Disposable[] = [];

  private webview?: vscode.Webview;
  private unsubscribeSession?: () => void;

  constructor(options: ScoutControllerOptions) {
    this.extensionUri = options.extensionUri;
    this.outputChannel = options.outputChannel;
    this.cwd = options.cwd;
    this.agentDir = this.resolveAgentDir();
    this.configManager = new ConfigManager({ cwd: this.cwd, agentDir: this.agentDir });

    this.sessionManager = new SessionManager({
      cwd: this.cwd,
      agentDir: this.agentDir,
      outputChannel: this.outputChannel,
      configManager: this.configManager,
    });

    // 监听 SessionManager 事件
    this.unsubscribeSession = this.sessionManager.subscribe((event) => this.onSessionEvent(event));

    // 监听配置变更
    this.disposables.push(
      this.configManager.onDidChangeSettings(() => {
        this.pushConfig();
      }),
    );
  }

  // ---------- 公开 API ----------

  bindWebview(webview: vscode.Webview): void {
    this.webview = webview;
    webview.onDidReceiveMessage(
      (message: WebviewMessage) => {
        this.handleWebviewMessage(message);
      },
      undefined,
      this.disposables,
    );
  }

  handleWebviewMessage(message: WebviewMessage): void {
    switch (message.type) {
      case 'ready':
        this.onReady();
        break;
      case 'user_message':
        this.sessionManager.prompt(message.text);
        break;
      case 'abort':
        this.sessionManager.abort();
        break;
      case 'abort_retry':
        this.sessionManager.abortRetry();
        break;
      case 'continue_session':
        this.sessionManager.continue();
        break;
      case 'select_model':
        this.sessionManager.setModel(message.modelId);
        break;
      case 'select_thinking':
        this.sessionManager.setThinkingLevel(message.level);
        break;
      case 'clear_conversation':
        this.sessionManager.newSession();
        break;
      case 'delete_session':
        this.handleDeleteSession(message);
        break;
      case 'fork_session':
        this.sessionManager.fork(message.entryId, message.position);
        break;
      case 'request_tree':
        this.handleRequestTree();
        break;
      case 'navigate_tree':
        this.handleNavigateTree(message);
        break;
      case 'set_label':
        this.handleSetLabel(message);
        break;
    }
  }

  dispose(): void {
    this.unsubscribeSession?.();
    this.sessionManager.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }

  // ---------- SessionManager 事件转发 ----------

  private onSessionEvent(event: ScoutSessionEvent): void {
    if (event.type === 'agent_event') {
      this.postMessage({ type: 'agent_event', event: event.event });
    }

    // 转发 retry 事件
    if (event.type === 'retry_start') {
      this.postMessage({
        type: 'retry_start',
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        errorMessage: event.message,
      });
    }
    if (event.type === 'retry_end') {
      this.postMessage({
        type: 'retry_end',
        success: event.success,
        attempt: event.attempt,
        finalError: event.finalError,
      });
    }

    if (event.type === 'state_change' || event.type === 'error') {
      this.pushState();
    }

    if (event.type === 'tree_change') {
      this.pushTreeData();
    }
  }

  // ---------- Webview 消息处理 ----------

  private async onReady(): Promise<void> {
    this.outputChannel.appendLine('[scout] Webview ready');
    await this.sessionManager.initialize();
    this.pushConfig();
    this.pushState();
  }

  // ---------- 状态同步 ----------

  private pushState(): void {
    this.postMessage({ type: 'state_update', state: this.buildState() });
  }

  private pushConfig(): void {
    this.postMessage({ type: 'config_update', config: this.configManager.getScoutConfig() });
  }

  private buildState(): ScoutWebviewState {
    return {
      messages: this.sessionManager.getScoutMessages(),
      isStreaming: this.sessionManager.isStreaming,
      modelId: this.sessionManager.model?.id ?? '',
      thinkingLevel: this.sessionManager.thinkingLevel,
      sessionId: this.sessionManager.sessionId,
      parentSessionPath: this.sessionManager.parentSessionPath,
      leafId: this.sessionManager.leafId,
    };
  }

  // ---------- 通信 ----------

  private postMessage(message: ExtensionMessage): void {
    this.webview?.postMessage(message);
  }

  // ---------- Tree / Navigation / Label ----------

  private async handleRequestTree(): Promise<void> {
    await this.pushTreeData();
  }

  private async handleNavigateTree(message: {
    targetId: string;
    summarize: boolean;
    customInstructions?: string;
    label?: string;
  }): Promise<void> {
    try {
      const result = await this.sessionManager.navigateTree(message.targetId, {
        summarize: message.summarize,
        customInstructions: message.customInstructions,
        label: message.label,
      });
      this.postMessage({
        type: 'navigate_tree_result',
        success: !result.cancelled,
        editorText: result.editorText,
      });
    } catch (error) {
      this.postMessage({
        type: 'navigate_tree_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleSetLabel(message: { entryId: string; label?: string }): Promise<void> {
    try {
      await this.sessionManager.setLabel(message.entryId, message.label);
      this.postMessage({ type: 'label_result', success: true });
    } catch (error) {
      this.postMessage({
        type: 'label_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleDeleteSession(message: {
    sessionId: string;
    sessionPath: string;
  }): Promise<void> {
    try {
      // 直接用 Webview 传来的路径构造 metadata，避免重新列举所有 session
      const sessions = await this.sessionManager.listSessions();
      const target = sessions.find(
        (s) => s.id === message.sessionId || s.path === message.sessionPath,
      );
      if (!target) {
        this.postMessage({
          type: 'delete_session_result',
          success: false,
          error: `Session not found: ${message.sessionId}`,
        });
        return;
      }
      await this.sessionManager.deleteSession(target);
      this.postMessage({ type: 'delete_session_result', success: true });
    } catch (error) {
      this.postMessage({
        type: 'delete_session_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async pushTreeData(): Promise<void> {
    const tree = await this.sessionManager.getTree();
    const leafId = this.sessionManager.leafId;
    this.postMessage({ type: 'tree_data', tree, leafId });
  }

  // ---------- 辅助 ----------

  private resolveAgentDir(): string {
    // 默认在 cwd 下的 .scout 目录
    return vscode.Uri.joinPath(vscode.Uri.file(this.cwd), '.scout').fsPath;
  }
}
