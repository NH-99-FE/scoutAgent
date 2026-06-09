// ============================================================
// ScoutController — Webview 路由层 + 事件转发
// 职责仅剩：Webview 消息路由 → 委托 ExtensionSessionCoordinator
//            ExtensionSessionCoordinator 事件 → 转发 Webview
// ============================================================

import * as vscode from 'vscode';
import type {
  ExtensionMessage,
  ScoutSessionListItem,
  ScoutWebviewState,
  WebviewMessage,
} from '@scout-agent/shared';
import { ConfigManager } from './config-manager.ts';
import { ExtensionSessionCoordinator, type ScoutSessionEvent } from './host/session-coordinator.ts';
import { readSessionFileInfo } from './core/session-file.ts';
import { isPathInsideOrEqual, resolveSessionCwdPolicy } from './core/session-cwd.ts';

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
  private readonly sessionManager: ExtensionSessionCoordinator;
  private readonly disposables: vscode.Disposable[] = [];

  private webview?: vscode.Webview;
  private unsubscribeSession?: () => void;
  private disposePromise?: Promise<void>;

  constructor(options: ScoutControllerOptions) {
    this.extensionUri = options.extensionUri;
    this.outputChannel = options.outputChannel;
    this.cwd = options.cwd;
    this.agentDir = this.resolveAgentDir();
    this.configManager = new ConfigManager({ cwd: this.cwd, agentDir: this.agentDir });

    this.sessionManager = new ExtensionSessionCoordinator({
      cwd: this.cwd,
      agentDir: this.agentDir,
      outputChannel: this.outputChannel,
      configManager: this.configManager,
    });

    // 监听 ExtensionSessionCoordinator 事件
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
        this.sessionManager.prompt(message.text, { deliverAs: message.deliverAs });
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
      case 'request_sessions':
        void this.handleRequestSessions();
        break;
      case 'restore_session':
        void this.handleRestoreSession(message);
        break;
      case 'pick_import_session':
        void this.handlePickImportSession();
        break;
      case 'import_session':
        void this.handleImportSession(message);
        break;
      case 'select_model':
        this.sessionManager.setModel(message.modelId, message.provider);
        break;
      case 'select_thinking':
        this.sessionManager.setThinkingLevel(message.level);
        break;
      case 'set_active_tools':
        void this.sessionManager.setActiveTools(message.toolNames);
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

  async disposeAsync(): Promise<void> {
    if (this.disposePromise) {
      return this.disposePromise;
    }

    this.disposePromise = (async () => {
      this.unsubscribeSession?.();
      this.unsubscribeSession = undefined;
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
    })();

    return this.disposePromise;
  }

  dispose(): void {
    this.unsubscribeSession?.();
    void this.disposeAsync();
  }

  // ---------- SessionCoordinator 事件转发 ----------

  private onSessionEvent(event: ScoutSessionEvent): void {
    if (event.type === 'agent_event') {
      this.postMessage({ type: 'agent_event', event: event.event });
    }

    // 转发 retry 事件
    if (event.type === 'auto_retry_start') {
      this.postMessage({
        type: 'auto_retry_start',
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        errorMessage: event.errorMessage,
      });
    }
    if (event.type === 'auto_retry_end') {
      this.postMessage({
        type: 'auto_retry_end',
        success: event.success,
        attempt: event.attempt,
        finalError: event.finalError,
      });
    }

    if (event.type === 'compaction_start') {
      this.postMessage({ type: 'compaction_start', reason: event.reason });
    }
    if (event.type === 'compaction_end') {
      this.postMessage({
        type: 'compaction_end',
        reason: event.reason,
        result: event.result,
        aborted: event.aborted,
        willRetry: event.willRetry,
        errorMessage: event.errorMessage,
      });
    }

    if (event.type === 'thinking_level_changed') {
      this.postMessage({ type: 'thinking_level_changed', level: event.level });
    }

    if (event.type === 'state_change' || event.type === 'error') {
      void this.pushState();
    }

    if (event.type === 'tree_change') {
      void this.pushTreeData();
    }
  }

  // ---------- Webview 消息处理 ----------

  private async onReady(): Promise<void> {
    this.outputChannel.appendLine('[scout] Webview ready');
    await this.sessionManager.initialize();
    this.pushConfig();
    await this.pushState();
    await this.handleRequestSessions();
  }

  // ---------- 状态同步 ----------

  private async pushState(): Promise<void> {
    this.postMessage({ type: 'state_update', state: await this.buildState() });
  }

  private pushConfig(): void {
    this.postMessage({ type: 'config_update', config: this.configManager.getScoutConfig() });
  }

  private async buildState(): Promise<ScoutWebviewState> {
    return {
      messages: this.sessionManager.getScoutMessages(),
      isStreaming: this.sessionManager.isStreaming,
      modelProvider: this.sessionManager.model?.provider ?? '',
      modelId: this.sessionManager.model?.id ?? '',
      thinkingLevel: this.sessionManager.thinkingLevel,
      tools: this.sessionManager.getAllToolInfos(),
      activeToolNames: this.sessionManager.getActiveToolNames(),
      sessionId: this.sessionManager.sessionId,
      parentSessionPath: this.sessionManager.parentSessionPath,
      leafId: await this.sessionManager.getVisibleLeafId(),
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
    replaceInstructions?: boolean;
    label?: string;
  }): Promise<void> {
    try {
      const result = await this.sessionManager.navigateTree(message.targetId, {
        summarize: message.summarize,
        customInstructions: message.customInstructions,
        replaceInstructions: message.replaceInstructions,
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
      const sessions = await this.listAvailableSessions();
      const target = this.findSessionByPath(sessions, message);
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

  private async handleRequestSessions(): Promise<void> {
    try {
      const sessions = await this.listAvailableSessions();
      const items: ScoutSessionListItem[] = sessions.map((session) => ({
        id: session.id,
        path: session.path,
        cwd: session.cwd,
        createdAt: session.createdAt,
        parentSessionPath: session.parentSessionPath,
      }));
      this.postMessage({ type: 'sessions_data', sessions: items });
    } catch (error) {
      this.postMessage({ type: 'sessions_data', sessions: [] });
      this.outputChannel.appendLine(
        `[scout] List sessions failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleRestoreSession(message: {
    sessionId: string;
    sessionPath: string;
    cwdOverride?: string;
  }): Promise<void> {
    try {
      const sessions = await this.listAvailableSessions();
      const target = this.findSessionByPath(sessions, message);
      if (!target) {
        this.postMessage({
          type: 'restore_session_result',
          success: false,
          error: `Session not found: ${message.sessionId}`,
        });
        return;
      }

      const cwd = message.cwdOverride ?? (await this.resolveSessionCwd(target.cwd));
      if (!cwd) {
        this.postMessage({ type: 'restore_session_result', success: false, error: 'cancelled' });
        return;
      }

      const result = await this.sessionManager.restore(target, { cwdOverride: cwd });
      this.postMessage({
        type: 'restore_session_result',
        success: !result.cancelled,
        error: result.cancelled ? 'cancelled' : undefined,
      });
      if (!result.cancelled) {
        await this.pushState();
        await this.pushTreeData();
      }
    } catch (error) {
      this.postMessage({
        type: 'restore_session_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleImportSession(message: {
    sessionPath: string;
    cwdOverride?: string;
  }): Promise<void> {
    try {
      const sessionInfo = readSessionFileInfo(message.sessionPath);
      const cwd = message.cwdOverride ?? (await this.resolveSessionCwd(sessionInfo.cwd));
      if (!cwd) {
        this.postMessage({ type: 'import_session_result', success: false, error: 'cancelled' });
        return;
      }

      const result = await this.sessionManager.importSessionFromJsonl(message.sessionPath, {
        cwdOverride: cwd,
      });
      this.postMessage({
        type: 'import_session_result',
        success: !result.cancelled,
        error: result.cancelled ? 'cancelled' : undefined,
      });
      if (!result.cancelled) {
        await this.pushState();
        await this.pushTreeData();
      }
    } catch (error) {
      this.postMessage({
        type: 'import_session_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handlePickImportSession(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'JSONL Session': ['jsonl'], 'All Files': ['*'] },
      openLabel: 'Import Session',
    });
    const sessionPath = selected?.[0]?.fsPath;
    if (!sessionPath) {
      this.postMessage({ type: 'import_session_result', success: false, error: 'cancelled' });
      return;
    }
    await this.handleImportSession({ sessionPath });
  }

  private async pushTreeData(): Promise<void> {
    const { tree, leafId } = await this.sessionManager.getTreeData();
    this.postMessage({ type: 'tree_data', tree, leafId });
  }

  // ---------- 辅助 ----------

  private getWorkspaceFolders(): string[] {
    return vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
  }

  private async listAvailableSessions() {
    return this.sessionManager.listSessions({ all: true });
  }

  private findSessionByPath(
    sessions: Awaited<ReturnType<ExtensionSessionCoordinator['listSessions']>>,
    message: { sessionId: string; sessionPath: string },
  ) {
    const byPath = sessions.find((session) => session.path === message.sessionPath);
    if (byPath) return byPath;
    return message.sessionPath
      ? undefined
      : sessions.find((session) => session.id === message.sessionId);
  }

  private getFallbackCwd(workspaceFolders: string[]): string {
    if (workspaceFolders.some((folder) => isPathInsideOrEqual(this.cwd, folder))) {
      return this.cwd;
    }
    return workspaceFolders[0] ?? this.cwd;
  }

  private async resolveSessionCwd(sessionCwd?: string): Promise<string | undefined> {
    const workspaceFolders = this.getWorkspaceFolders();
    const decision = resolveSessionCwdPolicy({
      sessionCwd,
      fallbackCwd: this.getFallbackCwd(workspaceFolders),
      workspaceFolders,
    });

    if (decision.type === 'use-session-cwd' || decision.type === 'use-fallback-cwd') {
      return decision.cwd;
    }

    if (decision.reason === 'missing-path') {
      const selected = await vscode.window.showWarningMessage(
        `The original session folder no longer exists:\n${decision.sessionCwd}\n\nUse current workspace instead?`,
        'Use Current Workspace',
        'Choose Folder',
        'Cancel',
      );
      if (selected === 'Use Current Workspace') return decision.fallbackCwd;
      if (selected === 'Choose Folder') return this.pickFolder();
      return undefined;
    }

    if (decision.reason === 'no-workspace') {
      const selected = await vscode.window.showWarningMessage(
        `This session was created in:\n${decision.sessionCwd}\n\nNo VS Code workspace is open.`,
        'Use Original Folder',
        'Choose Folder',
        'Cancel',
      );
      if (selected === 'Use Original Folder') return decision.sessionCwd;
      if (selected === 'Choose Folder') return this.pickFolder();
      return undefined;
    }

    const selected = await vscode.window.showWarningMessage(
      `This session was created outside the current workspace:\n${decision.sessionCwd}\n\nCurrent workspace:\n${decision.fallbackCwd}`,
      'Use Original Folder',
      'Use Current Workspace',
      'Choose Folder',
      'Cancel',
    );
    if (selected === 'Use Original Folder') return decision.sessionCwd;
    if (selected === 'Use Current Workspace') return decision.fallbackCwd;
    if (selected === 'Choose Folder') return this.pickFolder();
    return undefined;
  }

  private async pickFolder(): Promise<string | undefined> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Use Folder',
    });
    return selected?.[0]?.fsPath;
  }

  private resolveAgentDir(): string {
    // 默认在 cwd 下的 .scout 目录
    return vscode.Uri.joinPath(vscode.Uri.file(this.cwd), '.scout').fsPath;
  }
}
