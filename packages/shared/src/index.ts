// ============================================================
// Shared message protocol between Extension and Webview
// 纯通信契约 —— 两端运行时之间的消息格式
// 不引入任何包的内部类型，所有类型都自包含且可序列化
// ============================================================

// ---------- Thinking levels ----------

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high';

// ---------- Source / Tool info ----------

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
  label?: string;
  description: string;
  parameters: unknown;
  active: boolean;
  sourceInfo: SourceInfo;
}

// ---------- Session Tree ----------

export interface ScoutSessionTreeNode {
  id: string;
  parentId: string | null;
  timestamp: string;
  type: string;
  label?: string;
  preview?: string;
  children: ScoutSessionTreeNode[];
}

export interface ScoutSessionListItem {
  id: string;
  path: string;
  cwd?: string;
  createdAt: string;
  parentSessionPath?: string;
}

// ---------- Webview → Extension ----------

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'user_message'; text: string }
  | { type: 'abort' }
  | { type: 'abort_retry' }
  | { type: 'select_model'; provider: string; modelId: string }
  | { type: 'select_thinking'; level: ThinkingLevel }
  | { type: 'set_active_tools'; toolNames: string[] }
  | { type: 'clear_conversation' }
  | { type: 'fork_session'; entryId: string; position: 'before' | 'at' }
  | { type: 'request_tree' }
  | {
      type: 'navigate_tree';
      targetId: string;
      summarize: boolean;
      customInstructions?: string;
      label?: string;
    }
  | { type: 'set_label'; entryId: string; label?: string }
  | { type: 'continue_session' }
  | { type: 'request_sessions' }
  | { type: 'restore_session'; sessionId: string; sessionPath: string; cwdOverride?: string }
  | { type: 'pick_import_session' }
  | { type: 'import_session'; sessionPath: string; cwdOverride?: string }
  | { type: 'delete_session'; sessionId: string; sessionPath: string };

// ---------- 消息内容块 ----------

export interface ScoutTextContent {
  type: 'text';
  text: string;
}

export interface ScoutThinkingContent {
  type: 'thinking';
  thinking: string;
  redacted?: boolean;
}

export interface ScoutToolCallContent {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ScoutContent = ScoutTextContent | ScoutThinkingContent | ScoutToolCallContent;

// ---------- 可序列化消息 ----------

export interface ScoutUserMessage {
  role: 'user';
  content: string | ScoutContent[];
  timestamp: number;
  entryId?: string;
}

export interface ScoutAssistantMessage {
  role: 'assistant';
  content: ScoutContent[];
  stopReason?: string;
  errorMessage?: string;
  timestamp: number;
  entryId?: string;
}

export interface ScoutToolResultMessage {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: ScoutTextContent[];
  isError: boolean;
  timestamp: number;
  entryId?: string;
}

export interface ScoutBranchSummaryMessage {
  role: 'branchSummary';
  summary: string;
  fromId: string;
  timestamp: number;
  entryId?: string;
}

export type ScoutMessage =
  | ScoutUserMessage
  | ScoutAssistantMessage
  | ScoutToolResultMessage
  | ScoutBranchSummaryMessage;

// ---------- Extension → Webview ----------

export interface ScoutWebviewState {
  messages: ScoutMessage[];
  isStreaming: boolean;
  modelProvider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  tools: ToolInfo[];
  activeToolNames: string[];
  errorMessage?: string;
  sessionId?: string;
  parentSessionPath?: string;
  leafId?: string | null;
}

export interface ScoutConfig {
  models: { provider: string; id: string; name: string }[];
  defaultModelProvider: string;
  defaultModelId: string;
}

// ---------- Context Usage ----------

export interface ScoutContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

/**
 * Agent 事件在 postMessage 通道上的序列化形式。
 * 结构与内部 AgentEvent 对齐，消息类型替换为可序列化的 ScoutMessage。
 * Extension 端负责将内部 AgentEvent 映射为此格式。
 */
export type ScoutAgentEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end'; willRetry: boolean }
  | { type: 'turn_start' }
  | { type: 'turn_end' }
  | { type: 'message_start'; message: ScoutMessage }
  | { type: 'message_update'; message: ScoutMessage }
  | { type: 'message_end'; message: ScoutMessage }
  | {
      type: 'tool_execution_start';
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | { type: 'tool_execution_update'; toolCallId: string; toolName: string; partialResult: string }
  | {
      type: 'tool_execution_end';
      toolCallId: string;
      toolName: string;
      result: string;
      isError: boolean;
    };

// ---------- Retry 事件 ----------

export interface ScoutAutoRetryStartEvent {
  type: 'auto_retry_start';
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage: string;
}

export interface ScoutAutoRetryEndEvent {
  type: 'auto_retry_end';
  success: boolean;
  attempt: number;
  finalError?: string;
}

// ---------- Compaction 事件 ----------

export type ScoutCompactionReason = 'manual' | 'threshold' | 'overflow';

export interface ScoutCompactionResult {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
}

export interface ScoutCompactionStartEvent {
  type: 'compaction_start';
  reason: ScoutCompactionReason;
}

export interface ScoutCompactionEndEvent {
  type: 'compaction_end';
  reason: ScoutCompactionReason;
  result?: ScoutCompactionResult;
  aborted: boolean;
  willRetry: boolean;
  errorMessage?: string;
}

// ---------- Thinking Level 事件 ----------

export interface ScoutThinkingLevelChangedEvent {
  type: 'thinking_level_changed';
  level: ThinkingLevel;
}

export type ExtensionMessage =
  | { type: 'state_update'; state: ScoutWebviewState }
  | { type: 'agent_event'; event: ScoutAgentEvent }
  | { type: 'config_update'; config: ScoutConfig }
  | {
      type: 'auto_retry_start';
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | { type: 'auto_retry_end'; success: boolean; attempt: number; finalError?: string }
  | ScoutCompactionStartEvent
  | ScoutCompactionEndEvent
  | ScoutThinkingLevelChangedEvent
  | { type: 'fork_result'; success: boolean; error?: string }
  | { type: 'tree_data'; tree: ScoutSessionTreeNode[]; leafId: string | null }
  | { type: 'sessions_data'; sessions: ScoutSessionListItem[] }
  | { type: 'restore_session_result'; success: boolean; error?: string }
  | { type: 'import_session_result'; success: boolean; error?: string }
  | { type: 'navigate_tree_result'; success: boolean; error?: string; editorText?: string }
  | { type: 'label_result'; success: boolean; error?: string }
  | { type: 'delete_session_result'; success: boolean; error?: string };
