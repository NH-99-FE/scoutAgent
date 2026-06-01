// ============================================================
// ScoutExtensionRunner — 事件分发、工具收集、bindCore
// 从 Pi ExtensionRunner 简化：去除 UI/commands/flags/shortcuts/providers
// ============================================================

import type { Model } from '@scout-agent/ai';
import type { AgentMessage, ContextUsageEstimate } from '@scout-agent/agent';
import type {
  ScoutExtension,
  ScoutExtensionActions,
  ScoutExtensionContext,
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
  BeforeProviderRequestEventResult,
  BeforeProviderPayloadEvent,
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
  RegisteredTool,
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

// ---------- ScoutExtensionRunner ----------

export class ScoutExtensionRunner {
  private extensions: ScoutExtension[];
  private runtime: ScoutExtensionRuntime;
  private cwd: string;
  private sessionManager: SessionManager;
  private configManager: ConfigManager;
  private errorListeners: Set<ScoutExtensionErrorListener> = new Set();

  // bindCore 注入的上下文动作
  private getModelFn: () => Model<any> | undefined = () => undefined;
  private isIdleFn: () => boolean = () => true;
  private abortFn: () => void = () => {};
  private getSystemPromptFn: () => string = () => '';
  private hasPendingMessagesFn: () => boolean = () => false;
  private getSignalFn: () => AbortSignal | undefined = () => undefined;
  private compactFn: () => void = () => {};
  private shutdownFn: () => void = () => {};
  private setModelFn: (modelId: string) => Promise<void> = async () => {};
  private setThinkingLevelFn: (level: string) => Promise<void> = async () => {};
  private getContextUsageFn: () => ContextUsageEstimate | undefined = () => undefined;

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
    };
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
      this.staleMessage =
        message ??
        'This extension context is stale after session replacement. Do not use a captured context after session changes.';
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

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get('tool_call');
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const handlerResult = (await handler(event, ctx)) as ToolCallEventResult | undefined;

          if (handlerResult?.block) {
            return handlerResult;
          }
        } catch (err) {
          this.emitHandlerError(ext.path, 'tool_call', err);
        }
      }
    }

    return undefined;
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
      terminate: (event as ToolResultEvent & { terminate?: boolean }).terminate,
    };
  }

  /**
   * before_provider_request：传递事件，扩展可修改 streamOptions
   */
  async emitBeforeProviderRequest(
    event: BeforeProviderRequestEvent,
  ): Promise<BeforeProviderRequestEventResult | undefined> {
    const ctx = this.createContext();
    let result: BeforeProviderRequestEventResult | undefined;

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get('before_provider_request');
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const handlerResult = (await handler(event, ctx)) as
            | BeforeProviderRequestEventResult
            | undefined;
          if (handlerResult) result = handlerResult;
        } catch (err) {
          this.emitHandlerError(ext.path, 'before_provider_request', err);
        }
      }
    }

    return result;
  }

  /**
   * before_provider_payload：传递事件，扩展可修改 payload
   */
  async emitBeforeProviderPayload(event: BeforeProviderPayloadEvent): Promise<unknown> {
    const ctx = this.createContext();
    let currentPayload = event.payload;

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get('before_provider_payload');
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const handlerResult = await handler({ ...event, payload: currentPayload }, ctx);
          if (handlerResult !== undefined) {
            currentPayload = handlerResult;
          }
        } catch (err) {
          this.emitHandlerError(ext.path, 'before_provider_payload', err);
        }
      }
    }

    return currentPayload;
  }

  /**
   * session_before_compact：第一个 cancel=true 短路
   */
  async emitSessionBeforeCompact(
    event: SessionBeforeCompactEvent,
  ): Promise<SessionBeforeCompactResult | undefined> {
    const ctx = this.createContext();
    let result: SessionBeforeCompactResult | undefined;

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get('session_before_compact');
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const handlerResult = (await handler(event, ctx)) as
            | SessionBeforeCompactResult
            | undefined;

          if (handlerResult) {
            result = handlerResult;
            if (result.cancel) return result;
          }
        } catch (err) {
          this.emitHandlerError(ext.path, 'session_before_compact', err);
        }
      }
    }

    return result;
  }

  /**
   * session_before_tree：第一个 cancel=true 短路
   */
  async emitSessionBeforeTree(
    event: SessionBeforeTreeEvent,
  ): Promise<SessionBeforeTreeResult | undefined> {
    const ctx = this.createContext();
    let result: SessionBeforeTreeResult | undefined;

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get('session_before_tree');
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const handlerResult = (await handler(event, ctx)) as SessionBeforeTreeResult | undefined;

          if (handlerResult) {
            result = handlerResult;
            if (result.cancel) return result;
          }
        } catch (err) {
          this.emitHandlerError(ext.path, 'session_before_tree', err);
        }
      }
    }

    return result;
  }

  /**
   * session_before_fork：第一个 cancel=true 短路
   */
  async emitSessionBeforeFork(
    event: SessionBeforeForkEvent,
  ): Promise<SessionBeforeForkResult | undefined> {
    const ctx = this.createContext();
    let result: SessionBeforeForkResult | undefined;

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get('session_before_fork');
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const handlerResult = (await handler(event, ctx)) as SessionBeforeForkResult | undefined;

          if (handlerResult) {
            result = handlerResult;
            if (result.cancel) return result;
          }
        } catch (err) {
          this.emitHandlerError(ext.path, 'session_before_fork', err);
        }
      }
    }

    return result;
  }

  /**
   * session_before_switch：第一个 cancel=true 短路
   */
  async emitSessionBeforeSwitch(
    event: SessionBeforeSwitchEvent,
  ): Promise<SessionBeforeSwitchResult | undefined> {
    const ctx = this.createContext();
    let result: SessionBeforeSwitchResult | undefined;

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get('session_before_switch');
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const handlerResult = (await handler(event, ctx)) as
            | SessionBeforeSwitchResult
            | undefined;

          if (handlerResult) {
            result = handlerResult;
            if (result.cancel) return result;
          }
        } catch (err) {
          this.emitHandlerError(ext.path, 'session_before_switch', err);
        }
      }
    }

    return result;
  }

  /**
   * session_shutdown：通知所有扩展
   */
  async emitSessionShutdown(event: SessionShutdownEvent): Promise<void> {
    const ctx = this.createContext();

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get('session_shutdown');
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          await handler(event, ctx);
        } catch (err) {
          this.emitHandlerError(ext.path, 'session_shutdown', err);
        }
      }
    }
  }

  /**
   * session_start：通知所有扩展新 session runtime 已绑定
   */
  async emitSessionStart(event: SessionStartEvent): Promise<void> {
    const ctx = this.createContext();

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get('session_start');
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          await handler(event, ctx);
        } catch (err) {
          this.emitHandlerError(ext.path, 'session_start', err);
        }
      }
    }
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
