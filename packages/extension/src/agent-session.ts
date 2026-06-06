// ============================================================
// AgentSession — 单次会话的核心生命周期管理
// 负责：Harness 创建/销毁、事件处理、消息缓存（单一来源）、
//       Compaction、Auto Retry、Fork、Session Tree/Navigation/Label
// ============================================================

import * as vscode from 'vscode';
import type { Model, Api, AssistantMessage, ImageContent, TextContent } from '@scout-agent/ai';
import { isContextOverflow } from '@scout-agent/ai';
import type {
  AgentEvent,
  AgentHarness,
  AgentHarnessEvent,
  AgentHarnessOptions,
  AgentMessage,
  AgentTool,
  BranchSummaryEntry,
  CompactionEntry,
  ExecutionEnv,
  JsonlSessionMetadata,
  LabelEntry,
  MessageEntry,
  NavigateTreeResult,
  Session,
  SessionContext,
  SessionTreeEntry,
  Skill,
} from '@scout-agent/agent';
import { shouldCompact, calculateContextTokens, estimateContextTokens } from '@scout-agent/agent';
import { NodeExecutionEnv } from '@scout-agent/agent/node';
import type {
  ScoutAgentEvent,
  ScoutContextUsage,
  ScoutMessage,
  ScoutCompactionReason,
  ScoutCompactionResult,
  ScoutSessionTreeNode,
  ThinkingLevel,
} from '@scout-agent/shared';
import { ConfigManager } from './config-manager.ts';
import { buildSystemPrompt } from './system-prompt.ts';
import {
  createTools,
  DEFAULT_ACTIVE_TOOL_NAMES,
  ALL_TOOL_NAMES,
  createBuiltinToolDefinitionEntries,
  type ToolDefinition,
} from './tools/index.ts';
import { ScoutExtensionRunner, wrapRegisteredTools } from './extensions/index.ts';
import { mapAgentEventToScout, convertMessage } from './protocol/agent-event-mapper.ts';
import type {
  ToolInfo,
  SendMessageInput,
  SendUserMessageOptions,
  SourceInfo,
  SessionShutdownEvent,
  SessionStartEvent,
  ReplacedSessionContext,
} from './extensions/types.ts';
import type { Skill as ScoutSkill } from './skill-loader.ts';

// ---------- 类型守卫 ----------

const AGENT_EVENT_TYPES = new Set([
  'agent_start',
  'agent_end',
  'turn_start',
  'turn_end',
  'message_start',
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
]);

function isAgentEvent(event: AgentHarnessEvent): event is AgentEvent {
  return AGENT_EVENT_TYPES.has((event as { type: string }).type);
}

// ---------- 可重试错误判断 ----------

const RETRYABLE_ERROR_PATTERN =
  /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|stream ended before message_stop|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i;

const NON_RETRYABLE_LIMIT_PATTERN =
  /GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing/i;

const EXTENSION_MESSAGE_CUSTOM_TYPE = 'extension_message';

// ---------- 事件类型（判别联合） ----------

export type ScoutSessionEvent =
  | { type: 'agent_event'; event: ScoutAgentEvent }
  | { type: 'state_change' }
  | { type: 'error'; message: string }
  | { type: 'retry_start'; attempt: number; maxAttempts: number; delayMs: number; message: string }
  | {
      type: 'auto_retry_start';
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | { type: 'retry_end'; success: boolean; attempt: number; finalError?: string }
  | { type: 'auto_retry_end'; success: boolean; attempt: number; finalError?: string }
  | { type: 'compaction_start'; reason: ScoutCompactionReason }
  | {
      type: 'compaction_end';
      reason: ScoutCompactionReason;
      result?: ScoutCompactionResult;
      aborted: boolean;
      willRetry: boolean;
      errorMessage?: string;
    }
  | { type: 'thinking_level_changed'; level: ThinkingLevel }
  | { type: 'tree_change' };

// ---------- 构造选项 ----------

export interface AgentSessionOptions {
  session: Session;
  configManager: ConfigManager;
  cwd: string;
  outputChannel: vscode.OutputChannel;
  skills: ScoutSkill[];
  extensionRunner?: ScoutExtensionRunner;
  activeToolNames?: string[];
}

type ToolRegistryEntry = {
  definition: ToolDefinition;
  tool: AgentTool;
  sourceInfo: SourceInfo;
  sourceType: 'builtin' | 'extension';
};

const ACTIVE_TOOLS_CUSTOM_TYPE = 'tools-config';

interface ActiveToolsState {
  enabledTools: string[];
}

// ---------- AgentSession ----------

export class AgentSession implements vscode.Disposable {
  private readonly session: Session;
  private readonly configManager: ConfigManager;
  private readonly cwd: string;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly skills: ScoutSkill[];
  private extensionRunner?: ScoutExtensionRunner;
  private activeToolNames: string[];
  private activeToolsCustomized: boolean;
  private toolRegistry = new Map<string, ToolRegistryEntry>();
  private lastSystemPrompt = '';

  private harness?: AgentHarness;
  private unsubscribeHarness?: () => void;
  private unsubscribeExtensionHooks?: () => void;

  /** 流式/忙碌状态：覆盖 harness 运行和 agent_end 后的 retry/compaction 编排。 */
  private _isStreaming = false;
  private isPostAgentProcessing = false;

  /** Retry 状态 */
  private retryAttempt = 0;
  private retryAbortController: AbortController | undefined;
  private manualCompactionAbortController: AbortController | undefined;
  private autoCompactionAbortController: AbortController | undefined;

  /**
   * Overflow compaction 防重入标志。
   * 置 true 后若下一轮 overflow 再次发生，停止继续 compact-and-retry，
   * 避免无限循环。在 message_start（用户消息到达）时重置为 false。
   */
  private overflowRecoveryAttempted = false;

  /**
   * message_end 时记录最后一条 assistant message，供 agent_end 后决策 retry/compaction。
   * 对齐 Pi 的 _lastAssistantMessage 模式，避免在 message_end 事件回调中重入 harness。
   */
  private lastAssistantMessage: AssistantMessage | undefined;

  /** 从 session.buildContext() 缓存的 ScoutMessage[] — 单一来源 */
  private cachedMessages: ScoutMessage[] = [];

  /** 缓存的 session 元数据 */
  private cachedSessionId?: string;
  private cachedParentSessionPath?: string;
  private cachedLeafId?: string | null;

  /** 事件监听器列表 */
  private listeners: ((event: ScoutSessionEvent) => void)[] = [];

  constructor(options: AgentSessionOptions) {
    this.session = options.session;
    this.configManager = options.configManager;
    this.cwd = options.cwd;
    this.outputChannel = options.outputChannel;
    this.skills = options.skills;
    this.extensionRunner = options.extensionRunner;
    this.activeToolNames = options.activeToolNames ?? [...DEFAULT_ACTIVE_TOOL_NAMES];
    this.activeToolsCustomized = options.activeToolNames !== undefined;
  }

  // ---------- 初始化 ----------

  /** 初始化 harness + 缓存元数据 + 消息。由 SessionManager 构造后调用。 */
  async initialize(): Promise<void> {
    const metadata = (await this.session.getMetadata()) as JsonlSessionMetadata;
    this.cachedSessionId = metadata.id;
    this.cachedParentSessionPath = metadata.parentSessionPath;
    await this.restoreActiveToolsFromBranch();

    await this.rebuildHarness();
    await this.rebuildCachedMessages();
  }

  // ---------- 属性 ----------

  get model(): Model<Api> | undefined {
    return this.harness?.getModel();
  }

  get thinkingLevel(): ThinkingLevel {
    const raw = this.harness?.getThinkingLevel();
    if (!raw || raw === 'xhigh') return 'high';
    return raw as ThinkingLevel;
  }

  get isStreaming(): boolean {
    return this._isStreaming;
  }

  get sessionId(): string {
    return this.cachedSessionId ?? '';
  }

  get parentSessionPath(): string | undefined {
    return this.cachedParentSessionPath;
  }

  get leafId(): string | null {
    return this.cachedLeafId ?? null;
  }

  // ---------- 运行时操作 ----------

  async prompt(text: string, options?: { images?: ImageContent[] }): Promise<void> {
    if (!this.harness) return;

    this.retryAttempt = 0;

    try {
      this._isStreaming = true;
      this.emit({ type: 'state_change' });
      if (options) {
        await this.harness.prompt(text, options);
      } else {
        await this.harness.prompt(text);
      }
      await this.runPostAgentLoop();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[scout] Prompt error: ${errorMessage}`);
      this._isStreaming = false;
      this.emit({ type: 'error', message: errorMessage });
    }
  }

  async abort(): Promise<void> {
    if (!this.harness) return;
    try {
      this.retryAbortController?.abort();
      this.manualCompactionAbortController?.abort();
      this.autoCompactionAbortController?.abort();
      await this.harness.abort();
    } catch (error) {
      this.outputChannel.appendLine(
        `[scout] Abort error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 用户手动续写：沿用底层 harness continuation 语义。 */
  async continue(): Promise<void> {
    if (!this.harness) return;

    this.retryAttempt = 0;

    try {
      this._isStreaming = true;
      this.emit({ type: 'state_change' });
      await this.harness.continue();
      await this.runPostAgentLoop();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[scout] Continue error: ${errorMessage}`);
      this._isStreaming = false;
      this.emit({ type: 'error', message: errorMessage });
    }
  }

  /** 获取当前上下文 token 用量估算（基于当前 session context） */
  async getContextUsage(): Promise<ScoutContextUsage | undefined> {
    if (!this.harness) return undefined;

    const model = this.harness.getModel();
    const contextWindow = model.contextWindow ?? 0;
    if (contextWindow <= 0) return undefined;

    const branch = await this.session.getBranch();
    const latestCompaction = getLatestCompactionEntry(branch);
    if (latestCompaction && !hasPostCompactionAssistantUsage(branch, latestCompaction)) {
      return { tokens: null, contextWindow, percent: null };
    }

    const estimate = await this.harness.getContextUsage();
    const percent = (estimate.tokens / contextWindow) * 100;
    return {
      tokens: estimate.tokens,
      contextWindow,
      percent,
    };
  }

  async setModel(modelId: string): Promise<void> {
    if (!this.harness) return;
    const model = this.configManager.findModel(modelId);
    if (model) {
      try {
        await this.harness.setModel(model);
        this.emit({ type: 'state_change' });
      } catch (error) {
        this.outputChannel.appendLine(
          `[scout] Model select error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    if (!this.harness) return;
    try {
      await this.harness.setThinkingLevel(level);
      this.emit({ type: 'state_change' });
    } catch (error) {
      this.outputChannel.appendLine(
        `[scout] Thinking level select error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async compact(): Promise<void> {
    if (!this.harness) return;
    if (this.manualCompactionAbortController) {
      this.outputChannel.appendLine(
        '[scout] Manual compaction already running, ignoring duplicate request',
      );
      return;
    }
    const abortController = new AbortController();
    this.manualCompactionAbortController = abortController;
    this.emit({ type: 'compaction_start', reason: 'manual' });
    try {
      this.outputChannel.appendLine('[scout] Running manual compaction');
      const result = await this.harness.compact(undefined, {
        signal: abortController.signal,
        settings: this.configManager.getCompactionSettings(),
      });
      await this.rebuildCachedMessages();
      this.emit({
        type: 'compaction_end',
        reason: 'manual',
        result,
        aborted: false,
        willRetry: false,
      });
      this.emit({ type: 'state_change' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const aborted = abortController.signal.aborted;
      this.outputChannel.appendLine(`[scout] Compaction failed: ${errorMessage}`);
      this.emit({
        type: 'compaction_end',
        reason: 'manual',
        aborted,
        willRetry: false,
        errorMessage: aborted ? undefined : `Manual compaction failed: ${errorMessage}`,
      });
    } finally {
      if (this.manualCompactionAbortController === abortController) {
        this.manualCompactionAbortController = undefined;
      }
    }
  }

  async abortRetry(): Promise<void> {
    this.retryAbortController?.abort();
  }

  async sendUserMessage(
    content: string | (TextContent | ImageContent)[],
    options?: SendUserMessageOptions,
  ): Promise<void> {
    if (!this.harness) return;

    const { text, images } = this.normalizeUserMessageContent(content);
    if (!this._isStreaming) {
      await this.prompt(text, images ? { images } : undefined);
      return;
    }

    if (!options?.deliverAs) {
      throw new Error('sendUserMessage while streaming requires deliverAs: "steer" or "followUp"');
    }

    if (options?.deliverAs === 'steer') {
      if (images) {
        await this.harness.steer(text, { images });
      } else {
        await this.harness.steer(text);
      }
      return;
    }
    if (options?.deliverAs === 'followUp') {
      if (images) {
        await this.harness.followUp(text, { images });
      } else {
        await this.harness.followUp(text);
      }
      return;
    }
    await this.prompt(text, images ? { images } : undefined);
  }

  async sendMessage<TDetails = unknown>(message: SendMessageInput<TDetails>): Promise<void> {
    const payload =
      typeof message === 'string'
        ? { customType: EXTENSION_MESSAGE_CUSTOM_TYPE, content: message, display: true }
        : message;
    await this.session.appendCustomMessageEntry(
      payload.customType,
      payload.content,
      payload.display ?? true,
      payload.details,
    );
    this.emit({ type: 'state_change' });
  }

  getActiveToolNames(): string[] {
    return [...this.activeToolNames];
  }

  async getSessionMetadata(): Promise<JsonlSessionMetadata> {
    return (await this.session.getMetadata()) as JsonlSessionMetadata;
  }

  getAllToolInfos(): ToolInfo[] {
    return [...this.toolRegistry.values()].map((entry) => ({
      name: entry.definition.name,
      label: entry.definition.label,
      description: entry.definition.description,
      parameters: entry.definition.parameters,
      sourceInfo: entry.sourceInfo,
    }));
  }

  async setActiveTools(toolNames: string[]): Promise<void> {
    const missing = toolNames.filter((name) => !this.toolRegistry.has(name));
    if (missing.length > 0) {
      throw new Error(`Unknown tool(s): ${missing.join(', ')}`);
    }

    this.activeToolsCustomized = true;
    this.activeToolNames = [...toolNames];
    await this.persistActiveTools();
    await this.applyToolsToHarness();
    this.lastSystemPrompt = this.buildCurrentSystemPrompt();
    this.emit({ type: 'state_change' });
    this.emit({ type: 'tree_change' });
  }

  async refreshTools(): Promise<void> {
    this.rebuildToolRegistry();
    this.normalizeActiveToolNames();
    await this.applyToolsToHarness();
    this.lastSystemPrompt = this.buildCurrentSystemPrompt();
    this.emit({ type: 'state_change' });
  }

  private async restoreActiveToolsFromBranch(): Promise<void> {
    if (this.activeToolsCustomized) return;

    const branch = await this.session.getBranch();
    let savedTools: string[] | undefined;
    for (const entry of branch) {
      if (entry.type !== 'custom' || entry.customType !== ACTIVE_TOOLS_CUSTOM_TYPE) {
        continue;
      }
      const data = entry.data as ActiveToolsState | undefined;
      if (Array.isArray(data?.enabledTools)) {
        savedTools = data.enabledTools.filter((name): name is string => typeof name === 'string');
      }
    }

    if (!savedTools) return;
    this.activeToolsCustomized = true;
    this.activeToolNames = savedTools;
  }

  private async persistActiveTools(): Promise<void> {
    await this.session.appendCustomEntry(ACTIVE_TOOLS_CUSTOM_TYPE, {
      enabledTools: [...this.activeToolNames],
    } satisfies ActiveToolsState);
    this.cachedLeafId = await this.session.getLeafId();
  }

  getSystemPrompt(): string {
    if (!this.lastSystemPrompt) {
      this.lastSystemPrompt = this.buildCurrentSystemPrompt();
    }
    return this.lastSystemPrompt;
  }

  hasPendingMessages(): boolean {
    return this.harness?.hasPendingMessages() ?? false;
  }

  getAbortSignal(): AbortSignal | undefined {
    return this.harness?.getSignal();
  }

  async emitSessionBeforeFork(entryId: string, position: 'before' | 'at'): Promise<boolean> {
    if (!this.extensionRunner?.hasHandlers('session_before_fork')) return false;
    const result = await this.extensionRunner.emitSessionBeforeFork({
      type: 'session_before_fork',
      entryId,
      position,
    });
    return result?.cancel === true;
  }

  async emitSessionBeforeSwitch(
    reason: 'new' | 'resume',
    targetSessionFile?: string,
  ): Promise<boolean> {
    if (!this.extensionRunner?.hasHandlers('session_before_switch')) return false;
    const result = await this.extensionRunner.emitSessionBeforeSwitch({
      type: 'session_before_switch',
      reason,
      targetSessionFile,
    });
    return result?.cancel === true;
  }

  async emitSessionShutdown(event: SessionShutdownEvent): Promise<void> {
    if (!this.extensionRunner?.hasHandlers('session_shutdown')) return;
    await this.extensionRunner.emitSessionShutdown(event);
  }

  async emitSessionStart(event: SessionStartEvent): Promise<void> {
    if (!this.extensionRunner?.hasHandlers('session_start')) return;
    await this.extensionRunner.emitSessionStart(event);
  }

  /** 设置扩展 runner 并重新桥接钩子。 */
  setExtensionRunner(runner: ScoutExtensionRunner): void {
    this.extensionRunner = runner;
    this.refreshTools().catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[scout] Refresh tools failed: ${errorMessage}`);
      this.emit({ type: 'error', message: `Refresh tools failed: ${errorMessage}` });
    });
    // 重新桥接扩展钩子到当前 harness
    this.unsubscribeExtensionHooks?.();
    this.unsubscribeExtensionHooks = this.bridgeExtensionHooks();
  }

  // ---------- Session Tree / Navigation / Label ----------

  /** 从 session.getEntries() 构建可序列化树 */
  async getTree(): Promise<ScoutSessionTreeNode[]> {
    const entries = await this.session.getEntries();

    // 从 LabelEntry 构建 label 映射（最后 label 胜出）
    const labelMap = new Map<string, string>();
    for (const entry of entries) {
      if (entry.type === 'label') {
        const labelEntry = entry as LabelEntry;
        if (labelEntry.label !== undefined) {
          labelMap.set(labelEntry.targetId, labelEntry.label);
        } else {
          labelMap.delete(labelEntry.targetId);
        }
      }
    }

    // 创建节点（跳过 label/leaf 等元数据 entry）
    const nodeMap = new Map<string, ScoutSessionTreeNode>();
    const roots: ScoutSessionTreeNode[] = [];

    for (const entry of entries) {
      if (entry.type === 'label' || entry.type === 'leaf') continue;

      const node: ScoutSessionTreeNode = {
        id: entry.id,
        parentId: entry.parentId,
        timestamp: entry.timestamp,
        type: entry.type,
        label: labelMap.get(entry.id),
        preview: extractPreview(entry),
        children: [],
      };
      nodeMap.set(entry.id, node);
    }

    // 构建父子关系
    for (const [, node] of nodeMap) {
      if (node.parentId === null || node.parentId === node.id) {
        roots.push(node);
      } else {
        const parent = nodeMap.get(node.parentId);
        if (parent) {
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      }
    }

    // 按 timestamp 排序 children（oldest first）
    const stack = [...roots];
    while (stack.length > 0) {
      const node = stack.pop()!;
      node.children.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
      stack.push(...node.children);
    }

    return roots;
  }

  /** 导航到指定 entry */
  async navigateTree(
    targetId: string,
    options?: { summarize?: boolean; customInstructions?: string; label?: string },
  ): Promise<NavigateTreeResult> {
    if (!this.harness) {
      this.emit({ type: 'error', message: 'No active harness for tree navigation' });
      return { cancelled: true };
    }

    try {
      const result = await this.harness.navigateTree(targetId, options);
      if (!result.cancelled) {
        await this.rebuildCachedMessages();
        this.emit({ type: 'state_change' });
        this.emit({ type: 'tree_change' });
      }
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[scout] Navigate tree failed: ${errorMessage}`);
      this.emit({ type: 'error', message: `Navigate tree failed: ${errorMessage}` });
      return { cancelled: true };
    }
  }

  /** 设置/清除 entry 标签 */
  async setLabel(entryId: string, label?: string): Promise<void> {
    try {
      await this.session.appendLabel(entryId, label);
      this.emit({ type: 'tree_change' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[scout] Set label failed: ${errorMessage}`);
      this.emit({ type: 'error', message: `Set label failed: ${errorMessage}` });
    }
  }

  // ---------- 消息访问（单一来源） ----------

  getScoutMessages(): ScoutMessage[] {
    return this.cachedMessages;
  }

  createReplacedSessionContext(): ReplacedSessionContext {
    if (!this.extensionRunner) {
      throw new Error('No extension runner is available for the replacement session');
    }
    const context = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(this.extensionRunner.createContext()),
    ) as ReplacedSessionContext;
    context.sendMessage = (message) => this.sendMessage(message);
    context.sendUserMessage = (content, options) => this.sendUserMessage(content, options);
    return context;
  }

  // ---------- 事件订阅 ----------

  subscribe(listener: (event: ScoutSessionEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  // ---------- 生命周期 ----------

  dispose(): void {
    this.extensionRunner?.invalidate();
    this.unsubscribeExtensionHooks?.();
    this.extensionRunner = undefined;
    this.unsubscribeHarness?.();
    this.harness = undefined;
    this._isStreaming = false;
    this.listeners.length = 0;
  }

  // ---------- 内部：事件发射 ----------

  private emit(event: ScoutSessionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  // ---------- 内部：消息缓存 ----------

  /** 从 session.buildContext() 重建缓存，附加 entryId */
  private async rebuildCachedMessages(): Promise<void> {
    try {
      const context: SessionContext = await this.session.buildContext();
      const branch: SessionTreeEntry[] = await this.session.getBranch();

      // 建立 AgentMessage → entryId 映射（基于对象引用同一性）
      const entryIdByMessage = new Map<AgentMessage, string>();
      for (const entry of branch) {
        if (entry.type === 'message') {
          entryIdByMessage.set((entry as MessageEntry).message, entry.id);
        }
      }

      this.cachedMessages = context.messages
        .map((msg) => {
          const scoutMsg = convertMessage(msg);
          if (scoutMsg) {
            scoutMsg.entryId = entryIdByMessage.get(msg);
          }
          return scoutMsg;
        })
        .filter((m): m is ScoutMessage => m !== null);

      this.cachedLeafId = await this.session.getLeafId();
    } catch (error) {
      this.outputChannel.appendLine(
        `[scout] rebuildCachedMessages failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.cachedMessages = [];
    }
  }

  // ---------- 内部：Harness 构建 ----------

  private rebuildToolRegistry(modelOverride?: Model<Api>): void {
    const model =
      modelOverride ?? this.harness?.getModel() ?? this.configManager.findDefaultModel();
    const readOptions = { isVisionModel: () => model?.input.includes('image') ?? false };
    const builtinEntries = createBuiltinToolDefinitionEntries(
      this.cwd,
      Array.from(ALL_TOOL_NAMES),
      { read: readOptions },
    );
    const builtinTools = createTools(this.cwd, Array.from(ALL_TOOL_NAMES), { read: readOptions });
    const builtinToolsByName = new Map(builtinTools.map((tool) => [tool.name, tool]));
    const registry = new Map<string, ToolRegistryEntry>();

    for (const entry of builtinEntries) {
      const tool = builtinToolsByName.get(entry.definition.name);
      if (!tool) {
        continue;
      }
      registry.set(entry.definition.name, {
        definition: entry.definition,
        tool,
        sourceInfo: entry.sourceInfo,
        sourceType: 'builtin',
      });
    }

    if (this.extensionRunner) {
      const registeredTools = this.extensionRunner.getAllRegisteredTools();
      const extensionTools = wrapRegisteredTools(registeredTools, this.extensionRunner);
      for (let i = 0; i < extensionTools.length; i++) {
        const tool = extensionTools[i]!;
        const registered = registeredTools[i]!;
        registry.set(tool.name, {
          definition: registered.definition,
          tool,
          sourceInfo: registered.sourceInfo,
          sourceType: 'extension',
        });
      }
    }

    this.toolRegistry = registry;
  }

  private normalizeActiveToolNames(): void {
    if (!this.activeToolsCustomized) {
      const defaults = DEFAULT_ACTIVE_TOOL_NAMES.filter((name) => this.toolRegistry.has(name));
      const extensionTools = [...this.toolRegistry.values()]
        .filter((entry) => entry.sourceType === 'extension')
        .map((entry) => entry.tool.name);
      this.activeToolNames = [...new Set([...defaults, ...extensionTools])];
      return;
    }

    this.activeToolNames = this.activeToolNames.filter((name) => this.toolRegistry.has(name));
  }

  private getActiveTools(): AgentTool[] {
    return this.activeToolNames
      .map((name) => this.toolRegistry.get(name)?.tool)
      .filter((tool): tool is AgentTool => tool !== undefined);
  }

  private getAllTools(): AgentTool[] {
    return [...this.toolRegistry.values()].map((entry) => entry.tool);
  }

  private async applyToolsToHarness(): Promise<void> {
    if (!this.harness) return;
    await this.harness.setTools(this.getAllTools(), this.activeToolNames);
  }

  private buildCurrentSystemPrompt(): string {
    return this.buildDynamicSystemPrompt(this.getActiveTools());
  }

  private normalizeUserMessageContent(content: string | (TextContent | ImageContent)[]): {
    text: string;
    images?: ImageContent[];
  } {
    if (typeof content === 'string') {
      return { text: content };
    }

    const textParts: string[] = [];
    const images: ImageContent[] = [];
    for (const part of content) {
      if (part.type === 'text') {
        textParts.push(part.text);
      } else {
        images.push(part);
      }
    }

    return {
      text: textParts.join('\n'),
      images: images.length > 0 ? images : undefined,
    };
  }

  /** 重建 AgentHarness（initialize/fork 复用） */
  private async rebuildHarness(): Promise<void> {
    const context = await this.session.buildContext();
    let model: Model<Api> | undefined;
    if (context.model) {
      model = this.configManager.findModel(context.model.modelId);
    }
    if (!model) {
      model = this.configManager.findDefaultModel();
    }
    if (!model) {
      this.emit({ type: 'error', message: 'No model available.' });
      return;
    }

    const thinkingLevel =
      (context.thinkingLevel as ThinkingLevel) ??
      this.configManager.getDefaultThinkingLevel() ??
      'off';
    const env = new NodeExecutionEnv({
      cwd: this.cwd,
      shellPath: this.configManager.getShellPath(),
    });
    this.rebuildToolRegistry(model);
    this.normalizeActiveToolNames();
    const tools = this.getAllTools();

    const harnessOptions: AgentHarnessOptions = {
      env: env as ExecutionEnv,
      session: this.session,
      tools,
      activeToolNames: this.activeToolNames,
      model,
      thinkingLevel,
      resources: { skills: this.skills as Skill[] },
      systemPrompt: (ctx) => {
        this.lastSystemPrompt = this.buildDynamicSystemPrompt(ctx.activeTools as typeof tools);
        return this.lastSystemPrompt;
      },
      getApiKeyAndHeaders: (m: Model<Api>) => this.getApiKeyAndHeaders(m),
      streamOptions: this.configManager.getStreamOptions(),
      steeringMode: this.configManager.getSteeringMode(),
      followUpMode: this.configManager.getFollowUpMode(),
    };

    const { AgentHarness: AgentHarnessClass } = await import('@scout-agent/agent');
    this.harness = new AgentHarnessClass(harnessOptions);
    this.lastSystemPrompt = this.buildCurrentSystemPrompt();
    this.unsubscribeHarness = this.subscribeToHarness();

    // 桥接扩展钩子到 Harness
    this.unsubscribeExtensionHooks?.();
    this.unsubscribeExtensionHooks = this.bridgeExtensionHooks();
  }

  // ---------- 内部：事件处理 ----------

  private subscribeToHarness(): () => void {
    if (!this.harness) return () => {};
    return this.harness.subscribe((event: AgentHarnessEvent) => this.handleHarnessEvent(event));
  }

  private async handleHarnessEvent(event: AgentHarnessEvent): Promise<void> {
    const enrichedEvent = this.enrichAgentEndEvent(event);

    await this.emitExtensionLifecycleEvent(enrichedEvent);

    // 映射为 ScoutAgentEvent（仅 AgentEvent 子集可映射）
    if (isAgentEvent(enrichedEvent)) {
      const scoutEvent = mapAgentEventToScout(enrichedEvent);
      if (scoutEvent) {
        this.emit({ type: 'agent_event', event: scoutEvent });
      }
    }

    const type = (enrichedEvent as { type: string }).type;

    // message_start（用户消息到达）：重置 overflow 防重入标志
    if (type === 'message_start') {
      const msg = (enrichedEvent as { message?: AgentMessage }).message;
      if (msg?.role === 'user') {
        this.overflowRecoveryAttempted = false;
      }
    }

    // settled：harness 空闲；若还有 agent_end 后处理，Session 仍保持 busy。
    if (type === 'settled') {
      if (!this.isPostAgentProcessing && !this.lastAssistantMessage) {
        this._isStreaming = false;
      }
      this.emit({ type: 'state_change' });
    }

    // 关键节点：推送 state_change；仅 agent_end 后重建消息缓存（消息树稳定）
    if (type === 'agent_start' || type === 'model_select' || type === 'thinking_level_select') {
      this.emit({ type: 'state_change' });
    }

    if (type === 'thinking_level_select') {
      const level = (enrichedEvent as { level: ThinkingLevel }).level;
      this.emit({ type: 'thinking_level_changed', level });
    }

    if (type === 'message_end' || type === 'turn_end') {
      // 仅推送 state_change，供 UI 实时感知；消息缓存延迟到 agent_end 才重建
      this.emit({ type: 'state_change' });
    }

    // message_end：只记录最后一条 assistant message，实际 retry/compaction 等到 agent_end 后处理。
    // 此时消息已经由 harness 持久化；这里只做观察和状态更新，避免重入 harness。
    if (type === 'message_end') {
      const message = (enrichedEvent as { message?: AgentMessage }).message;
      if (message?.role === 'assistant') {
        this.lastAssistantMessage = message as AssistantMessage;
      }
    }

    if (type === 'agent_end') {
      // agent_end 后消息树稳定，统一重建缓存
      await this.rebuildCachedMessages();
      this.emit({ type: 'state_change' });
    }

    // Compaction 事件
    if (type === 'session_compact') {
      await this.rebuildCachedMessages();
      this.emit({ type: 'state_change' });
    }

    // Session Tree 事件（navigateTree 产生）
    if (type === 'session_tree') {
      await this.rebuildCachedMessages();
      this.emit({ type: 'state_change' });
      this.emit({ type: 'tree_change' });
    }
  }

  private enrichAgentEndEvent(event: AgentHarnessEvent): AgentHarnessEvent {
    if ((event as { type: string }).type !== 'agent_end') return event;
    const agentEnd = event as Extract<AgentEvent, { type: 'agent_end' }>;
    return {
      ...agentEnd,
      willRetry: this.willRetryAfterAgentEnd(agentEnd),
    } as AgentHarnessEvent;
  }

  private willRetryAfterAgentEnd(event: Extract<AgentEvent, { type: 'agent_end' }>): boolean {
    const settings = this.configManager.getRetrySettings();
    if (!settings.enabled || this.retryAttempt >= settings.maxRetries) return false;

    const messages = (event as { messages?: AgentMessage[] }).messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message?.role === 'assistant') return this.isRetryableError(message as AssistantMessage);
    }

    return this.lastAssistantMessage ? this.isRetryableError(this.lastAssistantMessage) : false;
  }

  private async emitExtensionLifecycleEvent(event: AgentHarnessEvent): Promise<void> {
    if (!this.extensionRunner) return;
    const runner = this.extensionRunner;
    const type = (event as { type: string }).type;

    if (type === 'agent_start') {
      await runner.emit({ type: 'agent_start' });
    } else if (type === 'agent_end') {
      await runner.emit({
        type: 'agent_end',
        messages: (event as { messages: AgentMessage[] }).messages,
        willRetry: (event as { willRetry?: boolean }).willRetry ?? false,
      });
    } else if (type === 'turn_start') {
      await runner.emit({ type: 'turn_start', timestamp: Date.now() });
    } else if (type === 'turn_end') {
      const turnEnd = event as { message: AgentMessage; toolResults: AgentMessage[] };
      await runner.emit({
        type: 'turn_end',
        message: turnEnd.message,
        toolResults: turnEnd.toolResults,
      });
    } else if (type === 'message_start') {
      await runner.emit({
        type: 'message_start',
        message: (event as { message: AgentMessage }).message,
      });
    } else if (type === 'message_update') {
      const messageUpdate = event as { message: AgentMessage; assistantMessageEvent: any };
      await runner.emit({
        type: 'message_update',
        message: messageUpdate.message,
        assistantMessageEvent: messageUpdate.assistantMessageEvent,
      });
    } else if (type === 'tool_execution_start') {
      const toolEvent = event as { toolCallId: string; toolName: string; args: unknown };
      await runner.emit({
        type: 'tool_execution_start',
        toolCallId: toolEvent.toolCallId,
        toolName: toolEvent.toolName,
        args: toolEvent.args,
      });
    } else if (type === 'tool_execution_update') {
      const toolEvent = event as {
        toolCallId: string;
        toolName: string;
        args: unknown;
        partialResult: unknown;
      };
      await runner.emit({
        type: 'tool_execution_update',
        toolCallId: toolEvent.toolCallId,
        toolName: toolEvent.toolName,
        args: toolEvent.args,
        partialResult: toolEvent.partialResult,
      });
    } else if (type === 'tool_execution_end') {
      const toolEvent = event as {
        toolCallId: string;
        toolName: string;
        result: unknown;
        isError: boolean;
      };
      await runner.emit({
        type: 'tool_execution_end',
        toolCallId: toolEvent.toolCallId,
        toolName: toolEvent.toolName,
        result: toolEvent.result,
        isError: toolEvent.isError,
      });
    } else if (type === 'after_provider_response') {
      const providerEvent = event as { status: number; headers: Record<string, string> };
      await runner.emitAfterProviderResponse({
        type: 'after_provider_response',
        status: providerEvent.status,
        headers: providerEvent.headers,
      });
    } else if (type === 'session_compact') {
      const compactEvent = event as { compactionEntry: CompactionEntry; fromHook: boolean };
      await runner.emit({
        type: 'session_compact',
        compactionEntry: compactEvent.compactionEntry,
        fromHook: compactEvent.fromHook,
        fromExtension: compactEvent.fromHook,
      });
    } else if (type === 'session_tree') {
      const treeEvent = event as {
        newLeafId: string | null;
        oldLeafId: string | null;
        summaryEntry?: BranchSummaryEntry;
        fromHook?: boolean;
      };
      await runner.emit({
        type: 'session_tree',
        newLeafId: treeEvent.newLeafId,
        oldLeafId: treeEvent.oldLeafId,
        summaryEntry: treeEvent.summaryEntry,
        fromHook: treeEvent.fromHook,
        fromExtension: treeEvent.fromHook,
      });
    } else if (type === 'model_select') {
      await runner.emit(event as Parameters<typeof runner.emit>[0] & { type: 'model_select' });
    } else if (type === 'thinking_level_select') {
      await runner.emit(
        event as Parameters<typeof runner.emit>[0] & { type: 'thinking_level_select' },
      );
    }
  }

  // ---------- 内部：Compaction ----------

  private async checkCompaction(assistantMessage: AssistantMessage): Promise<boolean> {
    if (!this.harness) return false;
    const settings = this.configManager.getCompactionSettings();
    if (!settings.enabled) return false;

    const model = this.harness.getModel();
    const contextWindow = model.contextWindow;
    if (!contextWindow) return false;

    // 问题 A：compaction 边界检查。
    // 若 assistant message 时间戳早于最近一次 compaction，跳过检查：
    // compaction 刚完成后第一轮的消息持有的 usage 反映旧的（更大的）context，
    // 不应触发再次 compaction。
    const branch = await this.session.getBranch();
    const latestCompaction = getLatestCompactionEntry(branch);
    if (latestCompaction !== null) {
      const compactionTime = new Date(latestCompaction.timestamp).getTime();
      if (assistantMessage.timestamp <= compactionTime) {
        return false;
      }
    }

    // 问题 B：error message 下无 usage 数据，需要从消息历史估算 token 数。
    // （error message 的 usage 字段全为零，calculateContextTokens 会返回 0）
    let contextTokens: number;
    if (assistantMessage.stopReason === 'error') {
      const context = await this.session.buildContext();
      const estimate = estimateContextTokens(context.messages);
      // 无任何 usage 数据时无法判断，跳过
      if (estimate.lastUsageIndex === null) return false;
      // 验证 usage source 在最近 compaction 之后（防止 compaction 后误触发）
      if (latestCompaction !== null) {
        const usageMsg = context.messages[estimate.lastUsageIndex] as AssistantMessage | undefined;
        if (usageMsg && usageMsg.timestamp <= new Date(latestCompaction.timestamp).getTime()) {
          return false;
        }
      }
      contextTokens = estimate.tokens;
    } else {
      contextTokens = calculateContextTokens(assistantMessage.usage);
    }

    if (shouldCompact(contextTokens, contextWindow, settings)) {
      return await this.runAutoCompaction('threshold');
    }
    return false;
  }

  /**
   * agent_end 后统一处理 retry / compaction 决策。
   * 对齐 Pi 的 _handlePostAgentRun() 模式：
   *   1. 若 retry 触发 → 直接 return（跳过 compaction，retry 成功后再判断）
   *   2. 若 retry 超限 → 发出 retry_end(success=false)，再做 compaction 检查
   *   3. 若 retry 成功 → 发出 retry_end(success=true)，再做 compaction 检查
   *   4. 无 retry → 直接做 compaction 检查
   */
  private async handlePostAgentEnd(): Promise<boolean> {
    const assistant = this.lastAssistantMessage;
    this.lastAssistantMessage = undefined;

    if (!assistant) return false;

    // Context overflow recovery must run after agent_end: the overflow message has been
    // persisted and the harness is idle, so removing it and compacting can succeed.
    if (this.isContextOverflowError(assistant)) {
      if (this.overflowRecoveryAttempted) {
        // 已尝试过一次 compact-and-retry 仍然 overflow，停止重试防止无限循环
        this.outputChannel.appendLine(
          '[scout] Overflow recovery failed after one attempt, stopping retry',
        );
        this.emit({
          type: 'compaction_end',
          reason: 'overflow',
          aborted: false,
          willRetry: false,
          errorMessage:
            'Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.',
        });
        return false;
      }
      this.overflowRecoveryAttempted = true;
      // 移除 error message（不应留在 context 中）
      await this.removeLastAssistantMessage();
      return await this.runAutoCompaction('overflow', true);
    }

    // Auto Retry
    if (this.isRetryableError(assistant)) {
      if (await this.prepareRetry(assistant)) {
        return true; // 问题 E fix：retry 触发后跳过 compaction
      }
      // 超过最大重试次数
      this.emitAutoRetryEnd(false, this.retryAttempt, assistant.errorMessage);
      this.retryAttempt = 0;
      // 超限后仍需做 compaction 检查（继续往下执行）
    } else if (assistant.stopReason !== 'error' && this.retryAttempt > 0) {
      // 问题 F fix：retry 成功时先发送 retry_end，再做 compaction 检查
      this.emitAutoRetryEnd(true, this.retryAttempt);
      this.retryAttempt = 0;
      // 成功后继续做 compaction 检查（继续往下执行）
    }

    // 阈值压缩检查（非 retry 触发时执行）
    return await this.checkCompaction(assistant);
  }

  private async runPostAgentLoop(): Promise<void> {
    if (!this.lastAssistantMessage) {
      this._isStreaming = false;
      this.emit({ type: 'state_change' });
      return;
    }

    this.isPostAgentProcessing = true;
    this._isStreaming = true;
    this.emit({ type: 'state_change' });

    try {
      while (await this.handlePostAgentEnd()) {
        if (!this.harness) return;
        try {
          this._isStreaming = true;
          this.emit({ type: 'state_change' });
          await this.harness.continue();
        } catch (error) {
          this.outputChannel.appendLine(
            `[scout] Continue error: ${error instanceof Error ? error.message : String(error)}`,
          );
          this.emit({
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
          return;
        }
      }
    } finally {
      this.isPostAgentProcessing = false;
      this._isStreaming = false;
      this.emit({ type: 'state_change' });
    }
  }

  private async runAutoCompaction(
    reason: ScoutCompactionReason,
    willRetry = false,
  ): Promise<boolean> {
    if (!this.harness) return false;
    const abortController = new AbortController();
    this.autoCompactionAbortController = abortController;
    this.emit({ type: 'compaction_start', reason });
    try {
      this.outputChannel.appendLine(`[scout] Running auto compaction: ${reason}`);
      const result = await this.harness.compact(undefined, {
        signal: abortController.signal,
        settings: this.configManager.getCompactionSettings(),
      });
      await this.rebuildCachedMessages();
      this.emit({
        type: 'compaction_end',
        reason,
        result,
        aborted: false,
        willRetry,
      });
      this.emit({ type: 'state_change' });

      if (willRetry) {
        this.outputChannel.appendLine('[scout] Retrying after overflow compaction');
        return true;
      }
      return this.harness.hasPendingMessages();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const aborted = abortController.signal.aborted;
      this.outputChannel.appendLine(`[scout] Compaction failed: ${errorMessage}`);
      this.emit({
        type: 'compaction_end',
        reason,
        aborted,
        willRetry: false,
        errorMessage: aborted
          ? undefined
          : reason === 'overflow'
            ? `Context overflow recovery failed: ${errorMessage}`
            : `Auto-compaction failed: ${errorMessage}`,
      });
      return false;
    } finally {
      if (this.autoCompactionAbortController === abortController) {
        this.autoCompactionAbortController = undefined;
      }
    }
  }

  // ---------- 内部：Auto Retry ----------

  private isRetryableError(message: AssistantMessage): boolean {
    if (message.stopReason !== 'error' || !message.errorMessage) return false;
    if (this.isContextOverflowError(message)) return false;
    if (NON_RETRYABLE_LIMIT_PATTERN.test(message.errorMessage)) return false;
    return RETRYABLE_ERROR_PATTERN.test(message.errorMessage);
  }

  private isContextOverflowError(message: AssistantMessage): boolean {
    if (isContextOverflow(message)) return true;

    const model = this.harness?.getModel();
    if (!model) return false;
    const sameModel = message.provider === model.provider && message.model === model.id;
    return sameModel && isContextOverflow(message, model.contextWindow);
  }

  private async prepareRetry(message: AssistantMessage): Promise<boolean> {
    const settings = this.configManager.getRetrySettings();
    if (!settings.enabled) return false;

    this.retryAttempt++;
    if (this.retryAttempt > settings.maxRetries) {
      this.retryAttempt--;
      return false;
    }

    const delayMs = settings.baseDelayMs * 2 ** (this.retryAttempt - 1);

    this.emitAutoRetryStart(
      this.retryAttempt,
      settings.maxRetries,
      delayMs,
      message.errorMessage ?? 'Unknown error',
    );

    await this.removeLastAssistantMessage();

    this.retryAbortController = new AbortController();
    try {
      await this.interruptibleSleep(delayMs, this.retryAbortController.signal);
    } catch {
      const attempt = this.retryAttempt;
      this.retryAttempt = 0;
      this.emitAutoRetryEnd(false, attempt, 'Retry cancelled');
      return false;
    } finally {
      this.retryAbortController = undefined;
    }

    return true;
  }

  private emitAutoRetryStart(
    attempt: number,
    maxAttempts: number,
    delayMs: number,
    errorMessage: string,
  ): void {
    this.emit({ type: 'auto_retry_start', attempt, maxAttempts, delayMs, errorMessage });
    this.emit({ type: 'retry_start', attempt, maxAttempts, delayMs, message: errorMessage });
  }

  private emitAutoRetryEnd(success: boolean, attempt: number, finalError?: string): void {
    this.emit({ type: 'auto_retry_end', success, attempt, finalError });
    this.emit({ type: 'retry_end', success, attempt, finalError });
  }

  /** 将 session leaf 回退到 error message 之前的 entry，等效移除 */
  private async removeLastAssistantMessage(): Promise<void> {
    const branch = await this.session.getBranch();
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i]!;
      if (
        entry.type === 'message' &&
        (entry as { message?: AgentMessage }).message?.role === 'assistant'
      ) {
        await this.session.moveTo(entry.parentId);
        return;
      }
    }
  }

  private interruptibleSleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Aborted'));
        return;
      }
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('Aborted'));
        },
        { once: true },
      );
    });
  }

  // ---------- 内部：扩展系统 ----------

  /** 将扩展钩子桥接到 AgentHarness.on() */
  private bridgeExtensionHooks(): () => void {
    if (!this.harness || !this.extensionRunner) return () => {};

    const runner = this.extensionRunner;
    const unsubs: Array<() => void> = [];

    unsubs.push(this.harness.on('before_agent_start', (e) => runner.emitBeforeAgentStart(e)));
    unsubs.push(
      this.harness.on('context', async (e) => {
        const messages = await runner.emitContext(e.messages);
        return { messages };
      }),
    );
    unsubs.push(
      this.harness.on('before_provider_request', (e) =>
        runner.emitBeforeProviderStreamOptions({
          type: 'before_provider_stream_options',
          streamOptions: e.streamOptions,
        }),
      ),
    );
    unsubs.push(
      this.harness.on('before_provider_payload', async (e) => ({
        payload: await runner.emitBeforeProviderPayload(e),
      })),
    );
    unsubs.push(this.harness.on('tool_call', (e) => runner.emitToolCall(e)));
    unsubs.push(this.harness.on('tool_result', (e) => runner.emitToolResult(e)));
    unsubs.push(
      this.harness.on('message_end', async (e) => {
        const message = await runner.emitMessageEnd({
          type: 'message_end',
          message: e.message,
        });
        return message ? { message } : undefined;
      }),
    );
    unsubs.push(
      this.harness.on('session_before_compact', (e) => runner.emitSessionBeforeCompact(e)),
    );
    unsubs.push(this.harness.on('session_before_tree', (e) => runner.emitSessionBeforeTree(e)));

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }

  // ---------- 内部：API Key / Auth ----------

  async getApiKeyAndHeaders(
    model: Model<Api>,
  ): Promise<{ apiKey: string; headers?: Record<string, string> } | undefined> {
    const apiKey = this.configManager.getApiKey(model.provider);
    if (!apiKey) return undefined;

    if (model.provider === 'anthropic') {
      return { apiKey, headers: { 'anthropic-version': '2023-06-01' } };
    }

    return { apiKey };
  }

  // ---------- 内部：系统提示构建 ----------

  private buildDynamicSystemPrompt(
    activeTools: Array<{
      name: string;
      description: string;
      promptSnippet?: string;
      promptGuidelines?: string[];
    }>,
  ): string {
    const toolSnippets: Record<string, string> = {};
    const toolGuidelines: string[] = [];

    for (const tool of activeTools) {
      if (tool.promptSnippet) {
        toolSnippets[tool.name] = tool.promptSnippet;
      } else {
        toolSnippets[tool.name] = tool.description;
      }
      if (tool.promptGuidelines) {
        toolGuidelines.push(...tool.promptGuidelines);
      }
    }

    return buildSystemPrompt({
      selectedTools: activeTools.map((t) => t.name),
      toolSnippets,
      promptGuidelines: toolGuidelines,
      cwd: this.cwd,
      skills: this.skills,
    });
  }
}

// ---------- 辅助函数 ----------

/** 从 branch entries 中找到最近的 CompactionEntry，不存在时返回 null */
function getLatestCompactionEntry(entries: SessionTreeEntry[]): CompactionEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].type === 'compaction') {
      return entries[i] as CompactionEntry;
    }
  }
  return null;
}

function hasPostCompactionAssistantUsage(
  entries: SessionTreeEntry[],
  compaction: CompactionEntry,
): boolean {
  const compactionIndex = entries.findIndex((entry) => entry.id === compaction.id);
  if (compactionIndex < 0) return false;

  for (let i = entries.length - 1; i > compactionIndex; i--) {
    const entry = entries[i];
    if (entry?.type !== 'message') continue;

    const message = (entry as MessageEntry).message;
    if (message.role !== 'assistant') continue;

    const assistant = message as AssistantMessage;
    if (assistant.stopReason === 'aborted' || assistant.stopReason === 'error') continue;
    if (assistant.usage && calculateContextTokens(assistant.usage) > 0) return true;
  }

  return false;
}

/** 从 entry 中提取预览文本（首行，截断到 80 字符） */
function extractPreview(entry: SessionTreeEntry): string | undefined {
  const MAX_PREVIEW = 80;

  if (entry.type === 'message') {
    const msgEntry = entry as MessageEntry;
    const msg = msgEntry.message as unknown as Record<string, unknown> | undefined;
    const content = msg?.['content'];
    if (typeof content === 'string') {
      const firstLine = content.split('\n')[0] ?? '';
      return firstLine.length > MAX_PREVIEW
        ? firstLine.slice(0, MAX_PREVIEW) + '…'
        : firstLine || undefined;
    }
    if (Array.isArray(content)) {
      const textBlock = content.find((b: Record<string, unknown>) => b['type'] === 'text');
      if (textBlock && typeof textBlock['text'] === 'string') {
        const firstLine = textBlock['text'].split('\n')[0] ?? '';
        return firstLine.length > MAX_PREVIEW
          ? firstLine.slice(0, MAX_PREVIEW) + '…'
          : firstLine || undefined;
      }
    }
    return undefined;
  }

  if (entry.type === 'branch_summary') {
    const bsEntry = entry as BranchSummaryEntry;
    const firstLine = bsEntry.summary?.split('\n')[0] ?? '';
    return firstLine.length > MAX_PREVIEW
      ? firstLine.slice(0, MAX_PREVIEW) + '…'
      : firstLine || undefined;
  }

  if (entry.type === 'compaction') {
    const cEntry = entry as CompactionEntry;
    const firstLine = cEntry.summary?.split('\n')[0] ?? '';
    return firstLine.length > MAX_PREVIEW
      ? firstLine.slice(0, MAX_PREVIEW) + '…'
      : firstLine || undefined;
  }

  return undefined;
}
