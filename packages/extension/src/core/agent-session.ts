// ============================================================
// AgentSession — 单次会话的核心生命周期管理
// 负责：Agent runtime 创建/销毁、事件处理、消息缓存（单一来源）、
//       Compaction、Auto Retry、Fork、Session Tree/Navigation/Label
// ============================================================

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  ImageContent,
  Model,
  TextContent,
  ToolResultMessage,
} from '@scout-agent/ai';
import { isContextOverflow, streamSimple } from '@scout-agent/ai';
import type {
  AgentEvent,
  AgentLoopTurnUpdate,
  AgentMessage,
  AgentTool,
  AfterToolCallContext,
  AfterToolCallResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
  CustomMessage,
  PromptTemplate,
  QueuedAgentMessageDelivery,
  StreamFn,
  ThinkingLevel,
} from '@scout-agent/agent';
import type { ToolPresentationMetadata } from '@scout-agent/shared';
import {
  Agent,
  type BashExecutionMessage,
  convertToLlm,
  createCustomMessage,
  formatPromptTemplateInvocation,
  parseCommandArgs,
} from '@scout-agent/agent';
import type { ScoutCoreConfig, ScoutStreamOptions } from './config.ts';
import { buildSystemPrompt } from './system-prompt.ts';
import {
  DEFAULT_ACTIVE_TOOL_NAMES,
  ALL_TOOL_NAMES,
  createBuiltinToolDefinitionEntries,
  wrapToolDefinition,
  createLocalBashOperations,
  OutputAccumulator,
  type BashOperations,
  type ToolDefinition,
} from './tools/index.ts';
import { ScoutExtensionRunner } from './extensions/index.ts';
import type {
  ToolInfo,
  SendMessageInput,
  SendMessageOptions,
  SendUserMessageOptions,
  SourceInfo,
  SlashCommandInfo,
  StartedUserMessage,
  RegisteredCommand,
  ResolvedCommand,
  SessionShutdownEvent,
  SessionStartEvent,
  ReplacedSessionContext,
  ContextUsage,
  ExtensionUIContext,
} from './extensions/types.ts';
import { stripFrontmatter, type Skill as ScoutSkill } from './skills.ts';
import { createSyntheticSourceInfo } from './source-info.ts';
import type { AgentSessionRuntimeDiagnostic } from './agent-session-runtime.ts';
import {
  QueuedMessagePolicy,
  type QueueContinuationPolicy,
  type QueuedFollowUpMessage,
  type QueuedRuntimeSnapshot,
} from './queued-message-policy.ts';
import type { CoreDisposable, CoreLogger } from './logger.ts';
import {
  FileReviewStore,
  isFileReviewPayload,
  type FileReviewTurnSnapshot,
} from './review/file-review.ts';
import {
  ScoutResourceLoader,
  type DiscoveredExtensionResources,
  type ScoutContextFile,
  type LoadedScoutResources,
} from './resource-loader.ts';
import {
  calculateContextTokens,
  collectEntriesForBranchSummary,
  compact as compactPreparedSession,
  type CompactionPreparation,
  type CompactionResult,
  estimateContextTokens,
  generateBranchSummary,
  prepareCompaction,
  shouldCompact,
} from './compaction/index.ts';
import type {
  BranchSummaryEntry,
  CompactionEntry,
  JsonlSessionMetadata,
  MessageEntry,
  Session,
  SessionContext,
  SessionTreeEntry,
  SessionTreeNode,
} from './session/index.ts';
import { createDefaultSessionExportFileName, CURRENT_SESSION_VERSION } from './session/index.ts';
import {
  DEFAULT_REASONING_THINKING_LEVEL,
  normalizeThinkingLevelForModel,
  normalizeThinkingLevelForModelSwitch,
} from './thinking-level.ts';

// ---------- 可重试错误判断 ----------

const RETRYABLE_ERROR_PATTERN =
  /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|stream ended before message_stop|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i;

const NON_RETRYABLE_LIMIT_PATTERN =
  /GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing/i;

const EXTENSION_MESSAGE_CUSTOM_TYPE = 'extension_message';

function createReviewRunId(): string {
  return `run-${randomUUID()}`;
}

function cloneStreamOptions(streamOptions?: ScoutStreamOptions): ScoutStreamOptions {
  return {
    ...streamOptions,
    headers: streamOptions?.headers ? { ...streamOptions.headers } : undefined,
    metadata: streamOptions?.metadata ? { ...streamOptions.metadata } : undefined,
  };
}

function mergeHeaders(
  ...headers: Array<Record<string, string> | undefined>
): Record<string, string> | undefined {
  const merged: Record<string, string> = {};
  let hasHeaders = false;
  for (const entry of headers) {
    if (!entry) continue;
    Object.assign(merged, entry);
    hasHeaders = true;
  }
  return hasHeaders ? merged : undefined;
}

// ---------- 事件类型（判别联合） ----------

export type AgentSessionAgentEvent = AgentEvent & { willRetry?: boolean };

interface PromptAcceptance {
  messages: Set<AgentMessage>;
  reject: (reason?: unknown) => void;
  resolve: () => void;
  settled: boolean;
}

interface StartedPromptRun {
  accepted: Promise<void>;
  turn: Promise<void>;
}

export type CompactionReason = 'manual' | 'threshold' | 'overflow';

export type AgentSessionEvent =
  | { type: 'agent_event'; event: AgentSessionAgentEvent }
  | { type: 'state_change' }
  | { type: 'queue_change' }
  /**
   * 阻塞性失败。SessionEventForwarder 会自动转译为一条 'error' level 的 notification 推送给 webview。
   * 如需发送非阻塞用户提示，请改用 'notification' 事件，不要与 'error' 同时 emit，避免双弹 toast。
   */
  | { type: 'error'; message: string }
  /** 用户级提示，渲染为 webview toast。与 'error' 互斥使用：一次只走一条路径。 */
  | { type: 'notification'; level: 'success' | 'info' | 'warning' | 'error'; message: string }
  | {
      type: 'auto_retry_start';
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | { type: 'auto_retry_end'; success: boolean; attempt: number; finalError?: string }
  | { type: 'compaction_start'; reason: CompactionReason }
  | {
      type: 'compaction_end';
      reason: CompactionReason;
      result?: CompactionResult;
      aborted: boolean;
      willRetry: boolean;
      errorMessage?: string;
    }
  | { type: 'thinking_level_changed'; level: ThinkingLevel }
  | { type: 'tree_change' };

// ---------- 构造选项 ----------

export interface AgentSessionOptions {
  session: Session;
  configManager: ScoutCoreConfig;
  cwd: string;
  logger: CoreLogger;
  skills: ScoutSkill[];
  promptTemplates?: PromptTemplate[];
  contextFiles?: ScoutContextFile[];
  systemPrompt?: string;
  appendSystemPrompt?: string[];
  extensionRunner?: ScoutExtensionRunner;
  loadExtensionResources?: (
    resources: DiscoveredExtensionResources,
  ) => Promise<LoadedScoutResources>;
  activeToolNames?: string[];
  includeAllExtensionTools?: boolean;
  initialModel?: Model<Api>;
  initialThinkingLevel?: ThinkingLevel;
  sessionStartEvent?: SessionStartEvent;
  onFileReviewUpdated?: (session: AgentSession, review: FileReviewTurnSnapshot) => void;
}

export interface ExtensionBindings {
  bindCore?: (runner: ScoutExtensionRunner, session: AgentSession) => void;
}

export interface NavigateTreeResult {
  cancelled: boolean;
  editorText?: string;
  summaryEntry?: BranchSummaryEntry;
}

export interface SessionStats {
  sessionFile: string | undefined;
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  contextUsage?: ContextUsage;
}

export interface BashResult {
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
}

export interface ModelCycleResult {
  model: Model<Api>;
  thinkingLevel: ThinkingLevel;
  isScoped: boolean;
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

interface PromptOptions {
  images?: ImageContent[];
  streamingBehavior?: QueuedAgentMessageDelivery;
  clearFollowUpQueue?: boolean;
}

// ---------- AgentSession ----------

export class AgentSession implements CoreDisposable {
  private readonly session: Session;
  private readonly configManager: ScoutCoreConfig;
  private readonly cwd: string;
  private readonly logger: CoreLogger;
  private skills: ScoutSkill[];
  private promptTemplates: PromptTemplate[];
  private contextFiles: ScoutContextFile[];
  private resourceSystemPrompt?: string;
  private resourceAppendSystemPrompt: string[];
  private extensionRunner?: ScoutExtensionRunner;
  private loadExtensionResources?: (
    resources: DiscoveredExtensionResources,
  ) => Promise<LoadedScoutResources>;
  private hasExtensionDiscoveredResources = false;
  private sessionStartEvent: SessionStartEvent;
  private activeToolNames: string[];
  private activeToolsCustomized: boolean;
  private includeAllExtensionToolsOnInitialize: boolean;
  private readonly initialModel?: Model<Api>;
  private readonly initialThinkingLevel?: ThinkingLevel;
  private readonly onFileReviewUpdated?: (
    session: AgentSession,
    review: FileReviewTurnSnapshot,
  ) => void;
  private toolRegistry = new Map<string, ToolRegistryEntry>();
  private toolRegistryVersion = 0;
  private lastSystemPrompt = '';

  private agent?: Agent;
  private unsubscribeAgent?: () => void;

  /** 流式/忙碌状态：覆盖 Agent 运行和 agent_end 后的 retry/compaction 编排。 */
  private _isStreaming = false;
  private isPostAgentProcessing = false;

  /** Retry 状态 */
  private retryAttempt = 0;
  private retryAbortController: AbortController | undefined;
  private bashAbortController: AbortController | undefined;
  private manualCompactionAbortController: AbortController | undefined;
  private autoCompactionAbortController: AbortController | undefined;
  private branchSummaryAbortController: AbortController | undefined;

  /**
   * Overflow compaction 防重入标志。
   * 置 true 后若下一轮 overflow 再次发生，停止继续 compact-and-retry，
   * 避免无限循环。在 message_start（用户消息到达）时重置为 false。
   */
  private overflowRecoveryAttempted = false;

  /**
   * message_end 时记录最后一条 assistant message，供 agent_end 后决策 retry/compaction。
   * 对齐 Pi 的 _lastAssistantMessage 模式，避免在 message_end 事件回调中重入 Agent。
   */
  private lastAssistantMessage: AssistantMessage | undefined;
  /** Pi extension lifecycle turn index；agent_start 时重置，turn_end 后递增。 */
  private turnIndex = 0;
  /** 当前 agent_start 运行 id，用于生成一次 assistant 回复范围内的 review turnId。 */
  private currentReviewRunId = createReviewRunId();
  private readonly fileReviewStore = new FileReviewStore();

  /** 从当前 session branch 缓存原始路径；provider runtime context 由 agent.state.messages 持有。 */
  private cachedBranch: SessionTreeEntry[] = [];
  /** Pi 式运行态上下文由 agent.state.messages 持有。 */

  /** Agent 运行队列的宿主态策略：暂停、恢复和可见快照。 */
  private readonly queuedMessages = new QueuedMessagePolicy();
  /** 等待 prompt 初始消息完成持久化的启动请求。 */
  private readonly promptAcceptances: PromptAcceptance[] = [];

  /** 扩展通过 sendMessage({ deliverAs: 'nextTurn' }) 排入下一次 prompt 的 custom 消息。 */
  private pendingNextTurnMessages: AgentMessage[] = [];
  /** Agent 运行时产生的宿主 bash 消息延后写入，避免破坏 tool_use/tool_result 顺序。 */
  private pendingBashMessages: BashExecutionMessage[] = [];

  /** 缓存的 session 元数据 */
  private cachedSessionId?: string;
  private cachedParentSessionPath?: string;
  private cachedForkPointEntryId?: string;
  private cachedLeafId?: string | null;

  /** 事件监听器列表 */
  private listeners: ((event: AgentSessionEvent) => void)[] = [];

  constructor(options: AgentSessionOptions) {
    this.session = options.session;
    this.configManager = options.configManager;
    this.cwd = options.cwd;
    this.logger = options.logger;
    this.skills = options.skills;
    this.promptTemplates = options.promptTemplates ?? [];
    this.contextFiles = options.contextFiles ?? [];
    this.resourceSystemPrompt = options.systemPrompt;
    this.resourceAppendSystemPrompt = options.appendSystemPrompt ?? [];
    this.extensionRunner = options.extensionRunner;
    this.loadExtensionResources = options.loadExtensionResources;
    this.sessionStartEvent = options.sessionStartEvent ?? {
      type: 'session_start',
      reason: 'startup',
    };
    this.activeToolNames = options.activeToolNames ?? [...DEFAULT_ACTIVE_TOOL_NAMES];
    this.activeToolsCustomized = options.activeToolNames !== undefined;
    this.includeAllExtensionToolsOnInitialize = options.includeAllExtensionTools ?? false;
    this.initialModel = options.initialModel;
    this.initialThinkingLevel = options.initialThinkingLevel;
    this.onFileReviewUpdated = options.onFileReviewUpdated;
  }

  // ---------- 初始化 ----------

  /** 初始化 Agent runtime + 缓存元数据 + 消息。由宿主协调层构造后调用。 */
  async initialize(): Promise<void> {
    const metadata = (await this.session.getMetadata()) as JsonlSessionMetadata;
    this.cachedSessionId = metadata.id;
    this.cachedParentSessionPath = metadata.parentSessionPath;
    this.cachedForkPointEntryId = metadata.forkPointEntryId;
    await this.restoreActiveToolsFromBranch();

    await this.rebuildRuntime();
    await this.rebuildCachedSessionBranch();
  }

  // ---------- 属性 ----------

  get model(): Model<Api> | undefined {
    return this.agent?.state.model;
  }

  get thinkingLevel(): ThinkingLevel {
    const raw = this.agent?.state.thinkingLevel;
    return raw ? (raw as ThinkingLevel) : 'off';
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

  get forkPointEntryId(): string | undefined {
    return this.cachedForkPointEntryId;
  }

  get leafId(): string | null {
    return this.cachedLeafId ?? null;
  }

  get isFollowUpQueuePaused(): boolean {
    return this.queuedMessages.isFollowUpPaused(this.agent);
  }

  get queuedFollowUpPauseReason(): 'aborted' | undefined {
    return this.queuedMessages.followUpPauseReason(this.agent);
  }

  get sessionFile(): string | undefined {
    return this.session.getSessionFile();
  }

  get sessionManager(): Session {
    return this.session;
  }

  getFileReviewTurn(turnId: string): FileReviewTurnSnapshot | undefined {
    return this.fileReviewStore.getTurn(turnId);
  }

  releaseFileReviewTurnContent(turnId: string): boolean {
    return this.fileReviewStore.releaseTurnContent(turnId);
  }

  // ---------- 运行时操作 ----------

  getQueueSnapshot(): QueuedRuntimeSnapshot {
    return this.queuedMessages.snapshot(this.agent);
  }

  getQueuedFollowUps(): QueuedFollowUpMessage[] {
    return this.queuedMessages.getFollowUps(this.agent);
  }

  cancelFollowUp(id: string): boolean {
    const cancelled = this.queuedMessages.cancelFollowUp(this.agent, id);
    if (cancelled) {
      this.emit({ type: 'queue_change' });
    }
    return cancelled;
  }

  promoteFollowUp(id: string): boolean {
    const promoted = this.queuedMessages.promoteFollowUp(this.agent, id);
    if (promoted) {
      this.emit({ type: 'queue_change' });
    }
    return promoted;
  }

  clearFollowUpQueue(): void {
    if (!this.queuedMessages.clearFollowUps(this.agent)) return;
    this.emit({ type: 'queue_change' });
  }

  async prompt(text: string, options?: PromptOptions): Promise<void> {
    await this.runPrompt(text, options?.images, 'interactive', {
      streamingBehavior: options?.streamingBehavior,
      clearFollowUpQueue: options?.clearFollowUpQueue,
    });
  }

  private async runPrompt(
    text: string,
    images: ImageContent[] | undefined,
    source: 'interactive' | 'rpc' | 'extension',
    options?: { streamingBehavior?: QueuedAgentMessageDelivery; clearFollowUpQueue?: boolean },
  ): Promise<void> {
    try {
      const started = await this.startPromptRun(text, images, source, options);
      if (!started) return;
      await started.accepted;
      await started.turn;
    } catch (error) {
      this.handlePromptError('Prompt', error);
    }
  }

  private async startPromptRun(
    text: string,
    images: ImageContent[] | undefined,
    source: 'interactive' | 'rpc' | 'extension',
    options?: { streamingBehavior?: QueuedAgentMessageDelivery; clearFollowUpQueue?: boolean },
  ): Promise<StartedPromptRun | undefined> {
    if (!this.agent) return undefined;

    this.retryAttempt = 0;

    if (await this.tryExecuteExtensionCommand(text)) {
      return {
        accepted: Promise.resolve(),
        turn: Promise.resolve(),
      };
    }
    const preparedInput = await this.preparePromptInput(text, images, source);
    if (!preparedInput) return undefined;

    if (this._isStreaming) {
      if (!options?.streamingBehavior) {
        throw new Error(
          'Agent is already processing. Specify streamingBehavior ("steer" or "followUp") to queue the message.',
        );
      }
      this.queueAgentMessage(
        this.createUserMessage(preparedInput.text, preparedInput.images),
        options.streamingBehavior,
      );
      return {
        accepted: Promise.resolve(),
        turn: Promise.resolve(),
      };
    }

    const preservePausedFollowUps =
      !options?.clearFollowUpQueue && this.queuedMessages.isFollowUpPaused(this.agent);
    if (options?.clearFollowUpQueue) {
      this.clearFollowUpQueue();
    }
    await this.flushPendingBashMessages();
    await this.runPrePromptCompaction({ preserveFollowUps: preservePausedFollowUps });
    // 保留队列发送新消息时，当前 prompt 应先进入 agent loop；旧 follow-up 在该轮停机点续上。
    this.queuedMessages.resumeFollowUps();

    this._isStreaming = true;
    this.emit({ type: 'state_change' });
    try {
      const userMessage = this.createUserMessage(preparedInput.text, preparedInput.images);
      const messages = await this.prepareAgentStartMessages(
        userMessage,
        preparedInput.images,
        preparedInput.text,
      );
      return this.startPreparedPromptRun(messages, [userMessage]);
    } catch (error) {
      this._isStreaming = false;
      this.emit({ type: 'state_change' });
      throw error;
    }
  }

  private startPreparedPromptRun(
    messages: AgentMessage[],
    acceptedMessages: AgentMessage[],
  ): StartedPromptRun {
    const acceptance = this.registerPromptAcceptance(acceptedMessages);
    const turn = this.runStartedPrompt(messages).finally(() => {
      this.rejectPromptAcceptance(
        acceptance.record,
        new Error('Prompt ended before the initial user message was accepted'),
      );
    });
    return {
      accepted: acceptance.promise,
      turn,
    };
  }

  private async runStartedPrompt(messages: AgentMessage[]): Promise<void> {
    if (!this.agent) {
      this._isStreaming = false;
      this.emit({ type: 'state_change' });
      return;
    }
    try {
      await this.agent.prompt(messages);
      await this.runPostAgentLoop();
    } catch (error) {
      this.handlePromptError('Prompt', error);
    }
  }

  private handlePromptError(context: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.logger.appendLine(`[scout] ${context} error: ${errorMessage}`);
    this._isStreaming = false;
    this.emit({ type: 'error', message: errorMessage });
  }

  async abort(): Promise<void> {
    if (!this.agent) return;
    try {
      const hasActiveRun = this._isStreaming || this.isPostAgentProcessing;
      this.retryAbortController?.abort();
      this.bashAbortController?.abort();
      this.manualCompactionAbortController?.abort();
      this.autoCompactionAbortController?.abort();
      this.branchSummaryAbortController?.abort();
      this.queuedMessages.pauseFollowUpsAfterAbort(this.agent);
      this.emit({ type: 'queue_change' });
      this.agent?.abort();
      if (!hasActiveRun) {
        this.emit({ type: 'state_change' });
      }
    } catch (error) {
      this.logger.appendLine(
        `[scout] Abort error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 用户手动续写：沿用 Agent runtime continuation 语义。 */
  async continue(options?: { preserveFollowUps?: boolean }): Promise<void> {
    if (!this.agent) return;

    this.retryAttempt = 0;

    try {
      if (options?.preserveFollowUps) {
        if (!this.queuedMessages.isFollowUpPaused(this.agent)) {
          this.queuedMessages.reset();
        }
      } else {
        this.queuedMessages.resumeFollowUps();
      }
      this._isStreaming = true;
      this.emit({ type: 'state_change' });
      await this.agent.continue({
        preserveFollowUps: options?.preserveFollowUps,
      });
      await this.runPostAgentLoop({ preserveFollowUps: options?.preserveFollowUps });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.appendLine(`[scout] Continue error: ${errorMessage}`);
      this._isStreaming = false;
      this.emit({ type: 'error', message: errorMessage });
    }
  }

  /**
   * Queue a steering message while the agent is running.
   * Delivered after the current assistant turn finishes executing tool calls.
   */
  async steer(text: string, images?: ImageContent[]): Promise<void> {
    if (!this.agent) return;
    if (text.startsWith('/')) {
      this.throwIfExtensionCommand(text);
    }
    this.queueAgentMessage(
      this.createUserMessage(this.expandPromptCommands(text), images),
      'steer',
    );
  }

  /**
   * Queue a follow-up message to run after the agent has no tool calls or steering messages.
   */
  async followUp(text: string, images?: ImageContent[]): Promise<void> {
    if (!this.agent) return;
    if (text.startsWith('/')) {
      this.throwIfExtensionCommand(text);
    }
    this.queueAgentMessage(
      this.createUserMessage(this.expandPromptCommands(text), images),
      'followUp',
    );
  }

  /** 获取当前上下文 token 用量估算（基于当前 session context） */
  async getContextUsage(): Promise<ContextUsage | undefined> {
    if (!this.agent) return undefined;

    const model = this.agent.state.model;
    const contextWindow = model.contextWindow ?? 0;
    if (contextWindow <= 0) return undefined;

    const branch = await this.session.getBranch();
    const latestCompaction = getLatestCompactionEntry(branch);
    if (latestCompaction && !hasPostCompactionAssistantUsage(branch, latestCompaction)) {
      return { tokens: null, contextWindow, percent: null };
    }

    const estimate = estimateContextTokens(await this.getRuntimeMessages());
    const percent = (estimate.tokens / contextWindow) * 100;
    return {
      tokens: estimate.tokens,
      contextWindow,
      percent,
    };
  }

  async getSessionStats(): Promise<SessionStats> {
    const messages = await this.getRuntimeMessages();
    const userMessages = messages.filter((message) => message.role === 'user').length;
    const assistantMessages = messages.filter((message) => message.role === 'assistant').length;
    const toolResults = messages.filter((message) => message.role === 'toolResult').length;
    let toolCalls = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalCost = 0;

    for (const message of messages) {
      if (message.role !== 'assistant') continue;
      const assistant = message as AssistantMessage;
      toolCalls += assistant.content.filter((content) => content.type === 'toolCall').length;
      totalInput += assistant.usage.input;
      totalOutput += assistant.usage.output;
      totalCacheRead += assistant.usage.cacheRead;
      totalCacheWrite += assistant.usage.cacheWrite;
      totalCost += assistant.usage.cost.total;
    }

    return {
      sessionFile: this.sessionFile,
      sessionId: this.sessionId,
      userMessages,
      assistantMessages,
      toolCalls,
      toolResults,
      totalMessages: messages.length,
      tokens: {
        input: totalInput,
        output: totalOutput,
        cacheRead: totalCacheRead,
        cacheWrite: totalCacheWrite,
        total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
      },
      cost: totalCost,
      contextUsage: await this.getContextUsage(),
    };
  }

  exportToJsonl(outputPath?: string): string {
    const filePath = resolve(this.cwd, outputPath ?? createDefaultSessionExportFileName());
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const header = {
      type: 'session' as const,
      version: CURRENT_SESSION_VERSION,
      id: this.session.getSessionId(),
      timestamp: new Date().toISOString(),
      cwd: this.session.getCwd(),
    };
    const branchEntries = this.session.getBranch();
    const lines = [JSON.stringify(header)];
    let parentId: string | null = null;
    for (const entry of branchEntries) {
      lines.push(JSON.stringify({ ...entry, parentId }));
      parentId = entry.id;
    }
    writeFileSync(filePath, `${lines.join('\n')}\n`);
    return filePath;
  }

  async setModel(modelId: string, provider?: string): Promise<void> {
    if (!this.agent) return;
    const model = provider
      ? this.configManager.findModelByProvider(provider, modelId)
      : this.configManager.findModel(modelId);
    if (!model) return;

    try {
      await this.applyModelSelection(model, 'set');
    } catch (error) {
      this.logger.appendLine(
        `[scout] Model select error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async cycleModel(
    direction: 'forward' | 'backward' = 'forward',
  ): Promise<ModelCycleResult | undefined> {
    if (!this.agent) return undefined;
    const availableModels = this.configManager.getAvailableModels().map((entry) => entry.model);
    if (availableModels.length === 0) return undefined;

    const current = this.agent.state.model;
    const currentIndex = availableModels.findIndex(
      (model) => model.provider === current.provider && model.id === current.id,
    );
    const step = direction === 'forward' ? 1 : -1;
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (baseIndex + step + availableModels.length) % availableModels.length;
    const nextModel = availableModels[nextIndex];
    if (!nextModel) return undefined;

    const thinkingLevel = await this.applyModelSelection(nextModel, 'cycle');
    if (!thinkingLevel) return undefined;
    return { model: nextModel, thinkingLevel, isScoped: false };
  }

  private async applyModelSelection(
    model: Model<Api>,
    source: 'set' | 'cycle',
  ): Promise<ThinkingLevel | undefined> {
    const agent = this.agent;
    if (!agent) return undefined;

    const previousModel = agent.state.model;
    const previousLevel = agent.state.thinkingLevel as ThinkingLevel;
    const requestedLevel = previousModel.reasoning
      ? previousLevel
      : this.configManager.getDefaultThinkingLevel();
    const thinkingLevel = normalizeThinkingLevelForModelSwitch(model, requestedLevel);
    await this.session.appendModelChange(model.provider, model.id);
    if (thinkingLevel !== previousLevel) {
      await this.session.appendThinkingLevelChange(thinkingLevel);
    }
    agent.state.model = model;
    agent.state.thinkingLevel = thinkingLevel;
    await this.extensionRunner?.emit({
      type: 'model_select',
      model,
      previousModel,
      source,
    });
    this.emit({ type: 'state_change' });
    if (thinkingLevel !== previousLevel) {
      this.emit({ type: 'thinking_level_changed', level: thinkingLevel });
    }
    return thinkingLevel;
  }

  supportsThinking(): boolean {
    return this.agent?.state.model.reasoning ?? false;
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    if (!this.agent) return;
    try {
      const previousLevel = this.agent.state.thinkingLevel as ThinkingLevel;
      const thinkingLevel = normalizeThinkingLevelForModel(this.agent.state.model, level);
      if (thinkingLevel === previousLevel) return;

      await this.session.appendThinkingLevelChange(thinkingLevel);
      this.agent.state.thinkingLevel = thinkingLevel;
      await this.extensionRunner?.emit({
        type: 'thinking_level_select',
        level: thinkingLevel,
        previousLevel,
      });
      this.emit({ type: 'state_change' });
      this.emit({ type: 'thinking_level_changed', level: thinkingLevel });
    } catch (error) {
      this.logger.appendLine(
        `[scout] Thinking level select error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async compact(customInstructions?: string): Promise<void> {
    if (!this.agent) return;
    if (this.manualCompactionAbortController) {
      this.logger.appendLine(
        '[scout] Manual compaction already running, ignoring duplicate request',
      );
      return;
    }
    if (this._isStreaming) {
      this.logger.appendLine('[scout] Manual compaction skipped: agent is streaming');
      this.emit({
        type: 'notification',
        level: 'warning',
        message: '请等待当前回复完成后再压缩',
      });
      return;
    }
    const settings = this.configManager.getCompactionSettings();
    const branchEntries = await this.session.getBranch();
    const preparation = prepareCompaction(branchEntries, settings);
    if (!preparation) {
      this.logger.appendLine('[scout] Manual compaction skipped: nothing to compact');
      this.emit({
        type: 'notification',
        level: 'warning',
        message: '当前没有可压缩的上下文',
      });
      return;
    }

    const compactedAgent = this.agent;
    this.unsubscribeAgent?.();
    this.unsubscribeAgent = undefined;
    this.retryAbortController?.abort();
    this.bashAbortController?.abort();
    this.autoCompactionAbortController?.abort();
    this.branchSummaryAbortController?.abort();
    this.clearQueuedAgentMessages();
    compactedAgent.abort();

    const abortController = new AbortController();
    this.manualCompactionAbortController = abortController;
    this.emit({ type: 'compaction_start', reason: 'manual' });
    try {
      this.logger.appendLine('[scout] Running manual compaction');
      const result = await this.runCompactionCore({
        signal: abortController.signal,
        settings,
        branchEntries,
        preparation,
        customInstructions,
      });
      await this.syncRuntimeMessagesFromSession();
      await this.rebuildCachedSessionBranch();
      this.emit({
        type: 'compaction_end',
        reason: 'manual',
        result,
        aborted: false,
        willRetry: false,
      });
      this.emit({ type: 'state_change' });
      this.emit({ type: 'tree_change' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const aborted = abortController.signal.aborted;
      this.logger.appendLine(`[scout] Compaction failed: ${errorMessage}`);
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
      if (this.agent === compactedAgent && !this.unsubscribeAgent) {
        this.unsubscribeAgent = compactedAgent.subscribe((event, signal) =>
          this.handleAgentEvent(event, signal),
        );
      }
    }
  }

  async abortRetry(): Promise<void> {
    this.retryAbortController?.abort();
  }

  async executeBash(
    command: string,
    onChunk?: (chunk: string) => void,
    options?: { excludeFromContext?: boolean; operations?: BashOperations },
  ): Promise<BashResult> {
    const shellPath = (
      this.configManager as { getShellPath?: () => string | undefined }
    ).getShellPath?.();
    const operations = options?.operations ?? createLocalBashOperations({ shellPath });
    const abortController = new AbortController();
    this.bashAbortController = abortController;
    const output = new OutputAccumulator({ tempFilePrefix: 'scout-bash' });
    const decoder = new TextDecoder();
    let exitCode: number | null = null;

    try {
      try {
        const result = await operations.exec(command, this.cwd, {
          onData: (data) => {
            output.append(data);
            onChunk?.(decoder.decode(data));
          },
          signal: abortController.signal,
        });
        exitCode = result.exitCode;
      } catch (error) {
        if (!abortController.signal.aborted) {
          throw error;
        }
      } finally {
        output.finish();
      }

      const snapshot = output.snapshot({ persistIfTruncated: true });
      await output.closeTempFile();
      const result: BashResult = {
        output: snapshot.content,
        exitCode: abortController.signal.aborted ? undefined : (exitCode ?? undefined),
        cancelled: abortController.signal.aborted,
        truncated: snapshot.truncation.truncated,
        fullOutputPath: snapshot.fullOutputPath,
      };
      await this.recordBashResult(command, result, options);
      return result;
    } finally {
      if (this.bashAbortController === abortController) {
        this.bashAbortController = undefined;
      }
    }
  }

  abortBash(): void {
    this.bashAbortController?.abort();
  }

  get isBashRunning(): boolean {
    return this.bashAbortController !== undefined;
  }

  get hasPendingBashMessages(): boolean {
    return this.pendingBashMessages.length > 0;
  }

  async recordBashResult(
    command: string,
    result: BashResult,
    options?: { excludeFromContext?: boolean },
  ): Promise<void> {
    const bashMessage: BashExecutionMessage = {
      role: 'bashExecution',
      command,
      output: result.output,
      exitCode: result.exitCode,
      cancelled: result.cancelled,
      truncated: result.truncated,
      fullOutputPath: result.fullOutputPath,
      timestamp: Date.now(),
      excludeFromContext: options?.excludeFromContext,
    };

    if (this._isStreaming) {
      this.pendingBashMessages.push(bashMessage);
      return;
    }

    await this.persistAgentMessage(bashMessage);
    this.appendRuntimeMessage(bashMessage);
    await this.rebuildCachedSessionBranch();
    this.emit({ type: 'state_change' });
    this.emit({ type: 'tree_change' });
  }

  private async flushPendingBashMessages(): Promise<void> {
    if (this.pendingBashMessages.length === 0) return;
    const messages = this.pendingBashMessages.splice(0);
    for (const message of messages) {
      await this.persistAgentMessage(message);
      this.appendRuntimeMessage(message);
    }
    await this.rebuildCachedSessionBranch();
    this.emit({ type: 'state_change' });
    this.emit({ type: 'tree_change' });
  }

  async sendUserMessage(
    content: string | (TextContent | ImageContent)[],
    options?: SendUserMessageOptions,
  ): Promise<void> {
    if (!this.agent) return;

    const { text, images } = this.normalizeUserMessageContent(content);
    if (!this._isStreaming) {
      await this.runPrompt(text, images, 'extension');
      return;
    }

    if (!options?.deliverAs) {
      throw new Error('sendUserMessage while streaming requires deliverAs: "steer" or "followUp"');
    }

    if (options?.deliverAs === 'steer') {
      this.queueAgentMessage(this.createUserMessage(text, images), 'steer');
      return;
    }
    if (options?.deliverAs === 'followUp') {
      this.queueAgentMessage(this.createUserMessage(text, images), 'followUp');
      return;
    }
    throw new Error('sendUserMessage while streaming requires deliverAs: "steer" or "followUp"');
  }

  async startUserMessage(
    content: string | (TextContent | ImageContent)[],
  ): Promise<StartedUserMessage> {
    if (!this.agent) return { turn: Promise.resolve() };

    const { text, images } = this.normalizeUserMessageContent(content);
    if (this._isStreaming) {
      throw new Error('startUserMessage requires an idle replacement session');
    }

    const started = await this.startPromptRun(text, images, 'extension');
    if (!started) return { turn: Promise.resolve() };
    await started.accepted;
    return { turn: started.turn };
  }

  async sendMessage<TDetails = unknown>(
    message: SendMessageInput<TDetails>,
    options?: SendMessageOptions,
  ): Promise<void> {
    const { customMessage } = this.createCustomMessageFromInput(message);

    if (options?.deliverAs === 'nextTurn') {
      this.pendingNextTurnMessages.push(customMessage);
      this.emit({ type: 'state_change' });
      return;
    }

    if (this._isStreaming) {
      this.queueAgentMessage(customMessage, options?.deliverAs ?? 'steer');
      return;
    }

    if (options?.triggerTurn) {
      await this.promptCustomMessage(customMessage);
      return;
    }

    await this.appendCustomMessageWithLifecycle(customMessage);
  }

  getActiveToolNames(): string[] {
    return [...this.activeToolNames];
  }

  isActiveToolsCustomized(): boolean {
    return this.activeToolsCustomized;
  }

  async getSessionMetadata(): Promise<JsonlSessionMetadata> {
    return (await this.session.getMetadata()) as JsonlSessionMetadata;
  }

  getBackingSession(): Session {
    return this.session;
  }

  getAllToolInfos(): ToolInfo[] {
    return [...this.toolRegistry.values()].map((entry) => ({
      name: entry.definition.name,
      label: entry.definition.label,
      description: entry.definition.description,
      parameters: entry.definition.parameters,
      ...(entry.definition.presentation ? { presentation: entry.definition.presentation } : {}),
      sourceInfo: entry.sourceInfo,
    }));
  }

  getToolPresentation(toolName: string): ToolPresentationMetadata | undefined {
    return this.toolRegistry.get(toolName)?.definition.presentation;
  }

  getToolRegistryVersion(): number {
    return this.toolRegistryVersion;
  }

  async appendEntry<TData = unknown>(customType: string, data?: TData): Promise<void> {
    await this.session.appendCustomEntry(customType, data);
    this.cachedLeafId = await this.session.getLeafId();
    await this.rebuildCachedSessionBranch();
    this.emit({ type: 'state_change' });
    this.emit({ type: 'tree_change' });
  }

  async setSessionName(name: string): Promise<void> {
    await this.session.appendSessionName(name);
    this.emit({ type: 'state_change' });
  }

  async getSessionName(): Promise<string | undefined> {
    return this.session.getSessionName();
  }

  getCommands(): SlashCommandInfo[] {
    const getRegisteredCommands = (
      this.extensionRunner as { getRegisteredCommands?: () => ResolvedCommand[] } | undefined
    )?.getRegisteredCommands;
    const extensionCommands: SlashCommandInfo[] =
      getRegisteredCommands?.call(this.extensionRunner).map((command) => ({
        name: command.invocationName,
        description: command.description,
        source: 'extension',
        sourceInfo: command.sourceInfo,
      })) ?? [];
    const templates: SlashCommandInfo[] = this.getPromptTemplates().map((template) => ({
      name: template.name,
      description: template.description,
      source: 'prompt',
      sourceInfo:
        (template as PromptTemplate & { sourceInfo?: SourceInfo }).sourceInfo ??
        createSyntheticSourceInfo(`<prompt:${template.name}>`, {
          source: 'prompt',
        }),
    }));
    const skills: SlashCommandInfo[] = this.skills.map((skill) => ({
      name: `skill:${skill.name}`,
      description: skill.description,
      source: 'skill',
      sourceInfo:
        (skill as ScoutSkill & { sourceInfo?: SourceInfo }).sourceInfo ??
        createSyntheticSourceInfo(skill.filePath, {
          source: 'skill',
          baseDir: skill.filePath.replace(/[\\/][^\\/]*$/, ''),
        }),
    }));
    return [...extensionCommands, ...templates, ...skills];
  }

  async setResources(resources: {
    skills?: ScoutSkill[];
    promptTemplates?: PromptTemplate[];
    contextFiles?: ScoutContextFile[];
    systemPrompt?: string;
    appendSystemPrompt?: string[];
  }): Promise<void> {
    this.skills = resources.skills ?? [];
    this.promptTemplates = resources.promptTemplates ?? [];
    this.contextFiles = resources.contextFiles ?? [];
    this.resourceSystemPrompt = resources.systemPrompt;
    this.resourceAppendSystemPrompt = resources.appendSystemPrompt ?? [];
    this.lastSystemPrompt = this.buildCurrentSystemPrompt();
    if (this.agent) {
      this.agent.state.systemPrompt = this.lastSystemPrompt;
      this.agent.state.tools = this.getActiveTools();
    }
    this.emit({ type: 'state_change' });
  }

  async setActiveTools(toolNames: string[]): Promise<void> {
    const missing = toolNames.filter((name) => !this.toolRegistry.has(name));
    if (missing.length > 0) {
      throw new Error(`Unknown tool(s): ${missing.join(', ')}`);
    }

    this.activeToolsCustomized = true;
    this.activeToolNames = [...toolNames];
    await this.persistActiveTools();
    this.applyToolsToAgent();
    this.lastSystemPrompt = this.buildCurrentSystemPrompt();
    if (this.agent) this.agent.state.systemPrompt = this.lastSystemPrompt;
    this.emit({ type: 'state_change' });
    this.emit({ type: 'tree_change' });
  }

  async refreshTools(): Promise<void> {
    const previousRegistryNames = new Set(this.toolRegistry.keys());
    this.rebuildToolRegistry();
    this.normalizeActiveToolNames({ previousRegistryNames });
    this.applyToolsToAgent();
    this.lastSystemPrompt = this.buildCurrentSystemPrompt();
    if (this.agent) this.agent.state.systemPrompt = this.lastSystemPrompt;
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
    return this.pendingNextTurnMessages.length > 0 || (this.agent?.hasQueuedMessages() ?? false);
  }

  private hasContinuationPendingMessages(policy: QueueContinuationPolicy = {}): boolean {
    return this.queuedMessages.hasContinuationMessages(this.agent, policy);
  }

  getAbortSignal(): AbortSignal | undefined {
    return this.agent?.signal;
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

  async discoverExtensionResources(
    reason: 'startup' | 'reload',
  ): Promise<AgentSessionRuntimeDiagnostic[]> {
    if (!this.extensionRunner || !this.loadExtensionResources) return [];
    const hasResourceHandlers = this.extensionRunner.hasHandlers('resources_discover');
    if (!hasResourceHandlers && !this.hasExtensionDiscoveredResources) return [];

    const discoveredResources = hasResourceHandlers
      ? await this.extensionRunner.emitResourcesDiscover(this.cwd, reason)
      : ScoutResourceLoader.emptyDiscovered();
    const hasDiscoveredResources = ScoutResourceLoader.hasDiscoveredResources(discoveredResources);
    if (!hasDiscoveredResources && !this.hasExtensionDiscoveredResources) return [];

    const loadedResources = await this.loadExtensionResources(discoveredResources);
    this.hasExtensionDiscoveredResources = hasDiscoveredResources;
    await this.setResources({
      skills: loadedResources.skills,
      promptTemplates: loadedResources.promptTemplates,
      contextFiles: loadedResources.contextFiles,
      systemPrompt: loadedResources.systemPrompt,
      appendSystemPrompt: loadedResources.appendSystemPrompt,
    });
    for (const diag of loadedResources.diagnostics) {
      const prefix = diag.type === 'error' ? 'ERROR' : 'WARN';
      this.logger.appendLine(`[scout] ${prefix}: ${diag.message}`);
    }
    return loadedResources.diagnostics;
  }

  async bindExtensions(bindings: ExtensionBindings = {}): Promise<AgentSessionRuntimeDiagnostic[]> {
    if (!this.extensionRunner) return [];
    bindings.bindCore?.(this.extensionRunner, this);
    await this.emitSessionStart(this.sessionStartEvent);
    return await this.discoverExtensionResources(
      this.sessionStartEvent.reason === 'reload' ? 'reload' : 'startup',
    );
  }

  /** 设置扩展 runner 并重新桥接钩子。 */
  setExtensionRunner(runner: ScoutExtensionRunner): void {
    this.extensionRunner = runner;
    this.refreshTools().catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.appendLine(`[scout] Refresh tools failed: ${errorMessage}`);
      this.emit({ type: 'error', message: `Refresh tools failed: ${errorMessage}` });
    });
  }

  setExtensionUIContext(uiContext: ExtensionUIContext | undefined): void {
    this.extensionRunner?.setUIContext(uiContext);
  }

  // ---------- Session Tree / Navigation / Label ----------

  /** 返回 core session tree；host 负责映射为 webview 协议树。 */
  async getTree(): Promise<SessionTreeNode[]> {
    return this.session.getTree();
  }

  /** 导航到指定 entry */
  async navigateTree(
    targetId: string,
    options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    },
  ): Promise<NavigateTreeResult> {
    if (!this.agent) {
      this.emit({ type: 'error', message: 'No active agent for tree navigation' });
      return { cancelled: true };
    }
    if (this.branchSummaryAbortController) {
      this.logger.appendLine('[scout] Tree navigation already running, ignoring duplicate');
      return { cancelled: true };
    }

    const abortController = new AbortController();
    this.branchSummaryAbortController = abortController;
    try {
      const oldLeafId = await this.session.getLeafId();
      if (oldLeafId === targetId) return { cancelled: false };
      const targetEntry = await this.session.getEntry(targetId);
      if (!targetEntry) throw new Error(`Entry ${targetId} not found`);

      const { entries, commonAncestorId } = collectEntriesForBranchSummary(
        this.session,
        oldLeafId,
        targetId,
      );
      const preparation = {
        targetId,
        oldLeafId,
        commonAncestorId,
        entriesToSummarize: entries,
        userWantsSummary: options?.summarize ?? false,
        customInstructions: options?.customInstructions,
        replaceInstructions: options?.replaceInstructions,
        label: options?.label,
      };
      const branchSummarySettings = this.configManager.getBranchSummarySettings();
      const hookResult = await this.extensionRunner?.emitSessionBeforeTree({
        type: 'session_before_tree',
        preparation,
        signal: abortController.signal,
      });
      if (hookResult?.cancel || abortController.signal.aborted) return { cancelled: true };

      let summaryEntry: BranchSummaryEntry | undefined;
      let summaryText = options?.summarize ? hookResult?.summary?.summary : undefined;
      let summaryDetails: unknown = options?.summarize ? hookResult?.summary?.details : undefined;
      if (!summaryText && options?.summarize && entries.length > 0) {
        const model = this.agent.state.model;
        if (!model) throw new Error('No model set for branch summary');
        const auth = await this.getApiKeyAndHeaders(model);
        if (!auth) throw new Error('No auth available for branch summary');
        const summaryResult = await generateBranchSummary(entries, {
          model,
          apiKey: auth.apiKey,
          headers: auth.headers,
          signal: abortController.signal,
          customInstructions: hookResult?.customInstructions ?? options?.customInstructions,
          replaceInstructions: hookResult?.replaceInstructions ?? options?.replaceInstructions,
          reserveTokens: branchSummarySettings.reserveTokens,
        });
        if (summaryResult.aborted) return { cancelled: true };
        if (summaryResult.error) throw new Error(summaryResult.error);
        summaryText = summaryResult.summary;
        summaryDetails = {
          readFiles: summaryResult.readFiles,
          modifiedFiles: summaryResult.modifiedFiles,
        };
      }
      if (abortController.signal.aborted) return { cancelled: true };

      let editorText: string | undefined;
      let newLeafId: string | null;
      if (targetEntry.type === 'message' && targetEntry.message.role === 'user') {
        newLeafId = targetEntry.parentId;
        const content = targetEntry.message.content;
        editorText =
          typeof content === 'string'
            ? content
            : content
                .filter(
                  (part): part is { readonly type: 'text'; readonly text: string } =>
                    part.type === 'text',
                )
                .map((part) => part.text)
                .join('');
      } else if (targetEntry.type === 'custom_message') {
        newLeafId = targetEntry.parentId;
        editorText =
          typeof targetEntry.content === 'string'
            ? targetEntry.content
            : targetEntry.content
                .filter(
                  (part): part is { readonly type: 'text'; readonly text: string } =>
                    part.type === 'text',
                )
                .map((part) => part.text)
                .join('');
      } else {
        newLeafId = targetId;
      }

      const summaryId = await this.session.moveTo(
        newLeafId,
        summaryText
          ? {
              summary: summaryText,
              details: summaryDetails,
              fromHook: hookResult?.summary !== undefined,
            }
          : undefined,
      );
      if (summaryId) {
        const entry = await this.session.getEntry(summaryId);
        if (entry?.type === 'branch_summary') summaryEntry = entry;
      }

      const label = hookResult?.label ?? options?.label;
      if (label) {
        await this.session.appendLabel(summaryId ?? targetId, label);
      }

      const result: NavigateTreeResult = { cancelled: false, editorText, summaryEntry };
      await this.extensionRunner?.emit({
        type: 'session_tree',
        newLeafId: await this.session.getLeafId(),
        oldLeafId,
        summaryEntry,
        fromHook: hookResult?.summary !== undefined,
        fromExtension: hookResult?.summary !== undefined,
      });
      if (!result.cancelled) {
        await this.syncRuntimeMessagesFromSession();
        await this.rebuildCachedSessionBranch();
        this.emit({ type: 'state_change' });
        this.emit({ type: 'tree_change' });
      }
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.appendLine(`[scout] Navigate tree failed: ${errorMessage}`);
      this.emit({ type: 'error', message: `Navigate tree failed: ${errorMessage}` });
      return { cancelled: true };
    } finally {
      if (this.branchSummaryAbortController === abortController) {
        this.branchSummaryAbortController = undefined;
      }
    }
  }

  /** 设置/清除 entry 标签 */
  async setLabel(entryId: string, label?: string): Promise<void> {
    try {
      await this.session.appendLabel(entryId, label);
      this.emit({ type: 'tree_change' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.appendLine(`[scout] Set label failed: ${errorMessage}`);
      throw error;
    }
  }

  async waitForIdle(): Promise<void> {
    await this.agent?.waitForIdle();
  }

  // ---------- 消息访问（单一来源） ----------

  getSessionBranch(): readonly SessionTreeEntry[] {
    // 返回内部数组引用：rebuild 时整体替换为新数组，调用方只读使用；
    // host 层依赖引用稳定做投影记忆化。
    return this.cachedBranch;
  }

  getSessionEntries(): readonly SessionTreeEntry[] {
    return this.session.getEntries();
  }

  createReplacedSessionContext(): ReplacedSessionContext {
    if (!this.extensionRunner) {
      throw new Error('No extension runner is available for the replacement session');
    }
    const context = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(this.extensionRunner.createCommandContext()),
    ) as ReplacedSessionContext;
    context.sendMessage = (message, options) => this.sendMessage(message, options);
    context.sendUserMessage = (content, options) => this.sendUserMessage(content, options);
    context.startUserMessage = (content) => this.startUserMessage(content);
    return context;
  }

  private registerPromptAcceptance(messages: AgentMessage[]): {
    promise: Promise<void>;
    record: PromptAcceptance;
  } {
    let resolve!: () => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<void>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });
    const record: PromptAcceptance = {
      messages: new Set(messages),
      reject,
      resolve,
      settled: false,
    };
    if (record.messages.size === 0) {
      this.resolvePromptAcceptance(record);
      return { promise, record };
    }
    this.promptAcceptances.push(record);
    return { promise, record };
  }

  private acceptPromptMessage(message: AgentMessage): void {
    for (const acceptance of [...this.promptAcceptances]) {
      if (!acceptance.messages.delete(message) || acceptance.messages.size > 0) continue;
      this.resolvePromptAcceptance(acceptance);
    }
  }

  private resolvePromptAcceptance(acceptance: PromptAcceptance): void {
    if (acceptance.settled) return;
    acceptance.settled = true;
    this.removePromptAcceptance(acceptance);
    acceptance.resolve();
  }

  private rejectPromptAcceptance(acceptance: PromptAcceptance, reason: unknown): void {
    if (acceptance.settled) return;
    acceptance.settled = true;
    this.removePromptAcceptance(acceptance);
    acceptance.reject(reason);
  }

  private removePromptAcceptance(acceptance: PromptAcceptance): void {
    const index = this.promptAcceptances.indexOf(acceptance);
    if (index !== -1) {
      this.promptAcceptances.splice(index, 1);
    }
  }

  private rejectAllPromptAcceptances(reason: unknown): void {
    for (const acceptance of [...this.promptAcceptances]) {
      this.rejectPromptAcceptance(acceptance, reason);
    }
  }

  // ---------- 事件订阅 ----------

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  // ---------- 生命周期 ----------

  dispose(): void {
    this.rejectAllPromptAcceptances(new Error('Agent session disposed before prompt acceptance'));
    this.extensionRunner?.invalidate();
    this.unsubscribeAgent?.();
    this.unsubscribeAgent = undefined;
    this.extensionRunner = undefined;
    this.agent?.abort();
    this.agent = undefined;
    this._isStreaming = false;
    this.listeners.length = 0;
  }

  // ---------- 内部：事件发射 ----------

  private emit(event: AgentSessionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  // ---------- 内部：消息缓存 ----------

  /**
   * 从当前 session branch 重建宿主 raw branch 快照。
   *
   * 不变量：每次调用必须用一个**新数组引用**整体替换 `cachedBranch`，
   * 切勿就地 mutate。host 层（SessionMessageProjectionCache）依赖
   * 引用稳定性做投影记忆化——引用变 = 内容变 = cache 失效。
   */
  private async rebuildCachedSessionBranch(): Promise<void> {
    try {
      const next = await this.session.getBranch();
      this.cachedBranch = next;
      this.cachedLeafId = await this.session.getLeafId();
    } catch (error) {
      this.logger.appendLine(
        `[scout] rebuildCachedSessionBranch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.cachedBranch = [];
    }
  }

  async syncRuntimeMessagesFromSession(): Promise<AgentMessage[]> {
    const context: SessionContext = await this.session.buildContext();
    if (this.agent) {
      this.agent.state.messages = context.messages;
    }
    return context.messages.slice();
  }

  private async getRuntimeMessages(): Promise<AgentMessage[]> {
    if (!this.agent) return await this.syncRuntimeMessagesFromSession();
    return this.agent.state.messages.slice();
  }

  private appendRuntimeMessage(message: AgentMessage): void {
    if (!this.agent) return;
    this.agent.state.messages = [...this.agent.state.messages, message];
  }

  /**
   * Pi 语义：assistant error message 保留在 session history 中用于展示和树历史；
   * retry/overflow recovery 只从 agent.state.messages 运行态移除，避免带入本次自动恢复的 runtime context。
   */
  private async removeLastRuntimeAssistantMessage(): Promise<boolean> {
    const messages = await this.getRuntimeMessages();
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role !== 'assistant') return false;
    if (this.agent) this.agent.state.messages = messages.slice(0, -1);
    return true;
  }

  private async removeLastRuntimeAssistantError(): Promise<boolean> {
    const messages = await this.getRuntimeMessages();
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role !== 'assistant' || lastMessage.stopReason !== 'error') return false;
    if (this.agent) this.agent.state.messages = messages.slice(0, -1);
    return true;
  }

  // ---------- 内部：Agent runtime 构建 ----------

  private rebuildToolRegistry(modelOverride?: Model<Api>): void {
    const model = modelOverride ?? this.agent?.state.model ?? this.configManager.findDefaultModel();
    const readOptions = { isVisionModel: () => model?.input.includes('image') ?? false };
    const builtinEntries = createBuiltinToolDefinitionEntries(
      this.cwd,
      Array.from(ALL_TOOL_NAMES),
      { read: readOptions },
    );
    const registry = new Map<string, ToolRegistryEntry>();

    for (const entry of builtinEntries) {
      const tool = wrapToolDefinition(entry.definition);
      registry.set(entry.definition.name, {
        definition: entry.definition,
        tool,
        sourceInfo: entry.sourceInfo,
        sourceType: 'builtin',
      });
    }

    if (this.extensionRunner) {
      const runner = this.extensionRunner;
      const registeredTools = this.extensionRunner.getAllRegisteredTools();
      for (const registered of registeredTools) {
        const tool = wrapToolDefinition(registered.definition, () => runner.createContext());
        registry.set(registered.definition.name, {
          definition: registered.definition,
          tool,
          sourceInfo: registered.sourceInfo,
          sourceType: 'extension',
        });
      }
    }

    this.toolRegistry = registry;
    this.toolRegistryVersion += 1;
  }

  private normalizeActiveToolNames(options?: {
    previousRegistryNames?: Set<string>;
    includeAllExtensionTools?: boolean;
  }): void {
    const extensionTools = [...this.toolRegistry.values()]
      .filter((entry) => entry.sourceType === 'extension')
      .map((entry) => entry.tool.name);

    if (!this.activeToolsCustomized) {
      const defaults = DEFAULT_ACTIVE_TOOL_NAMES.filter((name) => this.toolRegistry.has(name));
      this.activeToolNames = [...new Set([...defaults, ...extensionTools])];
      return;
    }

    const nextActiveToolNames = this.activeToolNames.filter((name) => this.toolRegistry.has(name));
    if (options?.includeAllExtensionTools) {
      nextActiveToolNames.push(...extensionTools);
    } else if (options?.previousRegistryNames) {
      nextActiveToolNames.push(
        ...extensionTools.filter((name) => !options.previousRegistryNames?.has(name)),
      );
    }
    this.activeToolNames = [...new Set(nextActiveToolNames)];
  }

  private getActiveTools(): AgentTool[] {
    return this.activeToolNames
      .map((name) => this.toolRegistry.get(name)?.tool)
      .filter((tool): tool is AgentTool => tool !== undefined);
  }

  private getAllTools(): AgentTool[] {
    return [...this.toolRegistry.values()].map((entry) => entry.tool);
  }

  private applyToolsToAgent(): void {
    if (this.agent) {
      this.agent.state.tools = this.getActiveTools();
    }
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

  private async preparePromptInput(
    text: string,
    images: ImageContent[] | undefined,
    source: 'interactive' | 'rpc' | 'extension',
  ): Promise<{ text: string; images?: ImageContent[] } | undefined> {
    const runner = this.extensionRunner;
    if (!runner?.hasHandlers?.('input')) {
      return { text: this.expandPromptCommands(text), images };
    }

    const result = await runner.emitInput(text, images, source);
    if (result.action === 'handled') {
      return undefined;
    }
    if (result.action === 'transform') {
      return { text: this.expandPromptCommands(result.text), images: result.images };
    }
    return { text: this.expandPromptCommands(text), images };
  }

  private async prepareAgentStartMessages(
    input: string | AgentMessage,
    images: ImageContent[] | undefined,
    promptTextOverride?: string,
  ): Promise<AgentMessage[]> {
    const promptText =
      promptTextOverride ??
      (typeof input === 'string' ? input : 'content' in input ? input.content : '');
    const baseMessages =
      typeof input === 'string' ? [this.createUserMessage(input, images)] : [input];
    const queuedNextTurnMessages = this.pendingNextTurnMessages.splice(0);
    if (queuedNextTurnMessages.length > 0) {
      this.emit({ type: 'state_change' });
    }

    const agent = this.agent;
    if (!agent) {
      this.pendingNextTurnMessages.unshift(...queuedNextTurnMessages);
      return [...baseMessages, ...queuedNextTurnMessages];
    }

    const systemPrompt = this.buildCurrentSystemPrompt();
    agent.state.systemPrompt = systemPrompt;
    agent.state.tools = this.getActiveTools();

    if (!this.extensionRunner) {
      return [...baseMessages, ...queuedNextTurnMessages];
    }

    try {
      const result = await this.extensionRunner.emitBeforeAgentStart({
        type: 'before_agent_start',
        prompt: Array.isArray(promptText) ? '' : promptText,
        images,
        systemPrompt,
        resources: {
          skills: this.skills,
          promptTemplates: this.promptTemplates,
        },
      });
      if (result?.systemPrompt !== undefined) {
        this.lastSystemPrompt = result.systemPrompt;
        agent.state.systemPrompt = result.systemPrompt;
      }
      return [...baseMessages, ...queuedNextTurnMessages, ...(result?.messages ?? [])];
    } catch (error) {
      this.pendingNextTurnMessages.unshift(...queuedNextTurnMessages);
      if (queuedNextTurnMessages.length > 0) {
        this.emit({ type: 'state_change' });
      }
      throw error;
    }
  }

  private async tryExecuteExtensionCommand(text: string): Promise<boolean> {
    if (!text.startsWith('/') || !this.extensionRunner) return false;

    const spaceIndex = text.search(/\s/);
    const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    const args = spaceIndex === -1 ? '' : text.slice(spaceIndex + 1);
    if (!commandName || commandName.startsWith('skill:')) return false;

    const getCommand = (
      this.extensionRunner as {
        getCommand?: (name: string) => RegisteredCommand | undefined;
      }
    ).getCommand;
    const command = getCommand?.call(this.extensionRunner, commandName);
    if (!command) return false;

    try {
      await command.handler(args, this.extensionRunner.createCommandContext());
    } catch (error) {
      this.extensionRunner.emitError({
        extensionPath: `command:${commandName}`,
        event: 'command',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
    return true;
  }

  private throwIfExtensionCommand(text: string): void {
    if (!text.startsWith('/') || !this.extensionRunner) return;

    const spaceIndex = text.search(/\s/);
    const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    if (!commandName || commandName.startsWith('skill:')) return;

    const getCommand = (
      this.extensionRunner as {
        getCommand?: (name: string) => RegisteredCommand | undefined;
      }
    ).getCommand;
    const command = getCommand?.call(this.extensionRunner, commandName);
    if (!command) return;

    throw new Error(
      `Extension command "/${commandName}" cannot be queued. Use prompt() or execute the command when not streaming.`,
    );
  }

  private expandPromptCommands(text: string): string {
    const skillExpanded = this.expandSkillCommand(text);
    return this.expandPromptTemplateCommand(skillExpanded);
  }

  private expandSkillCommand(text: string): string {
    if (!text.startsWith('/skill:')) return text;

    const spaceIndex = text.search(/\s/);
    const skillName =
      spaceIndex === -1 ? text.slice('/skill:'.length) : text.slice('/skill:'.length, spaceIndex);
    const additionalInstructions = spaceIndex === -1 ? '' : text.slice(spaceIndex + 1).trim();
    const skill = this.skills.find((candidate) => candidate.name === skillName);
    if (!skill) return text;

    try {
      const content = readFileSync(skill.filePath, 'utf-8');
      const body = stripFrontmatter(content).trim();
      const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
      return additionalInstructions ? `${skillBlock}\n\n${additionalInstructions}` : skillBlock;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.appendLine(`[scout] Skill expansion failed (${skill.filePath}): ${errorMessage}`);
      return text;
    }
  }

  private expandPromptTemplateCommand(text: string): string {
    if (!text.startsWith('/')) return text;

    const withoutSlash = text.slice(1);
    const spaceIndex = withoutSlash.search(/\s/);
    const templateName = spaceIndex === -1 ? withoutSlash : withoutSlash.slice(0, spaceIndex);
    const argsString = spaceIndex === -1 ? '' : withoutSlash.slice(spaceIndex + 1);
    if (!templateName || templateName.startsWith('skill:')) return text;

    const template = this.getPromptTemplates().find((candidate) => candidate.name === templateName);
    if (!template) return text;

    return formatPromptTemplateInvocation(template, parseCommandArgs(argsString));
  }

  private getPromptTemplates(): PromptTemplate[] {
    return [...this.promptTemplates];
  }

  private async findLastAssistantMessage(): Promise<AssistantMessage | undefined> {
    const messages = await this.getRuntimeMessages();
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message?.role === 'assistant') return message as AssistantMessage;
    }
    return undefined;
  }

  private async runPrePromptCompaction(policy: QueueContinuationPolicy = {}): Promise<void> {
    if (!this.agent) return;
    const lastAssistant = await this.findLastAssistantMessage();
    if (!lastAssistant) return;
    const shouldContinue = await this.checkCompaction(lastAssistant, false, policy);
    if (!shouldContinue) return;

    this._isStreaming = true;
    this.emit({ type: 'state_change' });
    await this.agent.continue(policy);
    await this.runPostAgentLoop(policy);
  }

  private createUserMessage(text: string, images?: ImageContent[]): AgentMessage {
    const content: Array<TextContent | ImageContent> = [{ type: 'text', text }];
    if (images) content.push(...images);
    return { role: 'user', content, timestamp: Date.now() };
  }

  private createCustomMessageFromInput<TDetails = unknown>(
    message: SendMessageInput<TDetails>,
  ): { customMessage: CustomMessage<TDetails> } {
    const payload =
      typeof message === 'string'
        ? { customType: EXTENSION_MESSAGE_CUSTOM_TYPE, content: message, display: true }
        : message;
    const display = payload.display ?? true;
    return {
      customMessage: createCustomMessage(
        payload.customType,
        payload.content,
        display,
        payload.details,
        new Date().toISOString(),
      ) as CustomMessage<TDetails>,
    };
  }

  private queueAgentMessage(message: AgentMessage, deliverAs: QueuedAgentMessageDelivery): void {
    this.queuedMessages.queue(this.agent, message, deliverAs);
    this.emit({ type: 'queue_change' });
  }

  private clearQueuedAgentMessages(): void {
    if (!this.queuedMessages.clearAll(this.agent)) return;
    this.emit({ type: 'queue_change' });
  }

  private async appendCustomMessageWithLifecycle(message: CustomMessage): Promise<void> {
    await this.session.appendCustomMessageEntry(
      message.customType,
      message.content,
      message.display,
      message.details,
    );
    this.appendRuntimeMessage(message);
    await this.rebuildCachedSessionBranch();
    this.emit({ type: 'state_change' });
    this.emit({ type: 'tree_change' });
  }

  private async promptCustomMessage(message: CustomMessage): Promise<void> {
    if (!this.agent) return;

    this.retryAttempt = 0;

    try {
      this.queuedMessages.resumeFollowUps();
      this._isStreaming = true;
      this.emit({ type: 'state_change' });
      const messages = await this.prepareAgentStartMessages(message, undefined);
      await this.agent.prompt(messages);
      await this.runPostAgentLoop();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.appendLine(`[scout] Custom prompt error: ${errorMessage}`);
      this._isStreaming = false;
      this.emit({ type: 'error', message: errorMessage });
    }
  }

  /** 重建 Agent runtime（initialize/fork/resume 复用） */
  private async rebuildRuntime(): Promise<void> {
    const context = await this.session.buildContext();
    const branch = await this.session.getBranch();
    const hasThinkingEntry = branch.some((entry) => entry.type === 'thinking_level_change');
    const hasRestorableSessionState =
      context.messages.length > 0 || context.model !== null || hasThinkingEntry;
    let model: Model<Api> | undefined;
    if (context.model) {
      const restoredModel = this.configManager.findModelByProvider(
        context.model.provider,
        context.model.modelId,
      );
      if (restoredModel && this.configManager.hasConfiguredModelAuth(restoredModel)) {
        model = restoredModel;
      }
    }
    if (!model) {
      const initialModelAvailable =
        this.initialModel && this.configManager.hasConfiguredModelAuth(this.initialModel);
      model = initialModelAvailable ? this.initialModel : this.configManager.findDefaultModel();
    }
    if (!model) {
      this.emit({ type: 'error', message: 'No model available.' });
      return;
    }

    const storedThinkingLevel = hasThinkingEntry
      ? (context.thinkingLevel as ThinkingLevel)
      : (this.initialThinkingLevel ??
        this.configManager.getDefaultThinkingLevel() ??
        DEFAULT_REASONING_THINKING_LEVEL);
    const thinkingLevel = normalizeThinkingLevelForModel(model, storedThinkingLevel);
    await this.persistInitialSessionState({
      hasRestorableSessionState,
      hasThinkingEntry,
      model,
      storedThinkingLevel,
      thinkingLevel,
    });
    this.rebuildToolRegistry(model);
    this.normalizeActiveToolNames({
      includeAllExtensionTools: this.includeAllExtensionToolsOnInitialize,
    });
    this.includeAllExtensionToolsOnInitialize = false;
    this.lastSystemPrompt = this.buildCurrentSystemPrompt();

    this.unsubscribeAgent?.();
    this.agent?.abort();
    this.queuedMessages.reset();
    this.agent = this.createAgent({
      messages: context.messages,
      model,
      thinkingLevel,
      tools: this.getActiveTools(),
      sessionId: (await this.session.getMetadata()).id,
    });
    this.unsubscribeAgent = this.agent.subscribe((event, signal) =>
      this.handleAgentEvent(event, signal),
    );
  }

  private async persistInitialSessionState(options: {
    hasRestorableSessionState: boolean;
    hasThinkingEntry: boolean;
    model: Model<Api>;
    storedThinkingLevel: ThinkingLevel;
    thinkingLevel: ThinkingLevel;
  }): Promise<void> {
    if (options.hasRestorableSessionState) {
      if (!options.hasThinkingEntry || options.storedThinkingLevel !== options.thinkingLevel) {
        await this.session.appendThinkingLevelChange(options.thinkingLevel);
      }
      return;
    }

    await this.session.appendModelChange(options.model.provider, options.model.id);
    await this.session.appendThinkingLevelChange(options.thinkingLevel);
  }

  private createAgent(options: {
    messages: AgentMessage[];
    model: Model<Api>;
    thinkingLevel: ThinkingLevel;
    tools: AgentTool[];
    sessionId: string;
  }): Agent {
    const agent = new Agent({
      initialState: {
        messages: options.messages,
        model: options.model,
        thinkingLevel: options.thinkingLevel,
        tools: options.tools,
        systemPrompt: this.lastSystemPrompt,
      },
      convertToLlm,
      transformContext: async (messages) => {
        if (!this.extensionRunner) return messages;
        return await this.extensionRunner.emitContext(messages);
      },
      streamFn: this.createAgentStreamFn(),
      beforeToolCall: (context, signal) => this.handleBeforeToolCall(context, signal),
      afterToolCall: (context, signal) => this.handleAfterToolCall(context, signal),
      prepareNextTurn: () => this.prepareAgentNextTurn(),
      steeringMode: this.configManager.getSteeringMode(),
      followUpMode: this.configManager.getFollowUpMode(),
      sessionId: options.sessionId,
      transport: this.configManager.getStreamOptions().transport,
      thinkingBudgets: this.configManager.getStreamOptions().thinkingBudgets,
      maxRetryDelayMs: this.configManager.getStreamOptions().maxRetryDelayMs,
    });
    return agent;
  }

  private createAgentStreamFn(): StreamFn {
    return async (model, context, streamOptions) => {
      const auth = await this.getApiKeyAndHeaders(model);
      const metadata = await this.session.getMetadata();
      const configuredOptions = cloneStreamOptions(this.configManager.getStreamOptions());
      const requestOptions: ScoutStreamOptions = {
        ...configuredOptions,
        headers: mergeHeaders(configuredOptions.headers, auth?.headers),
      };

      return streamSimple(model, context, {
        ...streamOptions,
        cacheRetention: requestOptions.cacheRetention,
        headers: requestOptions.headers,
        maxRetries: requestOptions.maxRetries,
        maxRetryDelayMs: requestOptions.maxRetryDelayMs,
        metadata: requestOptions.metadata,
        onPayload: async (payload) =>
          this.extensionRunner
            ? await this.extensionRunner.emitBeforeProviderRequest(payload)
            : payload,
        onResponse: async (response) => {
          const headers = { ...(response.headers as Record<string, string>) };
          await this.extensionRunner?.emitAfterProviderResponse({
            type: 'after_provider_response',
            status: response.status,
            headers,
          });
        },
        reasoning: streamOptions?.reasoning,
        signal: streamOptions?.signal,
        sessionId: metadata.id,
        thinkingBudgets: requestOptions.thinkingBudgets,
        timeoutMs: requestOptions.timeoutMs,
        transport: requestOptions.transport,
        websocketConnectTimeoutMs: requestOptions.websocketConnectTimeoutMs,
        apiKey: auth?.apiKey,
      });
    };
  }

  private async handleBeforeToolCall(
    context: BeforeToolCallContext,
    _signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> {
    if (!this.extensionRunner) return undefined;
    const input =
      typeof context.args === 'object' && context.args !== null
        ? (context.args as Record<string, unknown>)
        : {};
    const result = await this.extensionRunner.emitToolCall({
      type: 'tool_call',
      toolCallId: context.toolCall.id,
      toolName: context.toolCall.name,
      input,
    });
    if (!result) return undefined;
    return { block: result.block, reason: result.reason };
  }

  private async handleAfterToolCall(
    context: AfterToolCallContext,
    _signal?: AbortSignal,
  ): Promise<AfterToolCallResult | undefined> {
    const reviewResult = await this.captureFileReviewResult(context);
    if (!this.extensionRunner) return reviewResult;

    const hookResult = await this.extensionRunner.emitToolResult({
      type: 'tool_result',
      toolCallId: context.toolCall.id,
      toolName: context.toolCall.name,
      input:
        typeof context.args === 'object' && context.args !== null
          ? ({ ...(context.args as Record<string, unknown>) } as Record<string, unknown>)
          : {},
      content: reviewResult?.content ?? context.result.content,
      details: reviewResult?.details ?? context.result.details,
      isError: reviewResult?.isError ?? context.isError,
    });
    if (!hookResult) return reviewResult;
    return {
      content: hookResult.content ?? reviewResult?.content,
      details: hookResult.details ?? reviewResult?.details,
      isError: hookResult.isError ?? reviewResult?.isError,
      terminate: reviewResult?.terminate,
    };
  }

  private startFileReviewRun(): void {
    this.currentReviewRunId = createReviewRunId();
  }

  private getCurrentFileReviewTurnId(): string {
    return `${this.sessionId || 'session'}:${this.currentReviewRunId}`;
  }

  private captureFileReviewResult(
    context: AfterToolCallContext,
  ): Promise<AfterToolCallResult | undefined> {
    if (context.isError || !isFileReviewPayload(context.result.details)) {
      return Promise.resolve(undefined);
    }
    return this.captureFileReviewPayload(context);
  }

  private async captureFileReviewPayload(
    context: AfterToolCallContext,
  ): Promise<AfterToolCallResult | undefined> {
    if (!isFileReviewPayload(context.result.details)) return undefined;
    const turnId = this.getCurrentFileReviewTurnId();
    const details = this.fileReviewStore.addRecord(
      turnId,
      context.toolCall.id,
      context.result.details,
    );
    this.emitFileReviewUpdated(turnId);
    return { details };
  }

  private emitFileReviewUpdated(turnId: string): void {
    if (!this.onFileReviewUpdated) return;
    const review = this.fileReviewStore.getTurn(turnId);
    if (!review) return;
    try {
      this.onFileReviewUpdated(this, review);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.appendLine(`[scout] Failed to schedule changes review artifact: ${message}`);
    }
  }

  private async prepareAgentNextTurn(): Promise<AgentLoopTurnUpdate> {
    const agent = this.agent;
    const model = agent?.state.model;
    if (!agent || !model) return {};
    const thinkingLevel = agent.state.thinkingLevel;
    const tools = this.getActiveTools();
    const systemPrompt = this.buildDynamicSystemPrompt(tools);
    this.lastSystemPrompt = systemPrompt;
    agent.state.systemPrompt = systemPrompt;
    agent.state.model = model;
    agent.state.thinkingLevel = thinkingLevel;
    agent.state.tools = tools;
    return {
      context: {
        systemPrompt,
        messages: agent.state.messages.slice(),
        tools,
      },
      model,
      thinkingLevel,
    };
  }

  // ---------- 内部：事件处理 ----------

  private async handleAgentEvent(event: AgentEvent, signal?: AbortSignal): Promise<void> {
    const finalizedEvent = await this.finalizeAgentEvent(event);
    const enrichedEvent = this.enrichAgentEndEvent(finalizedEvent);

    await this.emitExtensionLifecycleEvent(enrichedEvent);

    this.emit({ type: 'agent_event', event: enrichedEvent });

    const type = (enrichedEvent as { type: string }).type;

    if (type === 'queue_update') {
      this.emit({ type: 'queue_change' });
    }

    if (type === 'message_start') {
      const msg = (enrichedEvent as { message?: AgentMessage }).message;
      if (msg?.role === 'user') {
        this.overflowRecoveryAttempted = false;
      }
    }

    if (type === 'agent_start') {
      this.startFileReviewRun();
      this.emit({ type: 'state_change' });
    }

    if (type === 'message_end') {
      const message = (enrichedEvent as { message?: AgentMessage }).message;
      if (message) {
        await this.persistAgentMessage(message);
        await this.rebuildCachedSessionBranch();
        this.acceptPromptMessage(message);
      }
      if (message?.role === 'assistant') {
        this.lastAssistantMessage = message as AssistantMessage;
      }
      this.emit({ type: 'state_change' });
      if (message) {
        this.emit({ type: 'tree_change' });
      }
    }

    if (type === 'turn_end') {
      this.emit({ type: 'state_change' });
    }

    if (type === 'agent_end') {
      await this.rebuildCachedSessionBranch();
      this.emit({ type: 'state_change' });
    }

    if (signal?.aborted) {
      this.emit({ type: 'state_change' });
    }
  }

  private async finalizeAgentEvent(event: AgentEvent): Promise<AgentEvent> {
    if (event.type !== 'message_end' || !this.extensionRunner) return event;
    const replacement = await this.extensionRunner.emitMessageEnd({
      type: 'message_end',
      message: event.message,
    });
    if (!replacement) return event;
    if (replacement.role !== event.message.role) {
      throw new Error(
        `message_end replacement role mismatch: ${replacement.role}，期望 ${event.message.role}`,
      );
    }
    this.replaceMessageInPlace(event.message, replacement);
    return event;
  }

  private replaceMessageInPlace(target: AgentMessage, replacement: AgentMessage): void {
    if (target === replacement) return;
    const targetRecord = target as unknown as Record<string, unknown>;
    for (const key of Object.keys(targetRecord)) {
      delete targetRecord[key];
    }
    Object.assign(targetRecord, replacement);
  }

  private async persistAgentMessage(message: AgentMessage): Promise<void> {
    if (message.role === 'custom') {
      const customMessage = message as CustomMessage;
      await this.session.appendCustomMessageEntry(
        customMessage.customType,
        customMessage.content,
        customMessage.display,
        customMessage.details,
      );
      return;
    }
    await this.session.appendMessage(message);
  }

  private enrichAgentEndEvent(event: AgentEvent): AgentEvent & { willRetry?: boolean } {
    if ((event as { type: string }).type !== 'agent_end') return event;
    const agentEnd = event as Extract<AgentEvent, { type: 'agent_end' }>;
    return {
      ...agentEnd,
      willRetry: this.willRetryAfterAgentEnd(agentEnd),
    };
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

  private async emitExtensionLifecycleEvent(
    event: AgentEvent & { willRetry?: boolean },
  ): Promise<void> {
    if (!this.extensionRunner) return;
    const runner = this.extensionRunner;
    const type = (event as { type: string }).type;

    if (type === 'agent_start') {
      this.turnIndex = 0;
      await runner.emit({ type: 'agent_start' });
    } else if (type === 'agent_end') {
      await runner.emit({
        type: 'agent_end',
        messages: (event as { messages: AgentMessage[] }).messages,
      });
    } else if (type === 'turn_start') {
      await runner.emit({ type: 'turn_start', turnIndex: this.turnIndex, timestamp: Date.now() });
    } else if (type === 'turn_end') {
      const turnEnd = event as { message: AgentMessage; toolResults: ToolResultMessage[] };
      await runner.emit({
        type: 'turn_end',
        turnIndex: this.turnIndex,
        message: turnEnd.message,
        toolResults: turnEnd.toolResults,
      });
      this.turnIndex++;
    } else if (type === 'message_start') {
      await runner.emit({
        type: 'message_start',
        message: (event as { message: AgentMessage }).message,
      });
    } else if (type === 'message_update') {
      const messageUpdate = event as {
        message: AgentMessage;
        assistantMessageEvent: AssistantMessageEvent;
      };
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
    }
  }

  // ---------- 内部：Compaction ----------

  private async runCompactionCore(options: {
    signal: AbortSignal;
    settings: ReturnType<ScoutCoreConfig['getCompactionSettings']>;
    customInstructions?: string;
    branchEntries?: SessionTreeEntry[];
    preparation?: CompactionPreparation;
  }): Promise<CompactionResult> {
    if (options.signal.aborted) throw new Error('Compaction aborted');
    const model = this.agent?.state.model;
    if (!model) throw new Error('No model set for compaction');
    const auth = await this.getApiKeyAndHeaders(model);
    if (!auth) throw new Error('No auth available for compaction');

    const branchEntries = options.branchEntries ?? (await this.session.getBranch());
    const preparation = options.preparation ?? prepareCompaction(branchEntries, options.settings);
    if (!preparation) throw new Error('Nothing to compact');

    const hookResult = await this.extensionRunner?.emitSessionBeforeCompact({
      type: 'session_before_compact',
      preparation,
      branchEntries,
      customInstructions: options.customInstructions,
      signal: options.signal,
    });
    if (hookResult?.cancel) throw new Error('Compaction cancelled');
    if (options.signal.aborted) throw new Error('Compaction aborted');

    const provided = hookResult?.compaction;
    const result = provided
      ? provided
      : await compactPreparedSession(
          preparation,
          model,
          auth.apiKey,
          auth.headers,
          options.customInstructions,
          options.signal,
          this.agent?.state.thinkingLevel,
          this.agent?.streamFn,
        );
    if (options.signal.aborted) throw new Error('Compaction aborted');

    const entryId = await this.session.appendCompaction(
      result.summary,
      result.firstKeptEntryId,
      result.tokensBefore,
      result.details,
      provided !== undefined,
    );
    const entry = await this.session.getEntry(entryId);
    if (entry?.type === 'compaction') {
      await this.extensionRunner?.emit({
        type: 'session_compact',
        compactionEntry: entry,
        fromHook: provided !== undefined,
        fromExtension: provided !== undefined,
      });
    }

    return result;
  }

  private async checkCompaction(
    assistantMessage: AssistantMessage,
    skipAbortedCheck = true,
    policy: QueueContinuationPolicy = {},
  ): Promise<boolean> {
    if (!this.agent) return false;
    const settings = this.configManager.getCompactionSettings();
    if (!settings.enabled) return false;
    if (skipAbortedCheck && assistantMessage.stopReason === 'aborted') return false;

    const model = this.agent.state.model;
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
      const messages = await this.getRuntimeMessages();
      const estimate = estimateContextTokens(messages);
      // 无任何 usage 数据时无法判断，跳过
      if (estimate.lastUsageIndex === null) return false;
      // 验证 usage source 在最近 compaction 之后（防止 compaction 后误触发）
      if (latestCompaction !== null) {
        const usageMsg = messages[estimate.lastUsageIndex] as AssistantMessage | undefined;
        if (usageMsg && usageMsg.timestamp <= new Date(latestCompaction.timestamp).getTime()) {
          return false;
        }
      }
      contextTokens = estimate.tokens;
    } else {
      contextTokens = calculateContextTokens(assistantMessage.usage);
    }

    if (shouldCompact(contextTokens, contextWindow, settings)) {
      return await this.runAutoCompaction('threshold', false, policy);
    }
    return false;
  }

  /**
   * agent_end 后统一处理 retry / compaction 决策。
   * 对齐 Pi 的 _handlePostAgentRun() 模式：
   *   1. 若 retry 触发 → 直接 return（跳过 compaction，retry 成功后再判断）
   *   2. 若 retry 超限 → 发出 auto_retry_end(success=false)，再做 compaction 检查
   *   3. 若 retry 成功 → 发出 auto_retry_end(success=true)，再做 compaction 检查
   *   4. 无 retry → 直接做 compaction 检查
   */
  private async handlePostAgentEnd(policy: QueueContinuationPolicy = {}): Promise<boolean> {
    const assistant = this.lastAssistantMessage;
    this.lastAssistantMessage = undefined;

    if (!assistant) return false;

    // Context overflow recovery must run after agent_end: the overflow message has been
    // persisted and the agent is idle, so removing it and compacting can succeed.
    if (this.isContextOverflowError(assistant)) {
      if (this.overflowRecoveryAttempted) {
        // 已尝试过一次 compact-and-retry 仍然 overflow，停止重试防止无限循环
        this.logger.appendLine(
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
      // 保留持久 session history，只清理本次自动恢复 runtime context 中的 overflow assistant error。
      await this.removeLastRuntimeAssistantMessage();
      return await this.runAutoCompaction('overflow', true, policy);
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
      // 问题 F fix：retry 成功时先发送 auto_retry_end，再做 compaction 检查
      this.emitAutoRetryEnd(true, this.retryAttempt);
      this.retryAttempt = 0;
      // 成功后继续做 compaction 检查（继续往下执行）
    }

    // 阈值压缩检查（非 retry 触发时执行）
    return await this.checkCompaction(assistant, true, policy);
  }

  private async runPostAgentLoop(policy: QueueContinuationPolicy = {}): Promise<void> {
    if (!this.lastAssistantMessage) {
      this._isStreaming = false;
      this.emit({ type: 'state_change' });
      return;
    }

    this.isPostAgentProcessing = true;
    this._isStreaming = true;
    this.emit({ type: 'state_change' });

    try {
      while (await this.handlePostAgentEnd(policy)) {
        if (!this.agent) return;
        try {
          this._isStreaming = true;
          this.emit({ type: 'state_change' });
          await this.agent.continue(policy);
        } catch (error) {
          this.logger.appendLine(
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
      await this.flushPendingBashMessages();
      this.emit({ type: 'state_change' });
    }
  }

  private async runAutoCompaction(
    reason: CompactionReason,
    willRetry = false,
    policy: QueueContinuationPolicy = {},
  ): Promise<boolean> {
    if (!this.agent) return false;
    const abortController = new AbortController();
    this.autoCompactionAbortController = abortController;
    this.emit({ type: 'compaction_start', reason });
    try {
      this.logger.appendLine(`[scout] Running auto compaction: ${reason}`);
      const result = await this.runCompactionCore({
        signal: abortController.signal,
        settings: this.configManager.getCompactionSettings(),
      });
      await this.syncRuntimeMessagesFromSession();
      if (willRetry) {
        // compact 会从 session 重建运行态；本次 retry 前再次清理尾部 error，保持 Pi runtime 语义。
        await this.removeLastRuntimeAssistantError();
      }
      await this.rebuildCachedSessionBranch();
      this.emit({
        type: 'compaction_end',
        reason,
        result,
        aborted: false,
        willRetry,
      });
      this.emit({ type: 'state_change' });
      this.emit({ type: 'tree_change' });

      if (willRetry) {
        this.logger.appendLine('[scout] Retrying after overflow compaction');
        return true;
      }
      return this.hasContinuationPendingMessages(policy);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const aborted = abortController.signal.aborted;
      this.logger.appendLine(`[scout] Compaction failed: ${errorMessage}`);
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

    const model = this.agent?.state.model;
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

    // 保留持久 session history，只清理本次自动重试 runtime context 中的失败 assistant error。
    await this.removeLastRuntimeAssistantMessage();

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
  }

  private emitAutoRetryEnd(success: boolean, attempt: number, finalError?: string): void {
    this.emit({ type: 'auto_retry_end', success, attempt, finalError });
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
      }
      if (tool.promptGuidelines) {
        toolGuidelines.push(...tool.promptGuidelines);
      }
    }

    const appendSystemPrompt =
      this.resourceAppendSystemPrompt.length > 0
        ? this.resourceAppendSystemPrompt.join('\n\n')
        : undefined;

    return buildSystemPrompt({
      customPrompt: this.resourceSystemPrompt,
      selectedTools: activeTools.map((t) => t.name),
      toolSnippets,
      promptGuidelines: toolGuidelines,
      appendSystemPrompt,
      cwd: this.cwd,
      skills: this.skills,
      contextFiles: this.contextFiles,
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
