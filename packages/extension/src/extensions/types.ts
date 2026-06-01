// ============================================================
// 扩展系统类型定义 — Scout 简化版
// 扩展可：订阅 Agent 生命周期事件、注册 LLM 可调用工具
// ============================================================

import type { Model, ImageContent, TextContent } from '@scout-agent/ai';
import type {
  AgentMessage,
  AgentToolResult,
  AgentToolUpdateCallback,
  ToolExecutionMode,
} from '@scout-agent/agent';
import type {
  CompactionPreparation,
  SessionTreeEntry,
  CompactResult,
  ContextUsageEstimate,
} from '@scout-agent/agent';
import type { Static, TSchema } from '@sinclair/typebox';
import type { EventBus } from './event-bus.ts';
import type { ConfigManager } from '../config-manager.ts';
import type { SessionManager } from '../session-manager.ts';

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

/** 扩展可监听的所有事件类型字符串 */
export type ScoutExtensionEventType =
  | 'before_agent_start'
  | 'context'
  | 'tool_call'
  | 'tool_result'
  | 'before_provider_request'
  | 'before_provider_payload'
  | 'session_before_compact'
  | 'session_shutdown';

// ---------- 事件定义 ----------

export interface BeforeAgentStartEvent {
  type: 'before_agent_start';
  prompt: string;
  images?: ImageContent[];
  systemPrompt: string;
}

export interface ContextEvent {
  type: 'context';
  messages: AgentMessage[];
}

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

export interface BeforeProviderRequestEvent {
  type: 'before_provider_request';
  model: Model<any>;
  sessionId: string;
}

export interface BeforeProviderPayloadEvent {
  type: 'before_provider_payload';
  model: Model<any>;
  payload: unknown;
}

export interface SessionBeforeCompactEvent {
  type: 'session_before_compact';
  preparation: CompactionPreparation;
  branchEntries: SessionTreeEntry[];
  customInstructions?: string;
  signal: AbortSignal;
}

export interface SessionShutdownEvent {
  type: 'session_shutdown';
}

/** 所有扩展事件联合类型 */
export type ScoutExtensionEvent =
  | BeforeAgentStartEvent
  | ContextEvent
  | ToolCallEvent
  | ToolResultEvent
  | BeforeProviderRequestEvent
  | BeforeProviderPayloadEvent
  | SessionBeforeCompactEvent
  | SessionShutdownEvent;

// ---------- 事件结果 ----------

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
  terminate?: boolean;
}

export interface SessionBeforeCompactResult {
  cancel?: boolean;
  compaction?: CompactResult;
}

// ---------- 工具信息 ----------

export type SourceScope = 'user' | 'project' | 'temporary';
export type SourceOrigin = 'package' | 'top-level';

export interface SourceInfo {
  path: string;
  source: string;
  scope: SourceScope;
  origin: SourceOrigin;
  baseDir?: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  parameters: unknown;
  sourceInfo: SourceInfo;
}

export interface SendUserMessageOptions {
  deliverAs?: 'steer' | 'followUp';
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
  getContextUsage(): ContextUsageEstimate | undefined;
}

// ---------- 扩展运行时 ----------

/**
 * 共享运行时状态和动作代理。
 * 创建时所有动作方法为 throwing stub，bindCore() 替换为真实实现。
 */
export interface ScoutExtensionRuntime {
  sendMessage: (message: string) => void;
  sendUserMessage: (
    content: string | (TextContent | ImageContent)[],
    options?: SendUserMessageOptions,
  ) => void;
  getActiveTools: () => string[];
  getAllTools: () => ToolInfo[];
  setActiveTools: (toolNames: string[]) => void;
  refreshTools: () => void;
  assertActive: () => void;
  invalidate: (message?: string) => void;
}

// ---------- 扩展实例 ----------

/** 加载后的扩展实例 */
export interface ScoutExtension {
  path: string;
  resolvedPath: string;
  handlers: Map<string, ScoutHandlerFn[]>;
  tools: Map<string, RegisteredTool>;
}

// ---------- 注册产物 ----------

/** 扩展注册的工具 + 来源信息 */
export interface RegisteredTool {
  definition: ScoutToolDefinition;
  sourcePath: string;
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
  registerTool(tool: ScoutToolDefinition): void;
  sendMessage(message: string): void;
  sendUserMessage(
    content: string | (TextContent | ImageContent)[],
    options?: SendUserMessageOptions,
  ): void;
  setActiveTools(toolNames: string[]): void;
  getActiveTools(): string[];
  getAllTools(): ToolInfo[];
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
  sendMessage: (message: string) => void;
  sendUserMessage: (
    content: string | (TextContent | ImageContent)[],
    options?: SendUserMessageOptions,
  ) => void;
  getActiveTools: () => string[];
  getAllTools: () => ToolInfo[];
  setActiveTools: (toolNames: string[]) => void;
  refreshTools: () => void;
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
  getContextUsage: () => ContextUsageEstimate | undefined;
}
