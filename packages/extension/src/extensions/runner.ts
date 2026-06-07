// ============================================================
// ScoutExtensionRunner — 事件分发、工具收集、bindCore
// Lifecycle reducer 语义以 Pi ExtensionRunner 为来源。
// ============================================================

import type { Api, Model } from '@scout-agent/ai';
import type { AgentMessage } from '@scout-agent/agent';
import type { ScoutContextUsage } from '@scout-agent/shared';
import { STALE_EXTENSION_CONTEXT_MESSAGE } from './types.ts';
import type {
  AfterProviderResponseEvent,
  ScoutExtension,
  ScoutExtensionActions,
  ScoutExtensionContext,
  ScoutExtensionCommandContext,
  ScoutExtensionContextActions,
  ScoutExtensionError,
  ScoutExtensionRuntime,
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ContextEvent,
  ContextEventResult,
  ToolCallEvent,
  ToolCallEventResult,
  ToolResultEvent,
  ToolResultEventResult,
  BeforeProviderRequestEvent,
  MessageEndEvent,
  MessageEndEventResult,
  InputEvent,
  InputEventResult,
  InputSource,
  ResourcesDiscoverEvent,
  ResourcesDiscoverResult,
  SessionBeforeCompactEvent,
  SessionBeforeCompactResult,
  SessionBeforeTreeEvent,
  SessionBeforeTreeResult,
  SessionBeforeForkEvent,
  SessionBeforeForkResult,
  SessionBeforeSwitchEvent,
  SessionBeforeSwitchResult,
  SessionShutdownEvent,
  SessionStartEvent,
  ScoutExtensionEvent,
  RegisteredTool,
  RegisteredCommand,
  ResolvedCommand,
  ResourceDiagnostic,
} from './types.ts';
import type { ConfigManager } from '../config-manager.ts';
import type { SessionManager } from '../session-manager.ts';

// ---------- 错误监听器 ----------

export type ScoutExtensionErrorListener = (error: ScoutExtensionError) => void;

// ---------- before_agent_start 聚合结果 ----------

interface BeforeAgentStartCombinedResult {
  messages?: NonNullable<BeforeAgentStartEventResult['message']>[];
  systemPrompt?: string;
}

type RunnerEmitEvent = Exclude<
  ScoutExtensionEvent,
  | ToolCallEvent
  | ToolResultEvent
  | ContextEvent
  | BeforeProviderRequestEvent
  | BeforeAgentStartEvent
  | MessageEndEvent
  | ResourcesDiscoverEvent
  | InputEvent
>;

type SessionBeforeEvent = Extract<
  RunnerEmitEvent,
  {
    type:
      | 'session_before_switch'
      | 'session_before_fork'
      | 'session_before_compact'
      | 'session_before_tree';
  }
>;

type SessionBeforeEventResult =
  | SessionBeforeSwitchResult
  | SessionBeforeForkResult
  | SessionBeforeCompactResult
  | SessionBeforeTreeResult;

type RunnerEmitResult<TEvent extends RunnerEmitEvent> = TEvent extends {
  type: 'session_before_switch';
}
  ? SessionBeforeSwitchResult | undefined
  : TEvent extends { type: 'session_before_fork' }
    ? SessionBeforeForkResult | undefined
    : TEvent extends { type: 'session_before_compact' }
      ? SessionBeforeCompactResult | undefined
      : TEvent extends { type: 'session_before_tree' }
        ? SessionBeforeTreeResult | undefined
        : undefined;

interface ResourcesDiscoverCombinedResult {
  skillPaths: Array<{ path: string; extensionPath: string }>;
  promptPaths: Array<{ path: string; extensionPath: string }>;
  themePaths: Array<{ path: string; extensionPath: string }>;
}

// ---------- ScoutExtensionRunner ----------

export class ScoutExtensionRunner {
  private extensions: ScoutExtension[];
  private runtime: ScoutExtensionRuntime;
  private cwd: string;
  private sessionManager: SessionManager;
  private configManager: ConfigManager;
  private errorListeners: Set<ScoutExtensionErrorListener> = new Set();
  private commandDiagnostics: ResourceDiagnostic[] = [];

  // bindCore 注入的上下文动作
  private getModelFn: () => Model<Api> | undefined = () => undefined;
  private isIdleFn: () => boolean = () => true;
  private abortFn: () => void = () => {};
  private getSystemPromptFn: () => string = () => '';
  private hasPendingMessagesFn: () => boolean = () => false;
  private getSignalFn: () => AbortSignal | undefined = () => undefined;
  private compactFn: () => void = () => {};
  private shutdownFn: () => void = () => {};
  private setModelFn: (modelId: string) => Promise<void> = async () => {};
  private setThinkingLevelFn: (level: string) => Promise<void> = async () => {};
  private getContextUsageFn: () => Promise<ScoutContextUsage | undefined> = async () => undefined;
  private newSessionFn: ScoutExtensionContextActions['newSession'] = async () => ({
    cancelled: true,
  });
  private forkFn: ScoutExtensionContextActions['fork'] = async () => ({ cancelled: true });
  private switchSessionFn: ScoutExtensionContextActions['switchSession'] = async () => ({
    cancelled: true,
  });
  private waitForIdleFn: ScoutExtensionContextActions['waitForIdle'] = async () => {};
  private reloadFn: ScoutExtensionContextActions['reload'] = async () => {};
  private navigateTreeFn: ScoutExtensionContextActions['navigateTree'] = async () => ({
    cancelled: true,
  });

  // stale 状态
  private staleMessage: string | undefined;

  constructor(
    extensions: ScoutExtension[],
    runtime: ScoutExtensionRuntime,
    cwd: string,
    sessionManager: SessionManager,
    configManager: ConfigManager,
  ) {
    this.extensions = extensions;
    this.runtime = runtime;
    this.cwd = cwd;
    this.sessionManager = sessionManager;
    this.configManager = configManager;
  }

  // ---------- 核心绑定 ----------

  /**
   * 绑定动作方法和上下文动作。
   * 必须在扩展加载后、使用前调用。
   */
  bindCore(actions: ScoutExtensionActions, contextActions: ScoutExtensionContextActions): void {
    // 动作方法 → 共享 runtime
    this.runtime.sendMessage = actions.sendMessage;
    this.runtime.sendUserMessage = actions.sendUserMessage;
    this.runtime.getActiveTools = actions.getActiveTools;
    this.runtime.getAllTools = actions.getAllTools;
    this.runtime.setActiveTools = actions.setActiveTools;
    this.runtime.refreshTools = actions.refreshTools;
    this.runtime.appendEntry = actions.appendEntry;
    this.runtime.setSessionName = actions.setSessionName;
    this.runtime.getSessionName = actions.getSessionName;
    this.runtime.setLabel = actions.setLabel;
    this.runtime.getCommands = actions.getCommands;

    // 上下文动作
    this.getModelFn = contextActions.getModel;
    this.isIdleFn = contextActions.isIdle;
    this.abortFn = contextActions.abort;
    this.getSystemPromptFn = contextActions.getSystemPrompt;
    this.hasPendingMessagesFn = contextActions.hasPendingMessages;
    this.getSignalFn = contextActions.getSignal;
    this.compactFn = contextActions.compact;
    this.shutdownFn = contextActions.shutdown;
    this.setModelFn = contextActions.setModel;
    this.setThinkingLevelFn = contextActions.setThinkingLevel;
    this.getContextUsageFn = contextActions.getContextUsage;
    this.newSessionFn = contextActions.newSession;
    this.forkFn = contextActions.fork;
    this.switchSessionFn = contextActions.switchSession;
    this.waitForIdleFn = contextActions.waitForIdle;
    this.reloadFn = contextActions.reload;
    this.navigateTreeFn = contextActions.navigateTree;
  }

  // ---------- 上下文创建 ----------

  /**
   * 创建 ScoutExtensionContext。
   * 值在调用时解析，bindCore 更新自动反映。
   */
  createContext(): ScoutExtensionContext {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const runner = this;
    const getModel = this.getModelFn;
    return {
      get cwd() {
        runner.assertActive();
        return runner.cwd;
      },
      get sessionManager() {
        runner.assertActive();
        return runner.sessionManager;
      },
      get configManager() {
        runner.assertActive();
        return runner.configManager;
      },
      get model() {
        runner.assertActive();
        return getModel();
      },
      isIdle: () => {
        runner.assertActive();
        return runner.isIdleFn();
      },
      get signal() {
        runner.assertActive();
        return runner.getSignalFn();
      },
      abort: () => {
        runner.assertActive();
        runner.abortFn();
      },
      getSystemPrompt: () => {
        runner.assertActive();
        return runner.getSystemPromptFn();
      },
      hasPendingMessages: () => {
        runner.assertActive();
        return runner.hasPendingMessagesFn();
      },
      compact: () => {
        runner.assertActive();
        runner.compactFn();
      },
      shutdown: () => {
        runner.assertActive();
        runner.shutdownFn();
      },
      setModel: (modelId: string) => {
        runner.assertActive();
        return runner.setModelFn(modelId);
      },
      setThinkingLevel: (level: string) => {
        runner.assertActive();
        return runner.setThinkingLevelFn(level);
      },
      getContextUsage: () => {
        runner.assertActive();
        return runner.getContextUsageFn();
      },
      newSession: (options) => {
        runner.assertActive();
        return runner.newSessionFn(options);
      },
      fork: (entryId, options) => {
        runner.assertActive();
        return runner.forkFn(entryId, options);
      },
      switchSession: (sessionMeta, options) => {
        runner.assertActive();
        return runner.switchSessionFn(sessionMeta, options);
      },
    };
  }

  createCommandContext(): ScoutExtensionCommandContext {
    const context = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(this.createContext()),
    ) as ScoutExtensionCommandContext;
    context.waitForIdle = () => {
      this.assertActive();
      return this.waitForIdleFn();
    };
    context.reload = () => {
      this.assertActive();
      return this.reloadFn();
    };
    context.navigateTree = (targetId, options) => {
      this.assertActive();
      return this.navigateTreeFn(targetId, options);
    };
    return context;
  }

  // ---------- 工具收集 ----------

  /** 获取所有扩展注册的工具（同名工具第一个注册的胜出） */
  getAllRegisteredTools(): RegisteredTool[] {
    const toolsByName = new Map<string, RegisteredTool>();
    for (const ext of this.extensions) {
      for (const tool of ext.tools.values()) {
        if (!toolsByName.has(tool.definition.name)) {
          toolsByName.set(tool.definition.name, tool);
        }
      }
    }
    return Array.from(toolsByName.values());
  }

  private resolveRegisteredCommands(): {
    commands: ResolvedCommand[];
    diagnostics: ResourceDiagnostic[];
  } {
    const commands: RegisteredCommand[] = [];
    const counts = new Map<string, number>();
    for (const ext of this.extensions) {
      for (const command of ext.commands.values()) {
        commands.push(command);
        counts.set(command.name, (counts.get(command.name) ?? 0) + 1);
      }
    }

    const seen = new Map<string, number>();
    const takenInvocationNames = new Set<string>();
    const diagnostics = this.buildCommandCollisionDiagnostics(commands, counts);
    return {
      commands: commands.map((command) => {
        const occurrence = (seen.get(command.name) ?? 0) + 1;
        seen.set(command.name, occurrence);

        let invocationName =
          (counts.get(command.name) ?? 0) > 1 ? `${command.name}:${occurrence}` : command.name;
        if (takenInvocationNames.has(invocationName)) {
          let suffix = occurrence;
          do {
            suffix += 1;
            invocationName = `${command.name}:${suffix}`;
          } while (takenInvocationNames.has(invocationName));
        }

        takenInvocationNames.add(invocationName);
        return { ...command, invocationName };
      }),
      diagnostics,
    };
  }

  private buildCommandCollisionDiagnostics(
    commands: RegisteredCommand[],
    counts: Map<string, number>,
  ): ResourceDiagnostic[] {
    const diagnostics: ResourceDiagnostic[] = [];
    const winners = new Map<string, RegisteredCommand>();

    for (const command of commands) {
      if ((counts.get(command.name) ?? 0) <= 1) continue;

      const winner = winners.get(command.name);
      if (!winner) {
        winners.set(command.name, command);
        continue;
      }

      diagnostics.push({
        type: 'collision',
        message: `command "/${command.name}" collision`,
        path: command.sourceInfo.path,
        collision: {
          resourceType: 'extension',
          name: command.name,
          winnerPath: winner.sourceInfo.path,
          loserPath: command.sourceInfo.path,
          winnerSource: winner.sourceInfo.source,
          loserSource: command.sourceInfo.source,
        },
      });
    }

    return diagnostics;
  }

  getRegisteredCommands(): ResolvedCommand[] {
    const result = this.resolveRegisteredCommands();
    this.commandDiagnostics = result.diagnostics;
    return result.commands;
  }

  getCommandDiagnostics(): ResourceDiagnostic[] {
    return this.commandDiagnostics;
  }

  getCommand(name: string): ResolvedCommand | undefined {
    const result = this.resolveRegisteredCommands();
    this.commandDiagnostics = result.diagnostics;
    return result.commands.find((command) => command.invocationName === name);
  }

  /** 按名称查找工具定义 */
  getToolDefinition(toolName: string): RegisteredTool['definition'] | undefined {
    for (const ext of this.extensions) {
      const tool = ext.tools.get(toolName);
      if (tool) return tool.definition;
    }
    return undefined;
  }

  // ---------- Stale / 错误 ----------

  invalidate(message?: string): void {
    if (!this.staleMessage) {
      this.staleMessage = message ?? STALE_EXTENSION_CONTEXT_MESSAGE;
      this.runtime.invalidate(this.staleMessage);
    }
  }

  private assertActive(): void {
    if (this.staleMessage) {
      throw new Error(this.staleMessage);
    }
  }

  onError(listener: ScoutExtensionErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  emitError(error: ScoutExtensionError): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }

  // ---------- Handler 检测 ----------

  hasHandlers(eventType: string): boolean {
    for (const ext of this.extensions) {
      const handlers = ext.handlers.get(eventType);
      if (handlers && handlers.length > 0) return true;
    }
    return false;
  }

  /** 获取所有扩展路径 */
  getExtensionPaths(): string[] {
    return this.extensions.map((e) => e.path);
  }

  // ---------- 事件分发 ----------

  private isSessionBeforeEvent(event: RunnerEmitEvent): event is SessionBeforeEvent {
    return (
      event.type === 'session_before_switch' ||
      event.type === 'session_before_fork' ||
      event.type === 'session_before_compact' ||
      event.type === 'session_before_tree'
    );
  }

  async emit<TEvent extends RunnerEmitEvent>(event: TEvent): Promise<RunnerEmitResult<TEvent>> {
    const ctx = this.createContext();
    let result: SessionBeforeEventResult | undefined;

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get(event.type);
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const handlerResult = await handler(event, ctx);

          if (this.isSessionBeforeEvent(event) && handlerResult) {
            result = handlerResult as SessionBeforeEventResult;
            if (result.cancel) {
              return result as RunnerEmitResult<TEvent>;
            }
          }
        } catch (err) {
          this.emitHandlerError(ext.path, event.type, err);
        }
      }
    }

    return result as RunnerEmitResult<TEvent>;
  }

  /**
   * before_agent_start：收集所有 messages + 最后一个 systemPrompt
   */
  async emitBeforeAgentStart(
    event: BeforeAgentStartEvent,
  ): Promise<BeforeAgentStartCombinedResult | undefined> {
    let currentSystemPrompt = event.systemPrompt;
    const ctx = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(this.createContext()),
    ) as ScoutExtensionContext;
    ctx.getSystemPrompt = () => {
      this.assertActive();
      return currentSystemPrompt;
    };
    const messages: NonNullable<BeforeAgentStartEventResult['message']>[] = [];
    let systemPromptModified = false;

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get('before_agent_start');
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const currentEvent: BeforeAgentStartEvent = {
            ...event,
            systemPrompt: currentSystemPrompt,
          };
          const handlerResult = (await handler(currentEvent, ctx)) as
            | BeforeAgentStartEventResult
            | undefined;

          if (handlerResult) {
            if (handlerResult.message) messages.push(handlerResult.message);
            if (handlerResult.systemPrompt !== undefined) {
              currentSystemPrompt = handlerResult.systemPrompt;
              systemPromptModified = true;
            }
          }
        } catch (err) {
          this.emitHandlerError(ext.path, 'before_agent_start', err);
        }
      }
    }

    if (messages.length > 0 || systemPromptModified) {
      return {
        messages: messages.length > 0 ? messages : undefined,
        systemPrompt: systemPromptModified ? currentSystemPrompt : undefined,
      };
    }

    return undefined;
  }

  async emitResourcesDiscover(
    cwd: string,
    reason: ResourcesDiscoverEvent['reason'],
  ): Promise<ResourcesDiscoverCombinedResult> {
    const ctx = this.createContext();
    const skillPaths: Array<{ path: string; extensionPath: string }> = [];
    const promptPaths: Array<{ path: string; extensionPath: string }> = [];
    const themePaths: Array<{ path: string; extensionPath: string }> = [];

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get('resources_discover');
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const event: ResourcesDiscoverEvent = { type: 'resources_discover', cwd, reason };
          const result = (await handler(event, ctx)) as ResourcesDiscoverResult | undefined;

          if (result?.skillPaths?.length) {
            skillPaths.push(
              ...result.skillPaths.map((path) => ({ path, extensionPath: ext.path })),
            );
          }
          if (result?.promptPaths?.length) {
            promptPaths.push(
              ...result.promptPaths.map((path) => ({ path, extensionPath: ext.path })),
            );
          }
          if (result?.themePaths?.length) {
            themePaths.push(
              ...result.themePaths.map((path) => ({ path, extensionPath: ext.path })),
            );
          }
        } catch (err) {
          this.emitHandlerError(ext.path, 'resources_discover', err);
        }
      }
    }

    return { skillPaths, promptPaths, themePaths };
  }

  async emitInput(
    text: string,
    images: InputEvent['images'],
    source: InputSource,
  ): Promise<InputEventResult> {
    const ctx = this.createContext();
    let currentText = text;
    let currentImages = images;

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get('input');
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const event: InputEvent = {
            type: 'input',
            text: currentText,
            images: currentImages,
            source,
          };
          const result = (await handler(event, ctx)) as InputEventResult | undefined;
          if (result?.action === 'handled') return result;
          if (result?.action === 'transform') {
            currentText = result.text;
            currentImages = result.images ?? currentImages;
          }
        } catch (err) {
          this.emitHandlerError(ext.path, 'input', err);
        }
      }
    }

    if (currentText !== text || currentImages !== images) {
      return { action: 'transform', text: currentText, images: currentImages };
    }
    return { action: 'continue' };
  }

  async emitMessageEnd(event: MessageEndEvent): Promise<AgentMessage | undefined> {
    const ctx = this.createContext();
    let currentMessage = event.message;
    let modified = false;

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get('message_end');
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const currentEvent: MessageEndEvent = { ...event, message: currentMessage };
          const result = (await handler(currentEvent, ctx)) as MessageEndEventResult | undefined;
          if (!result?.message) continue;

          if (result.message.role !== currentMessage.role) {
            this.emitError({
              extensionPath: ext.path,
              event: 'message_end',
              error: 'message_end handlers must return a message with the same role',
            });
            continue;
          }

          currentMessage = result.message;
          modified = true;
        } catch (err) {
          this.emitHandlerError(ext.path, 'message_end', err);
        }
      }
    }

    return modified ? currentMessage : undefined;
  }

  /**
   * context：最后返回的 messages 胜出
   */
  async emitContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
    const ctx = this.createContext();
    let currentMessages = structuredClone(messages);

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get('context');
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const event: ContextEvent = { type: 'context', messages: currentMessages };
          const handlerResult = (await handler(event, ctx)) as ContextEventResult | undefined;

          if (handlerResult?.messages) {
            currentMessages = handlerResult.messages;
          }
        } catch (err) {
          this.emitHandlerError(ext.path, 'context', err);
        }
      }
    }

    return currentMessages;
  }

  /**
   * tool_call：第一个 block=true 短路返回
   */
  async emitToolCall(event: ToolCallEvent): Promise<ToolCallEventResult | undefined> {
    const ctx = this.createContext();
    let result: ToolCallEventResult | undefined;

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get('tool_call');
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        const handlerResult = (await handler(event, ctx)) as ToolCallEventResult | undefined;

        if (handlerResult) {
          result = handlerResult;
          if (result.block) return result;
        }
      }
    }

    return result;
  }

  /**
   * tool_result：顺序 patch 合并
   */
  async emitToolResult(event: ToolResultEvent): Promise<ToolResultEventResult | undefined> {
    const ctx = this.createContext();
    const currentEvent: ToolResultEvent = { ...event };
    let modified = false;

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get('tool_result');
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const handlerResult = (await handler(currentEvent, ctx)) as
            | ToolResultEventResult
            | undefined;
          if (!handlerResult) continue;

          if (handlerResult.content !== undefined) {
            currentEvent.content = handlerResult.content;
            modified = true;
          }
          if (handlerResult.details !== undefined) {
            currentEvent.details = handlerResult.details;
            modified = true;
          }
          if (handlerResult.isError !== undefined) {
            currentEvent.isError = handlerResult.isError;
            modified = true;
          }
        } catch (err) {
          this.emitHandlerError(ext.path, 'tool_result', err);
        }
      }
    }

    if (!modified) return undefined;

    return {
      content: currentEvent.content,
      details: currentEvent.details,
      isError: currentEvent.isError,
    };
  }

  async emitBeforeProviderRequest(payload: unknown): Promise<unknown> {
    const ctx = this.createContext();
    let currentPayload = payload;

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get('before_provider_request');
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const event: BeforeProviderRequestEvent = {
            type: 'before_provider_request',
            payload: currentPayload,
          };
          const handlerResult = await handler(event, ctx);
          if (handlerResult !== undefined) {
            currentPayload = handlerResult;
          }
        } catch (err) {
          this.emitHandlerError(ext.path, 'before_provider_request', err);
        }
      }
    }

    return currentPayload;
  }

  async emitAfterProviderResponse(event: AfterProviderResponseEvent): Promise<void> {
    await this.emit(event);
  }

  /**
   * session_before_compact：第一个 cancel=true 短路
   */
  async emitSessionBeforeCompact(
    event: SessionBeforeCompactEvent,
  ): Promise<SessionBeforeCompactResult | undefined> {
    return this.emit(event);
  }

  /**
   * session_before_tree：第一个 cancel=true 短路
   */
  async emitSessionBeforeTree(
    event: SessionBeforeTreeEvent,
  ): Promise<SessionBeforeTreeResult | undefined> {
    return this.emit(event);
  }

  /**
   * session_before_fork：第一个 cancel=true 短路
   */
  async emitSessionBeforeFork(
    event: SessionBeforeForkEvent,
  ): Promise<SessionBeforeForkResult | undefined> {
    return this.emit(event);
  }

  /**
   * session_before_switch：第一个 cancel=true 短路
   */
  async emitSessionBeforeSwitch(
    event: SessionBeforeSwitchEvent,
  ): Promise<SessionBeforeSwitchResult | undefined> {
    return this.emit(event);
  }

  /**
   * session_shutdown：通知所有扩展
   */
  async emitSessionShutdown(event: SessionShutdownEvent): Promise<void> {
    await this.emit(event);
  }

  /**
   * session_start：通知所有扩展新 session runtime 已绑定
   */
  async emitSessionStart(event: SessionStartEvent): Promise<void> {
    await this.emit(event);
  }

  async emitUserBash(event: {
    type: 'user_bash';
    command: string;
    excludeFromContext: boolean;
    cwd: string;
  }): Promise<unknown | undefined> {
    const ctx = this.createContext();

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get('user_bash');
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const result = await handler(event, ctx);
          if (result) return result;
        } catch (err) {
          this.emitHandlerError(ext.path, 'user_bash', err);
        }
      }
    }

    return undefined;
  }

  // ---------- 内部辅助 ----------

  private emitHandlerError(extensionPath: string, eventType: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    this.emitError({
      extensionPath,
      event: eventType,
      error: message,
      stack,
    });
  }
}
