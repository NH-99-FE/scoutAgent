// ============================================================
// AgentSession — 单次会话的核心生命周期管理
// 负责：Harness 创建/销毁、事件处理、消息缓存（单一来源）、
//       Compaction、Auto Retry、Fork、Session Tree/Navigation/Label
// ============================================================

import * as vscode from 'vscode';
import type { Model, Api, AssistantMessage } from '@scout-agent/ai';
import type {
  AgentEvent,
  AgentHarness,
  AgentHarnessEvent,
  AgentHarnessOptions,
  AgentMessage,
  BranchSummaryEntry,
  CompactionEntry,
  ContextUsageEstimate,
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
import {
  shouldCompact,
  calculateContextTokens,
  estimateContextTokens,
  NodeExecutionEnv,
} from '@scout-agent/agent';
import type {
  ScoutAgentEvent,
  ScoutMessage,
  ScoutSessionTreeNode,
  ThinkingLevel,
} from '@scout-agent/shared';
import { ConfigManager } from './config-manager.ts';
import { buildSystemPrompt } from './system-prompt.ts';
import { createTools, DEFAULT_ACTIVE_TOOL_NAMES, type ToolName } from './tools/index.ts';
import { ScoutExtensionRunner, wrapRegisteredTools } from './extensions/index.ts';
import { mapAgentEventToScout, convertMessage } from './protocol/agent-event-mapper.ts';
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

// ---------- 事件类型（判别联合） ----------

export type ScoutSessionEvent =
  | { type: 'agent_event'; event: ScoutAgentEvent }
  | { type: 'state_change' }
  | { type: 'error'; message: string }
  | { type: 'retry_start'; attempt: number; maxAttempts: number; delayMs: number; message: string }
  | { type: 'retry_end'; success: boolean; attempt: number; finalError?: string }
  | { type: 'tree_change' };

// ---------- 构造选项 ----------

export interface AgentSessionOptions {
  session: Session;
  configManager: ConfigManager;
  cwd: string;
  outputChannel: vscode.OutputChannel;
  skills: ScoutSkill[];
  extensionRunner?: ScoutExtensionRunner;
  activeToolNames?: ToolName[];
}

// ---------- AgentSession ----------

export class AgentSession implements vscode.Disposable {
  private readonly session: Session;
  private readonly configManager: ConfigManager;
  private readonly cwd: string;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly skills: ScoutSkill[];
  private extensionRunner?: ScoutExtensionRunner;
  private activeToolNames: ToolName[];

  private harness?: AgentHarness;
  private unsubscribeHarness?: () => void;
  private unsubscribeExtensionHooks?: () => void;

  /** 流式状态：只有 harness.prompt() 开始到 settled 事件之间为 true */
  private _isStreaming = false;

  /** Retry 状态 */
  private retryAttempt = 0;
  private retryAbortController: AbortController | undefined;
  private lastUserMessageText = '';

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
  }

  // ---------- 初始化 ----------

  /** 初始化 harness + 缓存元数据 + 消息。由 SessionManager 构造后调用。 */
  async initialize(): Promise<void> {
    const metadata = (await this.session.getMetadata()) as JsonlSessionMetadata;
    this.cachedSessionId = metadata.id;
    this.cachedParentSessionPath = metadata.parentSessionPath;

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

  async prompt(text: string): Promise<void> {
    if (!this.harness) return;

    this.lastUserMessageText = text;
    this.retryAttempt = 0;

    try {
      this._isStreaming = true;
      this.emit({ type: 'state_change' });
      await this.harness.prompt(text);
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
      await this.harness.abort();
    } catch (error) {
      this.outputChannel.appendLine(
        `[scout] Abort error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 无新用户消息续约对话（等价 Pi AgentSession.continue()）。
   * Harness 层无独立 continue 接口，以固定续约提示触发。
   * 注意：不重置 lastUserMessageText，保留原用户消息供 Auto Retry 使用。
   */
  async continue(): Promise<void> {
    if (!this.harness) return;

    this.retryAttempt = 0;

    try {
      this._isStreaming = true;
      this.emit({ type: 'state_change' });
      await this.harness.prompt('Please continue.');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[scout] Continue error: ${errorMessage}`);
      this._isStreaming = false;
      this.emit({ type: 'error', message: errorMessage });
    }
  }

  /** 获取当前上下文 token 用量估算（harness 空闲时基于最近一轮消息快照） */
  getContextUsage(): ContextUsageEstimate | undefined {
    return this.harness?.getContextUsage();
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
    try {
      this.outputChannel.appendLine('[scout] Running auto compaction');
      await this.harness.compact();
      await this.rebuildCachedMessages();
      this.emit({ type: 'state_change' });
    } catch (error) {
      this.outputChannel.appendLine(
        `[scout] Compaction failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async abortRetry(): Promise<void> {
    this.retryAbortController?.abort();
  }

  // ---------- Fork ----------

  /**
   * 从当前 session 的指定 entry 处分叉，返回新的 AgentSession。
   * fork 后的 session 不携带 extensionRunner（由 SessionManager 重新绑定）。
   */
  async fork(
    sessionRepo: {
      fork: (
        meta: JsonlSessionMetadata,
        opts: { cwd: string; entryId: string; position: 'before' | 'at' },
      ) => Promise<Session>;
    },
    entryId: string,
    position: 'before' | 'at',
  ): Promise<AgentSession> {
    if (this._isStreaming) {
      await this.abort();
    }

    const sourceMetadata = (await this.session.getMetadata()) as JsonlSessionMetadata;
    const forkedSession = await sessionRepo.fork(sourceMetadata, {
      cwd: this.cwd,
      entryId,
      position,
    });

    // extensionRunner 不传入，由 SessionManager.fork() 重新创建后调用 setExtensionRunner()
    const forkedAgentSession = new AgentSession({
      session: forkedSession as Session,
      configManager: this.configManager,
      cwd: this.cwd,
      outputChannel: this.outputChannel,
      skills: this.skills,
      extensionRunner: undefined,
      activeToolNames: [...this.activeToolNames],
    });

    await forkedAgentSession.initialize();
    this.outputChannel.appendLine(`[scout] Forked session from entry ${entryId} (${position})`);
    return forkedAgentSession;
  }

  /**
   * 设置扩展 runner 并重新桥接钩子。
   * 由 SessionManager 在 fork() 后调用，为新 session 绑定独立 runner。
   */
  setExtensionRunner(runner: ScoutExtensionRunner): void {
    this.extensionRunner = runner;
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
    const builtinTools = createTools(this.cwd, this.activeToolNames, {
      read: { isVisionModel: () => model!.input.includes('image') },
    });

    // 合并扩展工具
    let tools = builtinTools;
    if (this.extensionRunner) {
      const extensionTools = wrapRegisteredTools(
        this.extensionRunner.getAllRegisteredTools(),
        this.extensionRunner,
      );
      // 扩展工具同名覆盖内置工具
      const toolMap = new Map(tools.map((t) => [t.name, t]));
      for (const extTool of extensionTools) {
        toolMap.set(extTool.name, extTool);
      }
      tools = Array.from(toolMap.values());
    }

    const harnessOptions: AgentHarnessOptions = {
      env: env as ExecutionEnv,
      session: this.session,
      tools,
      model,
      thinkingLevel,
      resources: { skills: this.skills as Skill[] },
      systemPrompt: (ctx) => this.buildDynamicSystemPrompt(ctx.activeTools as typeof tools),
      getApiKeyAndHeaders: (m: Model<Api>) => this.getApiKeyAndHeaders(m),
      streamOptions: { timeoutMs: 300000, maxRetries: 2 },
      steeringMode: this.configManager.getSteeringMode(),
      followUpMode: this.configManager.getFollowUpMode(),
    };

    const { AgentHarness: AgentHarnessClass } = await import('@scout-agent/agent');
    this.harness = new AgentHarnessClass(harnessOptions);
    this.unsubscribeHarness = this.subscribeToHarness();

    // 桥接扩展钩子到 Harness
    this.unsubscribeExtensionHooks?.();
    this.unsubscribeExtensionHooks = this.bridgeExtensionHooks();
  }

  // ---------- 内部：事件处理 ----------

  private subscribeToHarness(): () => void {
    if (!this.harness) return () => {};
    return this.harness.subscribe((event: AgentHarnessEvent) => {
      (() => {
        this.handleHarnessEvent(event);
      })();
    });
  }

  private async handleHarnessEvent(event: AgentHarnessEvent): Promise<void> {
    // 映射为 ScoutAgentEvent（仅 AgentEvent 子集可映射）
    if (isAgentEvent(event)) {
      const scoutEvent = mapAgentEventToScout(event);
      if (scoutEvent) {
        this.emit({ type: 'agent_event', event: scoutEvent });
      }
    }

    const type = (event as { type: string }).type;

    // message_start（用户消息到达）：重置 overflow 防重入标志
    if (type === 'message_start') {
      const msg = (event as { message?: AgentMessage }).message;
      if (msg?.role === 'user') {
        this.overflowRecoveryAttempted = false;
      }
    }

    // settled：harness 空闲，重置流式状态
    if (type === 'settled') {
      this._isStreaming = false;
      this.emit({ type: 'state_change' });
    }

    // 关键节点：推送 state_change；仅 agent_end 后重建消息缓存（消息树稳定）
    if (type === 'agent_start' || type === 'model_select' || type === 'thinking_level_select') {
      this.emit({ type: 'state_change' });
    }

    if (type === 'message_end' || type === 'turn_end') {
      // 仅推送 state_change，供 UI 实时感知；消息缓存延迟到 agent_end 才重建
      this.emit({ type: 'state_change' });
    }

    // message_end：记录最后一条 assistant message 供 agent_end 决策；处理溢出恢复（需立即重入 harness）
    if (type === 'message_end') {
      const message = (event as { message?: AgentMessage }).message;
      if (message?.role === 'assistant') {
        const assistant = message as AssistantMessage;

        // 溢出恢复在 message_end 立即处理（需在下一条用户消息前 compact-and-retry）
        if (assistant.errorMessage) {
          const errMsg = assistant.errorMessage.toLowerCase();
          if (errMsg.includes('context_length_exceeded') || errMsg.includes('context_window')) {
            if (this.overflowRecoveryAttempted) {
              // 已尝试过一次 compact-and-retry 仍然 overflow，停止重试防止无限循环
              this.outputChannel.appendLine(
                '[scout] Overflow recovery failed after one attempt, stopping retry',
              );
              return;
            }
            this.overflowRecoveryAttempted = true;
            // 移除 error message（不应留在 context 中）
            await this.removeLastAssistantMessage();
            await this.runAutoCompaction('overflow', true);
            return;
          }
        }

        // 记录最后一条 assistant message，供 agent_end 后的 retry/compaction 决策
        // 溢出情况已提前 return，此处只记录非溢出消息
        this.lastAssistantMessage = assistant;
      }
    }

    if (type === 'agent_end') {
      // agent_end 后消息树稳定，统一重建缓存
      await this.rebuildCachedMessages();
      this.emit({ type: 'state_change' });
      // 在消息树稳定后，集中处理 retry/compaction 决策（对齐 Pi _handlePostAgentRun 模式）
      await this.handlePostAgentEnd();
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

  // ---------- 内部：Compaction ----------

  private async checkCompaction(assistantMessage: AssistantMessage): Promise<void> {
    if (!this.harness) return;
    const settings = this.configManager.getCompactionSettings();
    if (!settings.enabled) return;

    const model = this.harness.getModel();
    const contextWindow = model.contextWindow;
    if (!contextWindow) return;

    // 问题 A：compaction 边界检查。
    // 若 assistant message 时间戳早于最近一次 compaction，跳过检查：
    // compaction 刚完成后第一轮的消息持有的 usage 反映旧的（更大的）context，
    // 不应触发再次 compaction。
    const branch = await this.session.getBranch();
    const latestCompaction = getLatestCompactionEntry(branch);
    if (latestCompaction !== null) {
      const compactionTime = new Date(latestCompaction.timestamp).getTime();
      if (assistantMessage.timestamp <= compactionTime) {
        return;
      }
    }

    // 问题 B：error message 下无 usage 数据，需要从消息历史估算 token 数。
    // （error message 的 usage 字段全为零，calculateContextTokens 会返回 0）
    let contextTokens: number;
    if (assistantMessage.stopReason === 'error') {
      const context = await this.session.buildContext();
      const estimate = estimateContextTokens(context.messages);
      // 无任何 usage 数据时无法判断，跳过
      if (estimate.lastUsageIndex === null) return;
      // 验证 usage source 在最近 compaction 之后（防止 compaction 后误触发）
      if (latestCompaction !== null) {
        const usageMsg = context.messages[estimate.lastUsageIndex] as AssistantMessage | undefined;
        if (usageMsg && usageMsg.timestamp <= new Date(latestCompaction.timestamp).getTime()) {
          return;
        }
      }
      contextTokens = estimate.tokens;
    } else {
      contextTokens = calculateContextTokens(assistantMessage.usage);
    }

    if (shouldCompact(contextTokens, contextWindow, settings)) {
      await this.runAutoCompaction('threshold');
    }
  }

  /**
   * agent_end 后统一处理 retry / compaction 决策。
   * 对齐 Pi 的 _handlePostAgentRun() 模式：
   *   1. 若 retry 触发 → 直接 return（跳过 compaction，retry 成功后再判断）
   *   2. 若 retry 超限 → 发出 retry_end(success=false)，再做 compaction 检查
   *   3. 若 retry 成功 → 发出 retry_end(success=true)，再做 compaction 检查
   *   4. 无 retry → 直接做 compaction 检查
   */
  private async handlePostAgentEnd(): Promise<void> {
    const assistant = this.lastAssistantMessage;
    this.lastAssistantMessage = undefined;

    if (!assistant) return;

    // Auto Retry
    if (this.isRetryableError(assistant)) {
      if (await this.prepareRetry(assistant)) {
        // retry 已调度，等待下一轮 agent_end 后再判断 compaction
        if (this.lastUserMessageText && this.harness) {
          try {
            this._isStreaming = true;
            await this.harness.prompt(this.lastUserMessageText);
          } catch (error) {
            this.outputChannel.appendLine(
              `[scout] Retry prompt error: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        return; // 问题 E fix：retry 触发后跳过 compaction
      }
      // 超过最大重试次数
      this.emit({
        type: 'retry_end',
        success: false,
        attempt: this.retryAttempt,
        finalError: assistant.errorMessage,
      });
      this.retryAttempt = 0;
      // 超限后仍需做 compaction 检查（继续往下执行）
    } else if (assistant.stopReason !== 'error' && this.retryAttempt > 0) {
      // 问题 F fix：retry 成功时先发送 retry_end，再做 compaction 检查
      this.emit({ type: 'retry_end', success: true, attempt: this.retryAttempt });
      this.retryAttempt = 0;
      // 成功后继续做 compaction 检查（继续往下执行）
    }

    // 阈值压缩检查（非 retry 触发时执行）
    await this.checkCompaction(assistant);
  }

  private async runAutoCompaction(reason: string, willRetry = false): Promise<void> {
    if (!this.harness) return;
    try {
      this.outputChannel.appendLine(`[scout] Running auto compaction: ${reason}`);
      await this.harness.compact();
      await this.rebuildCachedMessages();
      this.emit({ type: 'state_change' });

      if (willRetry) {
        this.outputChannel.appendLine('[scout] Retrying after overflow compaction');
        this._isStreaming = true;
        await this.harness.prompt('Please continue.');
      }
    } catch (error) {
      this.outputChannel.appendLine(
        `[scout] Compaction failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ---------- 内部：Auto Retry ----------

  private isRetryableError(message: AssistantMessage): boolean {
    if (message.stopReason !== 'error' || !message.errorMessage) return false;
    const errMsg = message.errorMessage.toLowerCase();
    if (errMsg.includes('context_length_exceeded') || errMsg.includes('context_window'))
      return false;
    if (NON_RETRYABLE_LIMIT_PATTERN.test(message.errorMessage)) return false;
    return RETRYABLE_ERROR_PATTERN.test(message.errorMessage);
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

    this.emit({
      type: 'retry_start',
      attempt: this.retryAttempt,
      maxAttempts: settings.maxRetries,
      delayMs,
      message: message.errorMessage ?? 'Unknown error',
    });

    await this.removeLastAssistantMessage();

    this.retryAbortController = new AbortController();
    try {
      await this.interruptibleSleep(delayMs, this.retryAbortController.signal);
    } catch {
      const attempt = this.retryAttempt;
      this.retryAttempt = 0;
      this.emit({ type: 'retry_end', success: false, attempt, finalError: 'Retry cancelled' });
      return false;
    } finally {
      this.retryAbortController = undefined;
    }

    return true;
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
    unsubs.push(this.harness.on('tool_call', (e) => runner.emitToolCall(e)));
    unsubs.push(this.harness.on('tool_result', (e) => runner.emitToolResult(e)));
    unsubs.push(
      this.harness.on('session_before_compact', (e) => runner.emitSessionBeforeCompact(e)),
    );

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
