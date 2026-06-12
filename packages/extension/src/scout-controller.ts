// ============================================================
// ScoutController — Webview 路由层 + 事件转发
// 职责仅剩：Webview 消息路由 → 委托 ExtensionSessionCoordinator
//            ExtensionSessionCoordinator 事件 → 转发 Webview
// ============================================================

import * as vscode from 'vscode';
import type {
  ExtensionMessage,
  ScoutBusyState,
  ScoutCommandInfo,
  ScoutFileMentionItem,
  ScoutSessionListItem,
  ScoutTaskItem,
  ScoutWebviewState,
  WebviewMessage,
} from '@scout-agent/shared';
import { ConfigManager } from './config-manager.ts';
import { ExtensionSessionCoordinator, type ScoutSessionEvent } from './host/session-coordinator.ts';
import { readSessionFileInfo } from './core/session-file.ts';
import { isPathInsideOrEqual, resolveSessionCwdPolicy } from './core/session-cwd.ts';
import { matchesTaskSearch } from './host/protocol/task-search.ts';
import type { ScoutWebviewSurface } from './host/webview-surface.ts';

// ---------- 接口 ----------

export interface ScoutControllerOptions {
  extensionUri: vscode.Uri;
  outputChannel: vscode.OutputChannel;
  cwd: string;
  openSettingsPanel?: () => void | Promise<void>;
  openTreePanel?: () => void | Promise<void>;
}

const IDLE_BUSY_STATE: ScoutBusyState = {
  kind: 'idle',
  cancellable: false,
};

const BUILTIN_SOURCE_INFO = {
  path: '<builtin:webview>',
  source: 'builtin',
  scope: 'temporary',
  origin: 'top-level',
} as const;

const BUILTIN_WEBVIEW_COMMANDS: ScoutCommandInfo[] = [
  {
    name: 'settings',
    description: 'Open Scout settings',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'tree',
    description: 'Open the conversation tree',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'model',
    description: 'Change the active model',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'compact',
    description: 'Manually compact the current session',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'new',
    description: 'Start a new session',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'sessions',
    description: 'List saved sessions',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'fork',
    description: 'Fork from a tree entry',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'resume',
    description: 'Resume a saved task',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'name',
    description: 'Rename the current session',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'export',
    description: 'Export the current session as JSONL',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'import',
    description: 'Import a JSONL session',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'reload',
    description: 'Reload Scout resources',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'continue',
    description: 'Continue the current response',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
];

const FILE_MENTION_SKIP_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.scout',
  'dist',
  'out',
]);

function getPathDescription(relativePath: string): string | undefined {
  const index = relativePath.lastIndexOf('/');
  return index > 0 ? relativePath.slice(0, index) : undefined;
}

// ---------- Controller ----------

export class ScoutController implements vscode.Disposable {
  private readonly extensionUri: vscode.Uri;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly cwd: string;
  private readonly agentDir: string;
  private readonly openSettingsPanel?: () => void | Promise<void>;
  private readonly openTreePanel?: () => void | Promise<void>;
  private readonly configManager: ConfigManager;
  private readonly sessionManager: ExtensionSessionCoordinator;
  private readonly disposables: vscode.Disposable[] = [];

  private readonly webviews = new Map<ScoutWebviewSurface, Set<vscode.Webview>>();
  private unsubscribeSession?: () => void;
  private disposePromise?: Promise<void>;
  private busyState: ScoutBusyState = IDLE_BUSY_STATE;

  constructor(options: ScoutControllerOptions) {
    this.extensionUri = options.extensionUri;
    this.outputChannel = options.outputChannel;
    this.cwd = options.cwd;
    this.openSettingsPanel = options.openSettingsPanel;
    this.openTreePanel = options.openTreePanel;
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

  bindWebview(webview: vscode.Webview, surface: ScoutWebviewSurface = 'chat'): vscode.Disposable {
    const webviews = this.webviews.get(surface) ?? new Set<vscode.Webview>();
    webviews.add(webview);
    this.webviews.set(surface, webviews);

    const messageDisposable = webview.onDidReceiveMessage(
      (message: WebviewMessage) => {
        this.handleWebviewMessage(message, surface);
      },
      undefined,
      this.disposables,
    );
    return new vscode.Disposable(() => {
      messageDisposable.dispose();
      webviews.delete(webview);
      if (webviews.size === 0) {
        this.webviews.delete(surface);
      }
    });
  }

  handleWebviewMessage(message: WebviewMessage, surface: ScoutWebviewSurface = 'chat'): void {
    switch (message.type) {
      case 'ready':
        void this.onReady(surface);
        break;
      case 'request_state':
        void this.pushState();
        break;
      case 'request_config':
        this.pushConfig();
        break;
      case 'request_context_usage':
        void this.handleRequestContextUsage();
        break;
      case 'user_message':
        this.sessionManager.prompt(message.text, {
          deliverAs: message.deliverAs,
          images: message.images,
        });
        break;
      case 'abort':
        this.sessionManager.abort();
        break;
      case 'abort_retry':
        this.sessionManager.abortRetry();
        break;
      case 'compact':
        void this.handleCompact(message);
        break;
      case 'continue_session':
        this.sessionManager.continue();
        break;
      case 'request_commands':
        this.handleRequestCommands();
        break;
      case 'request_sessions':
        void this.handleRequestSessions();
        break;
      case 'export_session':
        this.handleExportSession(message);
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
      case 'reload_resources':
        void this.handleReloadResources();
        break;
      case 'open_settings_panel':
        void this.handleOpenSettingsPanel();
        break;
      case 'open_tree_panel':
        void this.handleOpenTreePanel();
        break;
      case 'delete_session':
        this.handleDeleteSession(message);
        break;
      case 'fork_session':
        void this.handleForkSession(message);
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
      case 'set_session_name':
        void this.handleSetSessionName(message);
        break;
      case 'request_file_mentions':
        void this.handleRequestFileMentions(message);
        break;
      case 'request_tasks':
        void this.handleRequestTasks(message);
        break;
      case 'search_tasks':
        void this.handleSearchTasks(message);
        break;
      case 'open_task':
        void this.handleOpenTask(message);
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
      this.webviews.clear();
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
      if (event.event.type === 'agent_start') {
        this.busyState = { kind: 'agent', label: 'Working', cancellable: true };
      }
      if (event.event.type === 'agent_end' && !event.event.willRetry) {
        this.busyState = IDLE_BUSY_STATE;
      }
      this.postMessage({ type: 'agent_event', event: event.event });
    }

    // 转发 retry 事件
    if (event.type === 'auto_retry_start') {
      this.busyState = {
        kind: 'retry',
        label: 'Retrying',
        cancellable: true,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        reason: event.errorMessage,
      };
      this.postMessage({
        type: 'auto_retry_start',
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        errorMessage: event.errorMessage,
      });
    }
    if (event.type === 'auto_retry_end') {
      this.busyState = IDLE_BUSY_STATE;
      this.postMessage({
        type: 'auto_retry_end',
        success: event.success,
        attempt: event.attempt,
        finalError: event.finalError,
      });
    }

    if (event.type === 'compaction_start') {
      this.busyState = {
        kind: 'compaction',
        label: 'Compacting',
        cancellable: true,
        reason: event.reason,
      };
      this.postMessage({ type: 'compaction_start', reason: event.reason });
    }
    if (event.type === 'compaction_end') {
      this.busyState = event.willRetry
        ? { kind: 'retry', label: 'Retrying', cancellable: true, reason: event.reason }
        : IDLE_BUSY_STATE;
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
      if (event.type === 'error') {
        this.postMessage({ type: 'notification', level: 'error', message: event.message });
      }
      void this.pushState();
    }

    if (event.type === 'tree_change') {
      void this.pushTreeData();
    }
  }

  // ---------- Webview 消息处理 ----------

  private async onReady(surface: ScoutWebviewSurface): Promise<void> {
    this.outputChannel.appendLine(`[scout] Webview ready: ${surface}`);
    await this.sessionManager.initialize();
    this.pushConfig();
    await this.pushState();
    this.handleRequestCommands();
    if (surface === 'chat') {
      await this.handleRequestSessions();
    }
    if (surface === 'tree') {
      await this.pushTreeData();
    }
  }

  private async handleCompact(message: { customInstructions?: string }): Promise<void> {
    try {
      await this.sessionManager.compact(message.customInstructions);
    } catch (error) {
      this.postMessage({
        type: 'notification',
        level: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleReloadResources(): Promise<void> {
    try {
      const result = await this.sessionManager.reload();
      this.postMessage({
        type: 'reload_result',
        success: !result.cancelled,
        error: result.cancelled ? 'cancelled' : undefined,
      });
      if (!result.cancelled) {
        this.pushConfig();
        this.handleRequestCommands();
        await this.pushState();
        await this.pushTreeData();
      }
    } catch (error) {
      this.postMessage({
        type: 'reload_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleOpenSettingsPanel(): Promise<void> {
    try {
      if (!this.openSettingsPanel) {
        this.postMessage({
          type: 'open_settings_panel_result',
          success: false,
          error: 'Settings panel is not registered',
        });
        return;
      }
      await this.openSettingsPanel();
      this.postMessage({ type: 'open_settings_panel_result', success: true });
    } catch (error) {
      this.postMessage({
        type: 'open_settings_panel_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleOpenTreePanel(): Promise<void> {
    try {
      if (!this.openTreePanel) {
        this.postMessage({
          type: 'open_tree_panel_result',
          success: false,
          error: 'Tree panel is not registered',
        });
        return;
      }
      await this.openTreePanel();
      this.postMessage({ type: 'open_tree_panel_result', success: true });
    } catch (error) {
      this.postMessage({
        type: 'open_tree_panel_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleRequestContextUsage(): Promise<void> {
    const sessionStats = await this.sessionManager.getSessionStats();
    this.postMessage({
      type: 'context_usage_update',
      contextUsage: sessionStats?.contextUsage,
    });
  }

  private async handleForkSession(message: {
    entryId: string;
    position: 'before' | 'at';
  }): Promise<void> {
    try {
      const result = await this.sessionManager.fork(message.entryId, message.position);
      this.postMessage({
        type: 'fork_result',
        success: !result.cancelled,
        error: result.cancelled ? 'cancelled' : undefined,
      });
      if (!result.cancelled) {
        await this.pushState();
        await this.pushTreeData();
        await this.handleRequestSessions();
      }
    } catch (error) {
      this.postMessage({
        type: 'fork_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private handleRequestCommands(): void {
    this.postMessage({ type: 'commands_data', commands: this.getCommands() });
  }

  private async handleSetSessionName(message: { name: string }): Promise<void> {
    try {
      await this.sessionManager.setSessionName(message.name);
      this.postMessage({ type: 'set_session_name_result', success: true });
      await this.pushState();
      await this.handleRequestSessions();
    } catch (error) {
      this.postMessage({
        type: 'set_session_name_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private handleExportSession(message: { format: 'jsonl'; outputPath?: string }): void {
    try {
      const path = this.sessionManager.exportSessionToJsonl(message.outputPath);
      if (!path) {
        this.postMessage({
          type: 'export_session_result',
          success: false,
          error: 'No active session',
        });
        return;
      }
      this.postMessage({ type: 'export_session_result', success: true, path });
    } catch (error) {
      this.postMessage({
        type: 'export_session_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ---------- 状态同步 ----------

  private async pushState(): Promise<void> {
    this.postMessage({ type: 'state_update', state: await this.buildState() });
  }

  private pushConfig(): void {
    this.postMessage({ type: 'config_update', config: this.configManager.getScoutConfig() });
  }

  private async buildState(): Promise<ScoutWebviewState> {
    const [sessionName, sessionStats, leafId] = await Promise.all([
      this.sessionManager.getSessionName(),
      this.sessionManager.getSessionStats(),
      this.sessionManager.getVisibleLeafId(),
    ]);
    return {
      messages: this.sessionManager.getScoutMessages(),
      isStreaming: this.sessionManager.isStreaming,
      busyState: this.getBusyState(),
      modelProvider: this.sessionManager.model?.provider ?? '',
      modelId: this.sessionManager.model?.id ?? '',
      thinkingLevel: this.sessionManager.thinkingLevel,
      tools: this.sessionManager.getAllToolInfos(),
      activeToolNames: this.sessionManager.getActiveToolNames(),
      commands: this.getCommands(),
      cwd: this.sessionManager.currentCwd,
      sessionId: this.sessionManager.sessionId,
      sessionName,
      sessionFile: this.sessionManager.sessionFile,
      parentSessionPath: this.sessionManager.parentSessionPath,
      leafId,
      contextUsage: sessionStats?.contextUsage,
      sessionStats,
      diagnostics: [...this.sessionManager.diagnostics],
      modelFallbackMessage: this.sessionManager.modelFallbackMessage,
    };
  }

  // ---------- 通信 ----------

  private postMessage(message: ExtensionMessage): void {
    for (const webviews of this.webviews.values()) {
      for (const webview of webviews) {
        void webview.postMessage(message);
      }
    }
  }

  private getCommands(): ScoutCommandInfo[] {
    return [...BUILTIN_WEBVIEW_COMMANDS, ...this.sessionManager.getCommands()];
  }

  private getBusyState(): ScoutBusyState {
    if (this.busyState.kind === 'idle' && this.sessionManager.isStreaming) {
      return { kind: 'agent', label: 'Working', cancellable: true };
    }
    return this.busyState;
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
      if (target.path === this.sessionManager.sessionFile) {
        this.postMessage({
          type: 'delete_session_result',
          success: false,
          error: 'Cannot delete the active session',
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
        modifiedAt: session.modifiedAt,
        name: session.name,
        messageCount: session.messageCount,
        firstMessage: session.firstMessage,
        parentSessionPath: session.parentSessionPath,
        isCurrent: session.path === this.sessionManager.sessionFile,
      }));
      this.postMessage({ type: 'sessions_data', sessions: items });
    } catch (error) {
      this.postMessage({ type: 'sessions_data', sessions: [] });
      this.outputChannel.appendLine(
        `[scout] List sessions failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleRequestFileMentions(message: {
    query: string;
    limit?: number;
  }): Promise<void> {
    try {
      const items = await this.collectFileMentionItems(message.query, message.limit);
      this.postMessage({ type: 'file_mentions_data', query: message.query, items });
    } catch (error) {
      this.postMessage({ type: 'file_mentions_data', query: message.query, items: [] });
      this.outputChannel.appendLine(
        `[scout] File mentions failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleRequestTasks(message: { limit?: number }): Promise<void> {
    try {
      const tasks = this.sessionsToTasks(await this.listAvailableSessions(), message.limit);
      this.postMessage({ type: 'tasks_data', tasks });
    } catch (error) {
      this.postMessage({ type: 'tasks_data', tasks: [] });
      this.outputChannel.appendLine(
        `[scout] List tasks failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleSearchTasks(message: {
    query: string;
    limit?: number;
    requestId?: string;
  }): Promise<void> {
    try {
      const sessions = await this.listAvailableSessions();
      const filtered = sessions.filter((session) => matchesTaskSearch(session, message.query));
      this.postMessage({
        type: 'tasks_data',
        tasks: this.sessionsToTasks(filtered, message.limit),
        query: message.query,
        requestId: message.requestId,
      });
    } catch (error) {
      this.postMessage({
        type: 'tasks_data',
        tasks: [],
        query: message.query,
        requestId: message.requestId,
      });
      this.outputChannel.appendLine(
        `[scout] Search tasks failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleOpenTask(message: {
    taskId: string;
    sessionPath: string;
    cwdOverride?: string;
  }): Promise<void> {
    try {
      const result = await this.restoreSessionByPath({
        sessionId: message.taskId,
        sessionPath: message.sessionPath,
        cwdOverride: message.cwdOverride,
      });
      this.postMessage({
        type: 'open_task_result',
        success: result.success,
        error: result.error,
      });
    } catch (error) {
      this.postMessage({
        type: 'open_task_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleRestoreSession(message: {
    sessionId: string;
    sessionPath: string;
    cwdOverride?: string;
  }): Promise<void> {
    try {
      const result = await this.restoreSessionByPath(message);
      this.postMessage(result);
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

  private sessionsToTasks(
    sessions: Awaited<ReturnType<ExtensionSessionCoordinator['listSessions']>>,
    limit = 50,
  ): ScoutTaskItem[] {
    const cappedLimit = Math.max(1, Math.min(limit, 200));
    return sessions.slice(0, cappedLimit).map((session) => ({
      id: session.path,
      sessionId: session.id,
      sessionPath: session.path,
      title: session.name ?? session.firstMessage ?? session.id,
      cwd: session.cwd,
      createdAt: session.createdAt,
      modifiedAt: session.modifiedAt,
      parentSessionPath: session.parentSessionPath,
      messageCount: session.messageCount,
      isCurrent: session.path === this.sessionManager.sessionFile,
    }));
  }

  private async restoreSessionByPath(message: {
    sessionId: string;
    sessionPath: string;
    cwdOverride?: string;
  }): Promise<{ type: 'restore_session_result'; success: boolean; error?: string }> {
    const sessions = await this.listAvailableSessions();
    const target = this.findSessionByPath(sessions, message);
    if (!target) {
      return {
        type: 'restore_session_result',
        success: false,
        error: `Session not found: ${message.sessionId}`,
      };
    }

    const cwd = message.cwdOverride ?? (await this.resolveSessionCwd(target.cwd));
    if (!cwd) {
      return { type: 'restore_session_result', success: false, error: 'cancelled' };
    }

    const result = await this.sessionManager.restore(target, { cwdOverride: cwd });
    if (!result.cancelled) {
      await this.pushState();
      await this.pushTreeData();
    }
    return {
      type: 'restore_session_result',
      success: !result.cancelled,
      error: result.cancelled ? 'cancelled' : undefined,
    };
  }

  private async collectFileMentionItems(
    query: string,
    limit = 50,
  ): Promise<ScoutFileMentionItem[]> {
    const cappedLimit = Math.max(1, Math.min(limit, 100));
    const normalizedQuery = query.trim().replace(/\\/g, '/').toLowerCase();
    const roots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? [];
    if (roots.length === 0 && this.cwd) {
      roots.push(vscode.Uri.file(this.cwd));
    }

    const items: ScoutFileMentionItem[] = [];
    const queue = [...roots];
    let scanned = 0;
    while (queue.length > 0 && items.length < cappedLimit && scanned < 2500) {
      const dir = queue.shift();
      if (!dir) break;
      scanned += 1;

      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(dir);
      } catch {
        continue;
      }

      entries.sort(([a], [b]) => a.localeCompare(b));
      for (const [name, fileType] of entries) {
        if (FILE_MENTION_SKIP_NAMES.has(name)) continue;
        const uri = vscode.Uri.joinPath(dir, name);
        const isDirectory = (fileType & vscode.FileType.Directory) !== 0;
        const relativePath = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
        const matches =
          !normalizedQuery ||
          name.toLowerCase().includes(normalizedQuery) ||
          relativePath.toLowerCase().includes(normalizedQuery);

        if (matches && items.length < cappedLimit) {
          items.push({
            id: relativePath,
            kind: isDirectory ? 'directory' : 'file',
            path: relativePath,
            label: name,
            description: getPathDescription(relativePath),
          });
        }
        if (isDirectory) {
          queue.push(uri);
        }
        if (items.length >= cappedLimit) break;
      }
    }
    return items;
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
