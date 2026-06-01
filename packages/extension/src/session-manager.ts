// ============================================================
// SessionManager — 协调层
// 负责：JsonlSessionRepo 管理、Session 生命周期（create/open/fork）、
//       Skills/Extensions 加载、AgentSession 创建与委托
// ============================================================

import * as vscode from 'vscode';
import type { JsonlSessionMetadata } from '@scout-agent/agent';
import { JsonlSessionRepo, InMemorySessionRepo } from '@scout-agent/agent';
import { NodeExecutionEnv } from '@scout-agent/agent/node';
import type { JsonlSessionRepoFileSystem, Session } from '@scout-agent/agent';
import type { ScoutMessage, ScoutSessionTreeNode, ThinkingLevel } from '@scout-agent/shared';
import { ConfigManager } from './config-manager.ts';
import { loadSkills } from './skill-loader.ts';

// ---------- 内部 Repo 接口（供 JsonlSessionRepo 和 InMemorySessionRepo 共用） ----------

interface SessionRepoLike {
  create(options?: { cwd?: string; id?: string }): Promise<Session>;
  open(metadata: JsonlSessionMetadata): Promise<Session>;
  list(options?: { cwd?: string }): Promise<JsonlSessionMetadata[]>;
  delete(metadata: JsonlSessionMetadata): Promise<void>;
  fork(
    sourceMetadata: JsonlSessionMetadata,
    options: { cwd: string; entryId: string; position: 'before' | 'at' },
  ): Promise<Session>;
}
import {
  ScoutExtensionRunner,
  discoverAndLoadExtensions,
  type ScoutExtensionActions,
  type ScoutExtensionContextActions,
} from './extensions/index.ts';
import { AgentSession, type ScoutSessionEvent } from './agent-session.ts';
import {
  AgentSessionRuntime,
  type AgentSessionRuntimeDiagnostic,
  type CreateAgentSessionRuntimeFactory,
} from './agent-session-runtime.ts';
import type { NavigateTreeResult } from '@scout-agent/agent';

// ---------- 配置接口 ----------

export type { ScoutSessionEvent };

export interface SessionManagerOptions {
  cwd: string;
  agentDir: string;
  outputChannel: vscode.OutputChannel;
  configManager: ConfigManager;
}

// ---------- SessionManager ----------

export class SessionManager implements vscode.Disposable {
  private readonly cwd: string;
  private readonly agentDir: string;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly configManager: ConfigManager;
  private readonly disposables: vscode.Disposable[] = [];

  protected sessionRepo?: SessionRepoLike;
  private agentSession?: AgentSession;
  private sessionRuntime?: AgentSessionRuntime;
  private isInitializing = false;
  private disposePromise?: Promise<void>;

  /** 事件监听器列表（透传 AgentSession 事件） */
  private listeners: ((event: ScoutSessionEvent) => void)[] = [];
  private unsubscribeAgentSession?: () => void;

  constructor(options: SessionManagerOptions) {
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

  get leafId(): string | null {
    return this.agentSession?.leafId ?? null;
  }

  get diagnostics(): readonly AgentSessionRuntimeDiagnostic[] {
    return this.sessionRuntime?.diagnostics ?? [];
  }

  get modelFallbackMessage(): string | undefined {
    return this.sessionRuntime?.modelFallbackMessage;
  }

  // ---------- 核心生命周期 ----------

  async initialize(): Promise<void> {
    if (this.isInitializing || this.sessionRuntime) return;
    this.isInitializing = true;

    try {
      // 1. 查找默认模型（预检）
      const model = this.configManager.findDefaultModel();
      if (!model) {
        this.emit({
          type: 'error',
          message: 'No model available. Please configure an API key in VS Code settings.',
        });
        return;
      }

      // 2. 创建 JsonlSessionRepo
      if (!this.sessionRepo) {
        const env = new NodeExecutionEnv({
          cwd: this.cwd,
          shellPath: this.configManager.getShellPath(),
        });
        this.sessionRepo = new JsonlSessionRepo({
          fs: env as unknown as JsonlSessionRepoFileSystem,
          sessionsRoot: this.agentDir,
        });
      }
      const session = await this.sessionRepo.create({ cwd: this.cwd });

      const runtimeResult = await this.createRuntime({
        session,
        sessionStartEvent: { type: 'session_start', reason: 'startup' },
      });
      const runtime = new AgentSessionRuntime(runtimeResult.session, {
        cwd: this.cwd,
        createRuntime: this.createRuntime,
        diagnostics: runtimeResult.diagnostics,
        modelFallbackMessage: runtimeResult.modelFallbackMessage,
      });
      runtime.setRebindSession((nextSession) => this.setAgentSession(nextSession, false));
      this.sessionRuntime = runtime;
      this.setAgentSession(runtime.session, false);
      await runtime.session.emitSessionStart({ type: 'session_start', reason: 'startup' });
      this.emit({ type: 'state_change' });

      this.outputChannel.appendLine(`[scout] Harness initialized with model: ${model.id}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[scout] Harness initialization failed: ${errorMessage}`);
      this.emit({ type: 'error', message: `Initialization failed: ${errorMessage}` });
    } finally {
      this.isInitializing = false;
    }
  }

  /** 从 JSONL 文件恢复 session */
  async restore(sessionMeta: JsonlSessionMetadata): Promise<void> {
    if (!this.sessionRepo) {
      const env = new NodeExecutionEnv({
        cwd: this.cwd,
        shellPath: this.configManager.getShellPath(),
      });
      this.sessionRepo = new JsonlSessionRepo({
        fs: env as unknown as JsonlSessionRepoFileSystem,
        sessionsRoot: this.agentDir,
      });
    }

    if (!this.sessionRuntime) {
      const session = await this.sessionRepo.open(sessionMeta);
      const runtimeResult = await this.createRuntime({
        session,
        sessionStartEvent: { type: 'session_start', reason: 'resume' },
      });
      const runtime = new AgentSessionRuntime(runtimeResult.session, {
        cwd: this.cwd,
        createRuntime: this.createRuntime,
        diagnostics: runtimeResult.diagnostics,
        modelFallbackMessage: runtimeResult.modelFallbackMessage,
      });
      runtime.setRebindSession((nextSession) => this.setAgentSession(nextSession, false));
      this.sessionRuntime = runtime;
      this.setAgentSession(runtime.session, false);
      await runtime.session.emitSessionStart({ type: 'session_start', reason: 'resume' });
      this.emit({ type: 'state_change' });
      this.outputChannel.appendLine(`[scout] Session restored: ${sessionMeta.id}`);
      return;
    }

    const result = await this.sessionRuntime.switchSession(this.sessionRepo, sessionMeta);
    if (result.cancelled) {
      this.outputChannel.appendLine(
        `[scout] Session restore cancelled by extension: ${sessionMeta.id}`,
      );
      return;
    }
    this.emit({ type: 'state_change' });
    this.outputChannel.appendLine(`[scout] Session restored: ${sessionMeta.id}`);
  }

  async newSession(): Promise<void> {
    if (!this.sessionRepo) {
      await this.initialize();
      return;
    }
    if (!this.sessionRuntime) {
      await this.initialize();
      return;
    }

    const result = await this.sessionRuntime.newSession(this.sessionRepo);
    if (result.cancelled) {
      this.outputChannel.appendLine('[scout] New session cancelled by extension');
      return;
    }
    this.emit({ type: 'state_change' });
  }

  async listSessions(): Promise<JsonlSessionMetadata[]> {
    if (!this.sessionRepo) return [];
    try {
      return await this.sessionRepo.list({ cwd: this.cwd });
    } catch {
      return [];
    }
  }

  /** 删除指定 session 文件（不影响当前活跃 session） */
  async deleteSession(sessionMeta: JsonlSessionMetadata): Promise<void> {
    if (!this.sessionRepo) return;
    try {
      await this.sessionRepo.delete(sessionMeta);
      this.outputChannel.appendLine(`[scout] Session deleted: ${sessionMeta.id}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[scout] Delete session failed: ${errorMessage}`);
      throw error;
    }
  }

  // ---------- 运行时委托 ----------

  async prompt(text: string): Promise<void> {
    if (!this.agentSession) {
      await this.initialize();
    }
    await this.agentSession?.prompt(text);
  }

  async abort(): Promise<void> {
    await this.agentSession?.abort();
  }

  /** 无新用户消息续约对话，委托给 AgentSession.continue() */
  async continue(): Promise<void> {
    await this.agentSession?.continue();
  }

  async setModel(modelId: string): Promise<void> {
    await this.agentSession?.setModel(modelId);
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    await this.agentSession?.setThinkingLevel(level);
  }

  async compact(): Promise<void> {
    await this.agentSession?.compact();
  }

  async abortRetry(): Promise<void> {
    await this.agentSession?.abortRetry();
  }

  async fork(entryId: string, position: 'before' | 'at'): Promise<void> {
    if (!this.sessionRepo || !this.agentSession || !this.sessionRuntime) {
      this.emit({ type: 'error', message: 'No active session to fork from' });
      return;
    }

    try {
      const result = await this.sessionRuntime?.fork(this.sessionRepo, entryId, position);
      if (result?.cancelled) {
        this.outputChannel.appendLine(
          `[scout] Fork cancelled by extension: ${entryId} (${position})`,
        );
        return;
      }
      this.emit({ type: 'state_change' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[scout] Fork failed: ${errorMessage}`);
      this.emit({ type: 'error', message: `Fork failed: ${errorMessage}` });
    }
  }

  // ---------- Tree / Navigation / Label 委托 ----------

  async getTree(): Promise<ScoutSessionTreeNode[]> {
    if (!this.agentSession) return [];
    return this.agentSession.getTree();
  }

  async navigateTree(
    targetId: string,
    options?: { summarize?: boolean; customInstructions?: string; label?: string },
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
    return this.agentSession?.getScoutMessages() ?? [];
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

  // ---------- 内部：AgentSession 管理 ----------

  /** 替换当前 AgentSession，订阅其事件并透传 */
  protected setAgentSession(agentSession: AgentSession, disposePrevious = true): void {
    // 取消订阅旧的
    this.unsubscribeAgentSession?.();
    if (disposePrevious) {
      this.agentSession?.dispose();
    }

    this.agentSession = agentSession;
    // 透传所有事件给上层监听者
    this.unsubscribeAgentSession = agentSession.subscribe((event) => this.emit(event));
  }

  // ---------- 内部：扩展系统 ----------

  private readonly createRuntime: CreateAgentSessionRuntimeFactory = async ({
    session,
    activeToolNames,
  }) => {
    const diagnostics: AgentSessionRuntimeDiagnostic[] = [];
    let modelFallbackMessage: string | undefined;

    const context = await session.buildContext();
    if (context.model && !this.configManager.findModel(context.model.modelId)) {
      const fallbackModel = this.configManager.findDefaultModel();
      if (fallbackModel) {
        modelFallbackMessage = `Session model "${context.model.modelId}" is unavailable. Falling back to "${fallbackModel.id}".`;
        diagnostics.push({ type: 'warning', message: modelFallbackMessage });
        this.outputChannel.appendLine(`[scout] WARN: ${modelFallbackMessage}`);
      }
    }

    const { skills, diagnostics: skillDiagnostics } = loadSkills({
      cwd: this.cwd,
      agentDir: this.agentDir,
    });
    for (const diag of skillDiagnostics) {
      const type = diag.severity === 'error' ? 'error' : 'warning';
      const message = `${diag.filePath}: ${diag.message}`;
      diagnostics.push({ type, message });
      const prefix = type === 'error' ? 'ERROR' : 'WARN';
      this.outputChannel.appendLine(`[scout] ${prefix}: ${message}`);
    }

    const extensionRunner = await this.loadExtensions(diagnostics);

    const agentSession = new AgentSession({
      session: session as Session,
      configManager: this.configManager,
      cwd: this.cwd,
      outputChannel: this.outputChannel,
      skills,
      extensionRunner,
      activeToolNames,
    });

    if (extensionRunner) {
      this.bindExtensionActions(extensionRunner, agentSession);
    }

    await agentSession.initialize();

    return {
      session: agentSession,
      diagnostics,
      modelFallbackMessage,
    };
  };

  /** 发现并加载扩展，返回 ScoutExtensionRunner 或 undefined */
  private async loadExtensions(
    diagnostics?: AgentSessionRuntimeDiagnostic[],
  ): Promise<ScoutExtensionRunner | undefined> {
    const configuredPaths = this.configManager.getExtensionPaths();
    const { extensions, errors, runtime } = await discoverAndLoadExtensions(
      configuredPaths,
      this.cwd,
      this.agentDir,
    );

    for (const err of errors) {
      diagnostics?.push({
        type: 'error',
        message: `Extension "${err.path}" error: ${err.error}`,
      });
      this.outputChannel.appendLine(`[scout] Extension load error: ${err.path}: ${err.error}`);
    }

    if (extensions.length === 0) return undefined;

    // 创建 Runner（core actions 通过 bindExtensionActions 绑定）
    const extensionRunner = new ScoutExtensionRunner(
      extensions,
      runtime,
      this.cwd,
      this,
      this.configManager,
    );

    this.outputChannel.appendLine(
      `[scout] Loaded ${extensions.length} extension(s): ${extensions.map((e) => e.path).join(', ')}`,
    );

    return extensionRunner;
  }

  /** 绑定扩展 core actions 到指定 AgentSession */
  private bindExtensionActions(
    extensionRunner: ScoutExtensionRunner,
    agentSession: AgentSession,
  ): void {
    const extensionActions: ScoutExtensionActions = {
      sendMessage: (message: string) => {
        this.outputChannel.appendLine(`[scout] Extension message: ${message}`);
      },
      sendUserMessage: (content, options) => {
        void agentSession.sendUserMessage(content, options);
      },
      getActiveTools: () => agentSession.getActiveToolNames(),
      getAllTools: () => agentSession.getAllToolInfos(),
      setActiveTools: (toolNames: string[]) => {
        void agentSession.setActiveTools(toolNames);
      },
      refreshTools: () => {
        void agentSession.refreshTools();
      },
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
      setModel: (modelId: string) => agentSession.setModel(modelId),
      setThinkingLevel: (level: string) => {
        const VALID_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high'];
        const validated = VALID_LEVELS.includes(level as ThinkingLevel)
          ? (level as ThinkingLevel)
          : 'off';
        return agentSession.setThinkingLevel(validated);
      },
      getContextUsage: () => agentSession.getContextUsage(),
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
      this.listeners.length = 0;
      for (const d of this.disposables) d.dispose();
      this.disposables.length = 0;

      if (runtime) {
        await runtime.dispose();
      } else {
        agentSession?.dispose();
      }
    })();

    return this.disposePromise;
  }

  dispose(): void {
    this.unsubscribeAgentSession?.();
    void this.disposeAsync();
  }

  // ---------- 静态工厂 ----------

  /**
   * 创建使用内存 repo 的 SessionManager，不持久化任何数据。
   * 用于测试或演示场景。
   * @param options cwd / configManager 必须提供；agentDir / outputChannel 可省略
   */
  static async createInMemory(options: {
    cwd: string;
    configManager: ConfigManager;
    outputChannel?: vscode.OutputChannel;
  }): Promise<SessionManager> {
    const dummyOutputChannel: vscode.OutputChannel =
      options.outputChannel ??
      ({
        name: 'scout-in-memory',
        append: () => {},
        appendLine: () => {},
        replace: () => {},
        clear: () => {},
        show: () => {},
        hide: () => {},
        dispose: () => {},
      } as unknown as vscode.OutputChannel);

    const manager = new SessionManager({
      cwd: options.cwd,
      agentDir: '',
      outputChannel: dummyOutputChannel,
      configManager: options.configManager,
    });

    // 替换为内存 repo，并赋值到 manager.sessionRepo 供 listSessions/deleteSession 使用
    const memRepo = new InMemorySessionRepo();
    manager.sessionRepo = memRepo as unknown as typeof manager.sessionRepo;

    const session = await memRepo.create({ id: `mem-${Date.now()}` });

    const agentSession = new AgentSession({
      session: session as Session,
      configManager: options.configManager,
      cwd: options.cwd,
      outputChannel: dummyOutputChannel,
      skills: [],
    });

    try {
      await agentSession.initialize();
    } catch (error) {
      agentSession.dispose();
      throw new Error(
        `createInMemory: AgentSession initialization failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    manager.setAgentSession(agentSession);

    return manager;
  }
}
