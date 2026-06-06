// ============================================================
// 扩展系统类型定义
// Lifecycle 语义以 Pi extension API 为唯一来源。
// ============================================================

import type { Model, ImageContent, TextContent, AssistantMessageEvent } from '@scout-agent/ai';
import type {
  AgentMessage,
  AgentHarnessResources,
  AgentToolResult,
  AgentToolUpdateCallback,
  BranchSummaryEntry,
  CompactionEntry,
  JsonlSessionMetadata,
  Skill,
  PromptTemplate,
  ThinkingLevel,
  ToolExecutionMode,
} from '@scout-agent/agent';
import type {
  CompactionPreparation,
  SessionTreeEntry,
  TreePreparation,
  CompactResult,
} from '@scout-agent/agent';
import type { ScoutContextUsage } from '@scout-agent/shared';
import type { Static, TSchema } from '@sinclair/typebox';
import type { EventBus } from './event-bus.ts';
import type { ConfigManager } from '../config-manager.ts';
import type { SessionManager } from '../session-manager.ts';
import type { SourceInfo } from '../source-info.ts';

// ---------- 扩展工具定义 ----------

/**
 * 扩展注册的工具定义。
 * 相比 AgentTool，execute 接收额外的 ScoutExtensionContext 参数。
 */
export interface ScoutToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown> {
  name: string;
  label: string;
  description: string;
  parameters: TParams;
  promptSnippet?: string;
  promptGuidelines?: string[];
  prepareArguments?: (args: unknown) => Static<TParams>;
  executionMode?: ToolExecutionMode;
  execute: (
    toolCallId: string,
    params: Static<TParams>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
    ctx?: ScoutExtensionContext,
  ) => Promise<AgentToolResult<TDetails>>;
}

// ---------- 事件类型 ----------

export type InputSource = 'interactive' | 'rpc' | 'extension';
export type ModelSelectSource = 'set' | 'cycle' | 'restore';

/** 扩展可监听的所有事件类型字符串。 */
export type ScoutExtensionEventType =
  | 'resources_discover'
  | 'session_start'
  | 'session_before_switch'
  | 'session_before_fork'
  | 'session_before_compact'
  | 'session_compact'
  | 'session_shutdown'
  | 'session_before_tree'
  | 'session_tree'
  | 'context'
  | 'before_provider_request'
  | 'after_provider_response'
  | 'before_agent_start'
  | 'agent_start'
  | 'agent_end'
  | 'turn_start'
  | 'turn_end'
  | 'message_start'
  | 'message_update'
  | 'message_end'
  | 'tool_execution_start'
  | 'tool_execution_update'
  | 'tool_execution_end'
  | 'model_select'
  | 'thinking_level_select'
  | 'user_bash'
  | 'input'
  | 'tool_call'
  | 'tool_result';

// ---------- 事件定义 ----------

export interface ResourcesDiscoverEvent {
  type: 'resources_discover';
  cwd: string;
  reason: 'startup' | 'reload';
}

export interface BeforeAgentStartEvent {
  type: 'before_agent_start';
  prompt: string;
  images?: ImageContent[];
  systemPrompt: string;
  resources?: AgentHarnessResources<Skill, PromptTemplate>;
}

export interface ContextEvent {
  type: 'context';
  messages: AgentMessage[];
}

export interface BeforeProviderRequestEvent {
  type: 'before_provider_request';
  payload: unknown;
}

export interface AfterProviderResponseEvent {
  type: 'after_provider_response';
  status: number;
  headers: Record<string, string>;
}

export interface SessionBeforeCompactEvent {
  type: 'session_before_compact';
  preparation: CompactionPreparation;
  branchEntries: SessionTreeEntry[];
  customInstructions?: string;
  signal: AbortSignal;
}

export interface SessionBeforeTreeEvent {
  type: 'session_before_tree';
  preparation: TreePreparation;
  signal: AbortSignal;
}

export interface SessionCompactEvent {
  type: 'session_compact';
  compactionEntry: CompactionEntry;
  fromExtension?: boolean;
  /** Harness-native spelling. */
  fromHook?: boolean;
}

export interface SessionTreeEvent {
  type: 'session_tree';
  newLeafId: string | null;
  oldLeafId: string | null;
  summaryEntry?: BranchSummaryEntry;
  fromExtension?: boolean;
  /** Harness-native spelling. */
  fromHook?: boolean;
}

export interface SessionBeforeForkEvent {
  type: 'session_before_fork';
  entryId: string;
  position: 'before' | 'at';
}

export interface SessionBeforeSwitchEvent {
  type: 'session_before_switch';
  reason: 'new' | 'resume';
  targetSessionFile?: string;
}

export interface SessionShutdownEvent {
  type: 'session_shutdown';
  reason?: 'new' | 'resume' | 'fork' | 'quit' | 'reload';
  targetSessionFile?: string;
}

export interface SessionStartEvent {
  type: 'session_start';
  reason: 'startup' | 'new' | 'resume' | 'fork' | 'reload';
  previousSessionFile?: string;
}

export interface AgentStartEvent {
  type: 'agent_start';
}

export interface AgentEndEvent {
  type: 'agent_end';
  messages: AgentMessage[];
  willRetry: boolean;
}

export interface TurnStartEvent {
  type: 'turn_start';
  turnIndex?: number;
  timestamp?: number;
}

export interface TurnEndEvent {
  type: 'turn_end';
  turnIndex?: number;
  message: AgentMessage;
  toolResults: AgentMessage[];
}

export interface MessageStartEvent {
  type: 'message_start';
  message: AgentMessage;
}

export interface MessageUpdateEvent {
  type: 'message_update';
  message: AgentMessage;
  assistantMessageEvent: AssistantMessageEvent;
}

export interface MessageEndEvent {
  type: 'message_end';
  message: AgentMessage;
}

export interface ToolExecutionStartEvent {
  type: 'tool_execution_start';
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolExecutionUpdateEvent {
  type: 'tool_execution_update';
  toolCallId: string;
  toolName: string;
  args: unknown;
  partialResult: unknown;
}

export interface ToolExecutionEndEvent {
  type: 'tool_execution_end';
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

export interface ModelSelectEvent {
  type: 'model_select';
  model: Model<any>;
  previousModel: Model<any> | undefined;
  source: ModelSelectSource;
}

export interface ThinkingLevelSelectEvent {
  type: 'thinking_level_select';
  level: ThinkingLevel;
  previousLevel: ThinkingLevel;
}

export interface UserBashEvent {
  type: 'user_bash';
  command: string;
  excludeFromContext: boolean;
  cwd: string;
}

export interface InputEvent {
  type: 'input';
  text: string;
  images?: ImageContent[];
  source: InputSource;
}

/**
 * Fired before a tool executes. `input` is mutable: mutate in place to patch
 * arguments before execution. Later handlers observe earlier mutations.
 */
export interface ToolCallEvent {
  type: 'tool_call';
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: 'tool_result';
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  content: Array<TextContent | ImageContent>;
  details: unknown;
  isError: boolean;
}

/** 所有扩展事件联合类型 */
export type ScoutExtensionEvent =
  | ResourcesDiscoverEvent
  | BeforeAgentStartEvent
  | ContextEvent
  | BeforeProviderRequestEvent
  | AfterProviderResponseEvent
  | SessionBeforeCompactEvent
  | SessionCompactEvent
  | SessionBeforeTreeEvent
  | SessionTreeEvent
  | SessionBeforeForkEvent
  | SessionBeforeSwitchEvent
  | SessionShutdownEvent
  | SessionStartEvent
  | AgentStartEvent
  | AgentEndEvent
  | TurnStartEvent
  | TurnEndEvent
  | MessageStartEvent
  | MessageUpdateEvent
  | MessageEndEvent
  | ToolExecutionStartEvent
  | ToolExecutionUpdateEvent
  | ToolExecutionEndEvent
  | ModelSelectEvent
  | ThinkingLevelSelectEvent
  | UserBashEvent
  | InputEvent
  | ToolCallEvent
  | ToolResultEvent;

// ---------- 事件结果 ----------

export interface ResourcesDiscoverResult {
  skillPaths?: string[];
  promptPaths?: string[];
  themePaths?: string[];
}

export interface BeforeAgentStartEventResult {
  message?: AgentMessage;
  systemPrompt?: string;
}

export interface ContextEventResult {
  messages: AgentMessage[];
}

export interface ToolCallEventResult {
  block?: boolean;
  reason?: string;
}

export interface ToolResultEventResult {
  content?: Array<TextContent | ImageContent>;
  details?: unknown;
  isError?: boolean;
}

export type BeforeProviderRequestEventResult = unknown;

export interface MessageEndEventResult {
  message?: AgentMessage;
}

export interface UserBashEventResult {
  operations?: unknown;
  result?: unknown;
}

export type InputEventResult =
  | { action: 'continue' }
  | { action: 'transform'; text: string; images?: ImageContent[] }
  | { action: 'handled' };

export interface SessionBeforeCompactResult {
  cancel?: boolean;
  compaction?: CompactResult;
}

export interface SessionBeforeTreeResult {
  cancel?: boolean;
  summary?: { summary: string; details?: unknown };
  customInstructions?: string;
  replaceInstructions?: boolean;
  label?: string;
}

export interface SessionBeforeForkResult {
  cancel?: boolean;
}

export interface SessionBeforeSwitchResult {
  cancel?: boolean;
}

// ---------- 工具信息 ----------

export type { SourceInfo } from '../source-info.ts';

export interface ToolInfo {
  name: string;
  label?: string;
  description: string;
  parameters: unknown;
  sourceInfo: SourceInfo;
}

export type SlashCommandSource = 'extension' | 'prompt' | 'skill';

export interface SlashCommandInfo {
  name: string;
  description?: string;
  source: SlashCommandSource;
  sourceInfo: SourceInfo;
}

export interface AutocompleteItem {
  value: string;
  label?: string;
  description?: string;
}

export interface ResourceCollision {
  resourceType: 'extension' | 'skill' | 'prompt' | 'theme';
  name: string;
  winnerPath: string;
  loserPath: string;
  winnerSource?: string;
  loserSource?: string;
}

export interface ResourceDiagnostic {
  type: 'warning' | 'error' | 'collision';
  message: string;
  path?: string;
  collision?: ResourceCollision;
}

export interface ScoutExtensionCommandContext extends ScoutExtensionContext {
  waitForIdle(): Promise<void>;
  reload(): Promise<void>;
  navigateTree(
    targetId: string,
    options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    },
  ): Promise<{ cancelled: boolean }>;
}

export interface RegisteredCommand {
  name: string;
  sourceInfo: SourceInfo;
  description?: string;
  getArgumentCompletions?: (
    argumentPrefix: string,
  ) => AutocompleteItem[] | null | Promise<AutocompleteItem[] | null>;
  handler: (args: string, ctx: ScoutExtensionCommandContext) => Promise<void> | void;
}

export interface ResolvedCommand extends RegisteredCommand {
  invocationName: string;
}

export interface SendUserMessageOptions {
  deliverAs?: 'steer' | 'followUp';
}

export interface SendMessageOptions {
  triggerTurn?: boolean;
  deliverAs?: 'steer' | 'followUp' | 'nextTurn';
}

export interface SendMessagePayload<TDetails = unknown> {
  customType: string;
  content: string | (TextContent | ImageContent)[];
  display?: boolean;
  details?: TDetails;
}

export type SendMessageInput<TDetails = unknown> = string | SendMessagePayload<TDetails>;

export const STALE_EXTENSION_CONTEXT_MESSAGE =
  'This extension context is stale after session replacement or reload. Do not use a captured scout API or context after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().';

export interface SessionReplacementOptions {
  withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
}

// ---------- 扩展上下文 ----------

/**
 * 传递给扩展 handler 和 tool execute 的上下文。
 * 值在调用时解析，bindCore 的更新自动反映。
 */
export interface ScoutExtensionContext {
  readonly cwd: string;
  readonly sessionManager: SessionManager;
  readonly configManager: ConfigManager;
  readonly model: Model<any> | undefined;
  isIdle(): boolean;
  readonly signal: AbortSignal | undefined;
  abort(): void;
  getSystemPrompt(): string;
  hasPendingMessages(): boolean;
  compact(): void;
  shutdown(): void;
  /** 切换模型 */
  setModel(modelId: string): Promise<void>;
  /** 切换思考级别 */
  setThinkingLevel(level: string): Promise<void>;
  /** 获取当前上下文 token 用量估算 */
  getContextUsage(): Promise<ScoutContextUsage | undefined>;
  /** Start a new session. Post-replacement work must run inside withSession. */
  newSession(options?: SessionReplacementOptions): Promise<{ cancelled: boolean }>;
  /** Fork from a specific entry into a replacement session. */
  fork(
    entryId: string,
    options?: SessionReplacementOptions & { position?: 'before' | 'at' },
  ): Promise<{ cancelled: boolean }>;
  /** Switch to another session. */
  switchSession(
    sessionMeta: JsonlSessionMetadata,
    options?: SessionReplacementOptions,
  ): Promise<{ cancelled: boolean }>;
}

/**
 * Fresh command-capable context bound to the replacement session after newSession/fork/switchSession.
 */
export interface ReplacedSessionContext extends ScoutExtensionCommandContext {
  sendMessage<TDetails = unknown>(
    message: SendMessageInput<TDetails>,
    options?: SendMessageOptions,
  ): Promise<void>;
  sendUserMessage(
    content: string | (TextContent | ImageContent)[],
    options?: SendUserMessageOptions,
  ): Promise<void>;
}

// ---------- 扩展运行时 ----------

/**
 * 共享运行时状态和动作代理。
 * 创建时所有动作方法为 throwing stub，bindCore() 替换为真实实现。
 */
export interface ScoutExtensionRuntime {
  sendMessage: <TDetails = unknown>(
    message: SendMessageInput<TDetails>,
    options?: SendMessageOptions,
  ) => Promise<void>;
  sendUserMessage: (
    content: string | (TextContent | ImageContent)[],
    options?: SendUserMessageOptions,
  ) => Promise<void>;
  getActiveTools: () => string[];
  getAllTools: () => ToolInfo[];
  setActiveTools: (toolNames: string[]) => Promise<void>;
  refreshTools: () => Promise<void>;
  appendEntry: <TData = unknown>(customType: string, data?: TData) => Promise<void>;
  setSessionName: (name: string) => Promise<void>;
  getSessionName: () => Promise<string | undefined>;
  setLabel: (entryId: string, label: string | undefined) => Promise<void>;
  getCommands: () => SlashCommandInfo[];
  assertActive: () => void;
  invalidate: (message?: string) => void;
}

// ---------- 扩展实例 ----------

/** 加载后的扩展实例 */
export interface ScoutExtension {
  path: string;
  resolvedPath: string;
  sourceInfo: SourceInfo;
  handlers: Map<string, ScoutHandlerFn[]>;
  tools: Map<string, RegisteredTool>;
  commands: Map<string, RegisteredCommand>;
}

// ---------- 注册产物 ----------

/** 扩展注册的工具 + 来源信息 */
export interface RegisteredTool {
  definition: ScoutToolDefinition;
  sourceInfo: SourceInfo;
}

// ---------- 扩展错误 ----------

export interface ScoutExtensionError {
  extensionPath: string;
  event: string;
  error: string;
  stack?: string;
}

// ---------- Handler 类型 ----------

export type ScoutHandlerFn = (...args: unknown[]) => Promise<unknown>;

// ---------- 扩展 API ----------

/**
 * 暴露给扩展模块的 scout.* 对象。
 * 注册方法写入扩展实例；动作方法委托共享 runtime。
 */
export interface ScoutExtensionAPI {
  on(event: string, handler: ScoutHandlerFn): void;
  registerTool(tool: ScoutToolDefinition): Promise<void>;
  registerCommand(name: string, options: Omit<RegisteredCommand, 'name' | 'sourceInfo'>): void;
  sendMessage<TDetails = unknown>(
    message: SendMessageInput<TDetails>,
    options?: SendMessageOptions,
  ): Promise<void>;
  sendUserMessage(
    content: string | (TextContent | ImageContent)[],
    options?: SendUserMessageOptions,
  ): Promise<void>;
  setActiveTools(toolNames: string[]): Promise<void>;
  getActiveTools(): string[];
  getAllTools(): ToolInfo[];
  appendEntry<TData = unknown>(customType: string, data?: TData): Promise<void>;
  setSessionName(name: string): Promise<void>;
  getSessionName(): Promise<string | undefined>;
  setLabel(entryId: string, label: string | undefined): Promise<void>;
  getCommands(): SlashCommandInfo[];
  events: EventBus;
}

// ---------- 扩展工厂 ----------

/** 扩展模块导出的工厂函数 */
export type ScoutExtensionFactory = (api: ScoutExtensionAPI) => void | Promise<void>;

// ---------- 加载结果 ----------

export interface LoadExtensionsResult {
  extensions: ScoutExtension[];
  errors: Array<{ path: string; error: string }>;
  runtime: ScoutExtensionRuntime;
}

// ---------- Runner 绑定接口 ----------

/** bindCore() 接收的动作方法集 */
export interface ScoutExtensionActions {
  sendMessage: <TDetails = unknown>(
    message: SendMessageInput<TDetails>,
    options?: SendMessageOptions,
  ) => Promise<void>;
  sendUserMessage: (
    content: string | (TextContent | ImageContent)[],
    options?: SendUserMessageOptions,
  ) => Promise<void>;
  getActiveTools: () => string[];
  getAllTools: () => ToolInfo[];
  setActiveTools: (toolNames: string[]) => Promise<void>;
  refreshTools: () => Promise<void>;
  appendEntry: <TData = unknown>(customType: string, data?: TData) => Promise<void>;
  setSessionName: (name: string) => Promise<void>;
  getSessionName: () => Promise<string | undefined>;
  setLabel: (entryId: string, label: string | undefined) => Promise<void>;
  getCommands: () => SlashCommandInfo[];
}

/** bindCore() 接收的上下文动作集 */
export interface ScoutExtensionContextActions {
  getModel: () => Model<any> | undefined;
  isIdle: () => boolean;
  abort: () => void;
  getSystemPrompt: () => string;
  hasPendingMessages: () => boolean;
  getSignal: () => AbortSignal | undefined;
  compact: () => void;
  shutdown: () => void;
  setModel: (modelId: string) => Promise<void>;
  setThinkingLevel: (level: string) => Promise<void>;
  getContextUsage: () => Promise<ScoutContextUsage | undefined>;
  newSession: (options?: SessionReplacementOptions) => Promise<{ cancelled: boolean }>;
  fork: (
    entryId: string,
    options?: SessionReplacementOptions & { position?: 'before' | 'at' },
  ) => Promise<{ cancelled: boolean }>;
  switchSession: (
    sessionMeta: JsonlSessionMetadata,
    options?: SessionReplacementOptions,
  ) => Promise<{ cancelled: boolean }>;
  waitForIdle: () => Promise<void>;
  reload: () => Promise<void>;
  navigateTree: (
    targetId: string,
    options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    },
  ) => Promise<{ cancelled: boolean }>;
}
