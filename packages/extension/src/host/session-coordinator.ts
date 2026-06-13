// ============================================================
// ExtensionSessionCoordinator — VS Code 宿主会话协调层
// 负责：Webview/宿主命令与 core AgentSessionRuntime 之间的生命周期编排。
// ============================================================

import * as vscode from 'vscode';
import { rmSync } from 'node:fs';
import type {
  ScoutAgentEvent,
  ScoutCommandInfo,
  ScoutImageContent,
  ScoutMessage,
  ScoutQueueState,
  ScoutSessionStats,
  ScoutSessionTreeNode,
  ThinkingLevel,
  ToolInfo,
} from '@scout-agent/shared';
import { ConfigManager } from '../config-manager.ts';
import { readSessionFileInfo } from '../core/session-file.ts';
import {
  SessionManager as CoreSessionManager,
  type JsonlSessionMetadata,
  type Session,
  type SessionInfo,
} from '../core/session/index.ts';
import { getDefaultSessionDir, getSessionsRoot } from './session-paths.ts';

import {
  ScoutExtensionRunner,
  type SendMessageInput,
  type NewSessionReplacementOptions,
  type ScoutExtensionActions,
  type ScoutExtensionContextActions,
  type SessionReplacementOptions,
} from '../core/extensions/index.ts';
import {
  AgentSession,
  type AgentSessionEvent,
  type NavigateTreeResult,
} from '../core/agent-session.ts';
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
} from '../core/agent-session-services.ts';
import {
  createAgentSessionRuntime,
  type AgentSessionReplacementResult,
  type AgentSessionRuntime,
  type AgentSessionRuntimeDiagnostic,
  type CreateAgentSessionRuntimeFactory,
} from '../core/agent-session-runtime.ts';
import { AgentEventCorrelator } from './protocol/agent-event-correlator.ts';
import { convertMessage } from './protocol/agent-event-mapper.ts';
import {
  mapSessionTreeToScout,
  resolveVisibleSessionLeafId,
} from './protocol/session-tree-mapper.ts';

// ---------- 配置接口 ----------

export type ScoutSessionEvent =
  | Exclude<AgentSessionEvent, { type: 'agent_event' }>
  | { type: 'agent_event'; event: ScoutAgentEvent };

export interface ExtensionSessionCoordinatorOptions {
  cwd: string;
  agentDir: string;
  outputChannel: vscode.OutputChannel;
  configManager: ConfigManager;
}

type ExtensionSessionCoordinatorReplacementResult = AgentSessionReplacementResult;

type ExtensionSessionCoordinatorSessionReplacementOptions = SessionReplacementOptions & {
  cwdOverride?: string;
};

type InitialRuntimeReason = 'startup' | 'new';

function getSessionOpenCwdOverride(
  sessionPath: string,
  cwdOverride: string | undefined,
  fallbackCwd: string,
): string | undefined {
  if (cwdOverride) return cwdOverride;
  const sessionCwd = readSessionFileInfo(sessionPath).cwd;
  return sessionCwd?.trim() ? undefined : fallbackCwd;
}

// ---------- ExtensionSessionCoordinator ----------

export class ExtensionSessionCoordinator implements vscode.Disposable {
  private cwd: string;
  private readonly agentDir: string;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly configManager: ConfigManager;
  private readonly disposables: vscode.Disposable[] = [];

  private agentSession?: AgentSession;
  private sessionRuntime?: AgentSessionRuntime;
  private isInitializing = false;
  private disposePromise?: Promise<void>;
  private readonly agentEventCorrelator = new AgentEventCorrelator();

  /** 事件监听器列表（透传 AgentSession 事件） */
  private listeners: ((event: ScoutSessionEvent) => void)[] = [];
  private unsubscribeAgentSession?: () => void;

  constructor(options: ExtensionSessionCoordinatorOptions) {
    this.cwd = options.cwd;
    this.agentDir = options.agentDir;
    this.outputChannel = options.outputChannel;
    this.configManager = options.configManager;
  }

  // ---------- 属性（委托给 AgentSession） ----------

  get model() {
    return this.agentSession?.model;
  }

  get thinkingLevel(): ThinkingLevel {
    return this.agentSession?.thinkingLevel ?? 'off';
  }

  get isStreaming(): boolean {
    return this.agentSession?.isStreaming ?? false;
  }

  get sessionId(): string {
    return this.agentSession?.sessionId ?? '';
  }

  get parentSessionPath(): string | undefined {
    return this.agentSession?.parentSessionPath;
  }

  get currentCwd(): string {
    return this.cwd;
  }

  get sessionFile(): string | undefined {
    return this.agentSession?.sessionFile;
  }

  get leafId(): string | null {
    return this.agentSession?.leafId ?? null;
  }

  get diagnostics(): readonly AgentSessionRuntimeDiagnostic[] {
    return this.sessionRuntime?.diagnostics ?? [];
  }

  get modelFallbackMessage(): string | undefined {
    return this.sessionRuntime?.modelFallbackMessage;
  }

  getActiveToolNames(): string[] {
    return this.agentSession?.getActiveToolNames() ?? [];
  }

  getAllToolInfos(): ToolInfo[] {
    const active = new Set(this.getActiveToolNames());
    return (this.agentSession?.getAllToolInfos() ?? []).map((tool) => ({
      ...tool,
      active: active.has(tool.name),
    }));
  }

  getCommands(): ScoutCommandInfo[] {
    return this.agentSession?.getCommands() ?? [];
  }

  async getSessionName(): Promise<string | undefined> {
    return this.agentSession?.getSessionName();
  }

  async getSessionStats(): Promise<ScoutSessionStats | undefined> {
    return this.agentSession?.getSessionStats();
  }

  async setActiveTools(toolNames: string[]): Promise<void> {
    if (!this.agentSession) {
      this.emit({ type: 'error', message: 'No active session' });
      return;
    }
    try {
      await this.agentSession.setActiveTools(toolNames);
    } catch (error) {
      this.emit({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ---------- 核心生命周期 ----------

  async initialize(): Promise<void> {
    if (this.isInitializing || this.sessionRuntime) return;
    await this.createInitialRuntime('startup');
  }

  private async createInitialRuntime(
    reason: InitialRuntimeReason,
    options?: NewSessionReplacementOptions,
  ): Promise<ExtensionSessionCoordinatorReplacementResult> {
    if (this.isInitializing || this.sessionRuntime) return { cancelled: false };
    this.isInitializing = true;
    let createdSession: Session | undefined;

    try {
      // 1. 查找默认模型（预检）
      const model = this.configManager.findDefaultModel();
      if (!model) {
        this.emit({
          type: 'error',
          message: 'No model available. Please configure an API key in VS Code settings.',
        });
        return { cancelled: true };
      }

      const session = CoreSessionManager.create(
        this.cwd,
        getDefaultSessionDir(this.cwd, this.agentDir),
        { parentSession: options?.parentSession },
      );
      createdSession = session;

      const runtime = await createAgentSessionRuntime(this.createRuntime, {
        session,
        cwd: this.cwd,
        sessionStartEvent: { type: 'session_start', reason },
      });
      runtime.setRebindSession((nextSession) => this.rebindAgentSession(nextSession));
      runtime.setBeforeSessionInvalidate(() => this.teardownAgentSessionBinding(runtime.session));
      this.sessionRuntime = runtime;
      createdSession = undefined;
      if (options?.setup) {
        await options.setup(runtime.session.sessionManager);
        await runtime.session.syncRuntimeMessagesFromSession();
      }
      runtime.appendDiagnostics(await this.rebindAgentSession(runtime.session));
      if (options?.withSession) {
        await options.withSession(runtime.session.createReplacedSessionContext());
      }
      this.emit({ type: 'state_change' });

      this.outputChannel.appendLine(
        reason === 'startup'
          ? `[scout] Agent runtime initialized with model: ${model.id}`
          : `[scout] New session initialized with model: ${model.id}`,
      );
      return { cancelled: false };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.cleanupCreatedSessionAfterFailure(createdSession, error);
      if (reason === 'new') {
        throw error;
      }
      this.outputChannel.appendLine(`[scout] Agent runtime initialization failed: ${errorMessage}`);
      this.emit({ type: 'error', message: `Initialization failed: ${errorMessage}` });
      return { cancelled: true };
    } finally {
      this.isInitializing = false;
    }
  }

  /** 从 JSONL 文件恢复 session */
  async restore(
    sessionMeta: JsonlSessionMetadata,
    options?: ExtensionSessionCoordinatorSessionReplacementOptions,
  ): Promise<ExtensionSessionCoordinatorReplacementResult> {
    if (!this.sessionRuntime) {
      const session = CoreSessionManager.open(
        sessionMeta.path,
        undefined,
        getSessionOpenCwdOverride(sessionMeta.path, options?.cwdOverride, this.cwd),
      );
      const sessionCwd = session.getCwd();
      const runtime = await createAgentSessionRuntime(this.createRuntime, {
        session,
        cwd: sessionCwd,
        sessionStartEvent: { type: 'session_start', reason: 'resume' },
      });
      runtime.setRebindSession((nextSession) => this.rebindAgentSession(nextSession));
      runtime.setBeforeSessionInvalidate(() => this.teardownAgentSessionBinding(runtime.session));
      this.sessionRuntime = runtime;
      this.cwd = runtime.cwd;
      runtime.appendDiagnostics(await this.rebindAgentSession(runtime.session));
      this.emit({ type: 'state_change' });
      this.outputChannel.appendLine(`[scout] Session restored: ${sessionMeta.id}`);
      if (options?.withSession) {
        await options.withSession(runtime.session.createReplacedSessionContext());
      }
      return { cancelled: false };
    }

    const result = await this.sessionRuntime.switchSession(sessionMeta, options);
    if (result.cancelled) {
      this.outputChannel.appendLine(
        `[scout] Session restore cancelled by extension: ${sessionMeta.id}`,
      );
      return { cancelled: true };
    }
    this.cwd = this.sessionRuntime.cwd;
    this.emit({ type: 'state_change' });
    this.outputChannel.appendLine(`[scout] Session restored: ${sessionMeta.id}`);
    return result;
  }

  async importSessionFromJsonl(
    sessionPath: string,
    options?: ExtensionSessionCoordinatorSessionReplacementOptions,
  ): Promise<ExtensionSessionCoordinatorReplacementResult> {
    const sourceInfo = readSessionFileInfo(sessionPath);
    const targetCwd = options?.cwdOverride ?? sourceInfo.cwd ?? this.cwd;

    if (!this.sessionRuntime) {
      await this.initialize();
    }
    if (!this.sessionRuntime) {
      throw new Error('No active runtime to import session into');
    }

    const result = await this.sessionRuntime.importFromJsonl(sourceInfo.path, {
      ...options,
      cwdOverride: targetCwd,
    });
    if (result.cancelled) {
      this.outputChannel.appendLine(
        `[scout] Session import cancelled by extension: ${sourceInfo.path}`,
      );
      return result;
    }
    this.cwd = this.sessionRuntime.cwd;
    this.emit({ type: 'state_change' });
    this.outputChannel.appendLine(`[scout] Session imported: ${sourceInfo.id ?? sourceInfo.path}`);
    return result;
  }

  async newSession(
    options?: NewSessionReplacementOptions,
  ): Promise<ExtensionSessionCoordinatorReplacementResult> {
    if (!this.sessionRuntime) {
      return await this.createInitialRuntime('new', options);
    }

    const result = await this.sessionRuntime.newSession(options);
    if (result.cancelled) {
      this.outputChannel.appendLine('[scout] New session cancelled by extension');
      return { cancelled: true };
    }
    this.emit({ type: 'state_change' });
    return result;
  }

  async listSessions(options?: { cwd?: string; all?: boolean }): Promise<JsonlSessionMetadata[]> {
    try {
      if (options?.all) {
        return this.listAllSessions();
      }
      return this.listSessionsForCwd(options?.cwd ?? this.cwd);
    } catch {
      return [];
    }
  }

  /** 删除指定 session 文件（不影响当前活跃 session） */
  async deleteSession(sessionMeta: JsonlSessionMetadata): Promise<void> {
    try {
      rmSync(sessionMeta.path, { force: true });
      this.outputChannel.appendLine(`[scout] Session deleted: ${sessionMeta.id}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[scout] Delete session failed: ${errorMessage}`);
      throw error;
    }
  }

  // ---------- 运行时委托 ----------

  async prompt(
    text: string,
    options?: {
      deliverAs?: 'steer' | 'followUp';
      images?: ScoutImageContent[];
      clearFollowUpQueue?: boolean;
    },
  ): Promise<void> {
    if (!this.agentSession) {
      await this.initialize();
    }
    if (!this.agentSession) return;
    if (this.agentSession.isStreaming) {
      if (options?.deliverAs === 'followUp') {
        if (options.images) {
          await this.agentSession.followUp(text, options.images);
        } else {
          await this.agentSession.followUp(text);
        }
      } else {
        if (options?.images) {
          await this.agentSession.steer(text, options.images);
        } else {
          await this.agentSession.steer(text);
        }
      }
      return;
    }
    await this.agentSession.prompt(text, {
      images: options?.images,
      clearFollowUpQueue: options?.clearFollowUpQueue,
    });
  }

  async abort(): Promise<void> {
    await this.agentSession?.abort();
  }

  /** 用户手动续写，委托给 AgentSession.continue() */
  async continue(options?: { preserveFollowUpQueue?: boolean }): Promise<void> {
    await this.agentSession?.continue({
      preserveFollowUps: options?.preserveFollowUpQueue,
    });
  }

  getQueueState(): ScoutQueueState {
    if (!this.agentSession) {
      return { messages: [], followUps: [], paused: false };
    }
    const snapshot = this.agentSession.getQueueSnapshot();
    return {
      messages: snapshot.messages,
      followUps: snapshot.followUps,
      paused: snapshot.followUpPaused,
      pauseReason: snapshot.followUpPauseReason,
    };
  }

  cancelFollowUp(id: string): boolean {
    return this.agentSession?.cancelFollowUp(id) ?? false;
  }

  promoteFollowUp(id: string): boolean {
    return this.agentSession?.promoteFollowUp(id) ?? false;
  }

  clearFollowUpQueue(): void {
    this.agentSession?.clearFollowUpQueue();
  }

  async setModel(modelId: string, provider?: string): Promise<void> {
    await this.agentSession?.setModel(modelId, provider);
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    await this.agentSession?.setThinkingLevel(level);
  }

  async compact(customInstructions?: string): Promise<void> {
    await this.agentSession?.compact(customInstructions);
  }

  async setSessionName(name: string): Promise<void> {
    if (!this.agentSession) {
      this.emit({ type: 'error', message: 'No active session' });
      return;
    }
    await this.agentSession.setSessionName(name);
  }

  exportSessionToJsonl(outputPath?: string): string | undefined {
    return this.agentSession?.exportToJsonl(outputPath);
  }

  async reload(): Promise<ExtensionSessionCoordinatorReplacementResult> {
    this.configManager.reload();

    if (!this.sessionRuntime) {
      await this.initialize();
      return { cancelled: false };
    }

    const result = await this.sessionRuntime.reload();
    this.emit({ type: 'state_change' });
    this.outputChannel.appendLine('[scout] Extensions and resources reloaded');
    return result;
  }

  async abortRetry(): Promise<void> {
    await this.agentSession?.abortRetry();
  }

  async fork(
    entryId: string,
    position: 'before' | 'at',
    options?: SessionReplacementOptions,
  ): Promise<ExtensionSessionCoordinatorReplacementResult> {
    if (!this.agentSession || !this.sessionRuntime) {
      this.emit({ type: 'error', message: 'No active session to fork from' });
      return { cancelled: true };
    }

    try {
      const result = await this.sessionRuntime?.fork(entryId, position, options);
      if (result?.cancelled) {
        this.outputChannel.appendLine(
          `[scout] Fork cancelled by extension: ${entryId} (${position})`,
        );
        return { cancelled: true };
      }
      this.emit({ type: 'state_change' });
      return result ?? { cancelled: false };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[scout] Fork failed: ${errorMessage}`);
      this.emit({ type: 'error', message: `Fork failed: ${errorMessage}` });
      return { cancelled: true };
    }
  }

  // ---------- Tree / Navigation / Label 委托 ----------

  async getTree(): Promise<ScoutSessionTreeNode[]> {
    if (!this.agentSession) return [];
    return mapSessionTreeToScout(await this.agentSession.getTree());
  }

  async getTreeData(): Promise<{ tree: ScoutSessionTreeNode[]; leafId: string | null }> {
    if (!this.agentSession) return { tree: [], leafId: null };
    const rawTree = await this.agentSession.getTree();
    return {
      tree: mapSessionTreeToScout(rawTree),
      leafId: resolveVisibleSessionLeafId(rawTree, this.agentSession.leafId),
    };
  }

  async getVisibleLeafId(): Promise<string | null> {
    if (!this.agentSession) return null;
    return resolveVisibleSessionLeafId(await this.agentSession.getTree(), this.agentSession.leafId);
  }

  async navigateTree(
    targetId: string,
    options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    },
  ): Promise<NavigateTreeResult> {
    if (!this.agentSession) {
      this.emit({ type: 'error', message: 'No active session for tree navigation' });
      return { cancelled: true };
    }
    return this.agentSession.navigateTree(targetId, options);
  }

  async setLabel(entryId: string, label?: string): Promise<void> {
    if (!this.agentSession) {
      this.emit({ type: 'error', message: 'No active session' });
      return;
    }
    return this.agentSession.setLabel(entryId, label);
  }

  // ---------- 消息访问 ----------

  getScoutMessages(): ScoutMessage[] {
    return (this.agentSession?.getSessionMessages() ?? [])
      .map(({ message, entryId }) => {
        const scoutMessage = convertMessage(message);
        if (scoutMessage) {
          scoutMessage.entryId = entryId;
        }
        return scoutMessage;
      })
      .filter((message): message is ScoutMessage => message !== null);
  }

  // ---------- 事件订阅 ----------

  subscribe(listener: (event: ScoutSessionEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  private emit(event: ScoutSessionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private forwardAgentSessionEvent(event: AgentSessionEvent): void {
    if (event.type !== 'agent_event') {
      this.emit(event);
      return;
    }

    const scoutEvent = this.agentEventCorrelator.map(event.event, {
      sessionId: this.sessionId,
    });
    if (scoutEvent) {
      this.emit({ type: 'agent_event', event: scoutEvent });
    }
  }

  // ---------- 内部：AgentSession 管理 ----------

  /** 替换当前 AgentSession，订阅其事件并透传 */
  protected setAgentSession(agentSession: AgentSession, disposePrevious = true): void {
    // 取消订阅旧的
    this.unsubscribeAgentSession?.();
    this.agentEventCorrelator.reset();
    if (disposePrevious) {
      this.agentSession?.dispose();
    }

    this.agentSession = agentSession;
    this.unsubscribeAgentSession = agentSession.subscribe((event) =>
      this.forwardAgentSessionEvent(event),
    );
  }

  private async rebindAgentSession(
    agentSession: AgentSession,
  ): Promise<AgentSessionRuntimeDiagnostic[]> {
    this.cwd = agentSession.sessionManager.getCwd();
    this.setAgentSession(agentSession, false);
    return await agentSession.bindExtensions({
      bindCore: (extensionRunner, nextSession) =>
        this.bindExtensionActions(extensionRunner, nextSession),
    });
  }

  private teardownAgentSessionBinding(agentSession: AgentSession): void {
    if (this.agentSession !== agentSession) return;
    this.unsubscribeAgentSession?.();
    this.unsubscribeAgentSession = undefined;
    this.agentSession = undefined;
    this.agentEventCorrelator.reset();
  }

  private logReplacementTeardownError(error: unknown): void {
    if (!error) return;
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.outputChannel.appendLine(`[scout] Previous session teardown failed: ${errorMessage}`);
    const suppressed = (error as { suppressed?: unknown[] } | undefined)?.suppressed;
    if (!Array.isArray(suppressed) || suppressed.length === 0) return;
    suppressed.forEach((suppressedError, index) => {
      const suppressedMessage =
        suppressedError instanceof Error ? suppressedError.message : String(suppressedError);
      this.outputChannel.appendLine(
        `[scout] Suppressed teardown error ${index + 1}: ${suppressedMessage}`,
      );
    });
  }

  private logReplacementWithSessionError(error: unknown): void {
    if (!error) return;
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.outputChannel.appendLine(
      `[scout] Replacement withSession callback failed: ${errorMessage}`,
    );
    this.emit({ type: 'error', message: `withSession failed: ${errorMessage}` });
  }

  private sessionInfoToMetadata(info: SessionInfo): JsonlSessionMetadata {
    return {
      id: info.id,
      createdAt: info.created.toISOString(),
      cwd: info.cwd,
      path: info.path,
      modifiedAt: info.modified.toISOString(),
      name: info.name,
      messageCount: info.messageCount,
      firstMessage: info.firstMessage,
      allMessagesText: info.allMessagesText,
      parentSessionPath: info.parentSessionPath,
    };
  }

  private async listSessionsForCwd(cwd: string): Promise<JsonlSessionMetadata[]> {
    const infos = await CoreSessionManager.list(cwd, getDefaultSessionDir(cwd, this.agentDir));
    return infos.map((info) => this.sessionInfoToMetadata(info));
  }

  private async listAllSessions(): Promise<JsonlSessionMetadata[]> {
    const infos = await CoreSessionManager.listAll(getSessionsRoot(this.agentDir));
    return infos.map((info) => this.sessionInfoToMetadata(info));
  }

  private async cleanupCreatedSessionAfterFailure(
    session: Session | undefined,
    failure: unknown,
  ): Promise<void> {
    if (!session) return;
    try {
      const metadata = session.getMetadata() as JsonlSessionMetadata;
      if (metadata.path) rmSync(metadata.path, { force: true });
    } catch (cleanupError) {
      if (typeof failure === 'object' && failure !== null) {
        (failure as { suppressed?: unknown[] }).suppressed = [
          ...((failure as { suppressed?: unknown[] }).suppressed ?? []),
          cleanupError,
        ];
      }
      const errorMessage =
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      this.outputChannel.appendLine(`[scout] Failed to clean up created session: ${errorMessage}`);
    }
  }

  // ---------- 内部：AgentSession 创建 ----------

  private readonly createRuntime: CreateAgentSessionRuntimeFactory = async ({
    session,
    cwd,
    activeToolNames,
    includeAllExtensionTools,
    sessionStartEvent,
  }) => {
    const runtimeCwd = cwd ?? this.cwd;
    const services = await createAgentSessionServices({
      cwd: runtimeCwd,
      agentDir: this.agentDir,
      configManager: this.configManager,
      session,
    });

    const result = await createAgentSessionFromServices({
      services,
      session,
      logger: this.outputChannel,
      activeToolNames,
      includeAllExtensionTools,
      sessionStartEvent,
    });

    this.logRuntimeDiagnostics(result.diagnostics);
    return result;
  };

  private logRuntimeDiagnostics(diagnostics: AgentSessionRuntimeDiagnostic[]): void {
    for (const diag of diagnostics) {
      if (diag.type === 'error') {
        this.outputChannel.appendLine(`[scout] ERROR: ${diag.message}`);
      } else if (diag.type === 'info') {
        this.outputChannel.appendLine(`[scout] INFO: ${diag.message}`);
      } else {
        this.outputChannel.appendLine(`[scout] WARN: ${diag.message}`);
      }
    }
  }

  /** 绑定扩展 core actions 到指定 AgentSession */
  private bindExtensionActions(
    extensionRunner: ScoutExtensionRunner,
    agentSession: AgentSession,
  ): void {
    const extensionActions: ScoutExtensionActions = {
      sendMessage: <TDetails = unknown>(
        message: SendMessageInput<TDetails>,
        options?: Parameters<ScoutExtensionActions['sendMessage']>[1],
      ) => agentSession.sendMessage(message, options),
      sendUserMessage: (content, options) => agentSession.sendUserMessage(content, options),
      getActiveTools: () => agentSession.getActiveToolNames(),
      getAllTools: () => agentSession.getAllToolInfos(),
      setActiveTools: (toolNames: string[]) => agentSession.setActiveTools(toolNames),
      refreshTools: () => agentSession.refreshTools(),
      appendEntry: (customType, data) => agentSession.appendEntry(customType, data),
      setSessionName: (name) => agentSession.setSessionName(name),
      getSessionName: () => agentSession.getSessionName(),
      setLabel: (entryId, label) => agentSession.setLabel(entryId, label),
      getCommands: () => agentSession.getCommands(),
      setModel: (modelId: string) => agentSession.setModel(modelId),
      getThinkingLevel: () => agentSession.thinkingLevel,
      setThinkingLevel: (level: ThinkingLevel) => agentSession.setThinkingLevel(level),
    };

    const contextActions: ScoutExtensionContextActions = {
      getModel: () => agentSession.model,
      isIdle: () => !agentSession.isStreaming,
      abort: () => {
        agentSession.abort();
      },
      getSystemPrompt: () => agentSession.getSystemPrompt(),
      hasPendingMessages: () => agentSession.hasPendingMessages(),
      getSignal: () => agentSession.getAbortSignal(),
      compact: () => {
        agentSession.compact();
      },
      shutdown: () => {
        this.dispose();
      },
      getContextUsage: () => agentSession.getContextUsage(),
      newSession: (options) => this.newSession(options),
      fork: (entryId, options) => this.fork(entryId, options?.position ?? 'before', options),
      switchSession: (sessionMeta, options) => this.restore(sessionMeta, options),
      waitForIdle: () => agentSession.waitForIdle(),
      reload: () => this.reload().then(() => undefined),
      navigateTree: (targetId, options) => agentSession.navigateTree(targetId, options),
    };

    extensionRunner.bindCore(extensionActions, contextActions);
  }

  // ---------- 生命周期 ----------

  async disposeAsync(): Promise<void> {
    if (this.disposePromise) {
      return this.disposePromise;
    }

    this.disposePromise = (async () => {
      const runtime = this.sessionRuntime;
      const agentSession = this.agentSession;

      this.unsubscribeAgentSession?.();
      this.unsubscribeAgentSession = undefined;
      this.sessionRuntime = undefined;
      this.agentSession = undefined;
      this.agentEventCorrelator.reset();
      this.listeners.length = 0;
      for (const d of this.disposables) {
        try {
          d.dispose();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.outputChannel.appendLine(`[scout] Dispose failed: ${errorMessage}`);
        }
      }
      this.disposables.length = 0;

      try {
        if (runtime) {
          await runtime.dispose();
        } else {
          agentSession?.dispose();
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(`[scout] Runtime dispose failed: ${errorMessage}`);
      }
    })();

    return this.disposePromise;
  }

  dispose(): void {
    this.unsubscribeAgentSession?.();
    void this.disposeAsync().catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[scout] Dispose failed: ${errorMessage}`);
    });
  }
}
