// ============================================================
// Shared message protocol between Extension and Webview
// 纯通信契约 —— 两端运行时之间的消息格式
// 不引入任何包的内部类型，所有类型都自包含且可序列化
// ============================================================

// ---------- Thinking levels ----------

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

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

// ---------- Models / Commands / Diagnostics ----------

export interface ScoutModelInfo {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  input: Array<'text' | 'image'>;
  contextWindow: number;
}

export type ScoutCommandSource = 'builtin' | 'extension' | 'prompt' | 'skill';

export interface ScoutCommandInfo {
  name: string;
  description?: string;
  source: ScoutCommandSource;
  sourceInfo: SourceInfo;
}

export type ScoutDiagnosticType = 'info' | 'warning' | 'error' | 'collision';

export interface ScoutDiagnostic {
  type: ScoutDiagnosticType;
  message: string;
  path?: string;
  collision?: unknown;
}

// ---------- Session Tree ----------

export type ScoutSessionTreeNodeKind =
  | 'user'
  | 'assistant'
  | 'toolResult'
  | 'compaction'
  | 'branchSummary'
  | 'custom';

export interface ScoutSessionTreeNode {
  id: string;
  parentId: string | null;
  timestamp: string;
  type: string;
  kind?: ScoutSessionTreeNodeKind;
  role?: string;
  label?: string;
  labelTimestamp?: string;
  preview?: string;
  children: ScoutSessionTreeNode[];
}

export interface ScoutSessionListItem {
  id: string;
  path: string;
  cwd?: string;
  createdAt: string;
  modifiedAt?: string;
  name?: string;
  messageCount?: number;
  firstMessage?: string;
  parentSessionPath?: string;
  isCurrent?: boolean;
}

// ---------- Tasks / Mentions ----------

export type ScoutFileMentionKind = 'file' | 'directory';

export interface ScoutFileMentionItem {
  id: string;
  kind: ScoutFileMentionKind;
  path: string;
  label: string;
  description?: string;
}

export interface ScoutTaskItem {
  id: string;
  sessionId: string;
  sessionPath: string;
  title: string;
  cwd?: string;
  createdAt: string;
  modifiedAt?: string;
  parentSessionPath?: string;
  messageCount?: number;
  isCurrent?: boolean;
}

// ---------- Webview → Extension ----------

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'request_state' }
  | { type: 'request_config' }
  | { type: 'request_context_usage' }
  | {
      type: 'user_message';
      text: string;
      images?: ScoutImageContent[];
      deliverAs?: 'steer' | 'followUp';
      clearFollowUpQueue?: boolean;
    }
  | {
      type: 'new_session_message';
      requestId: string;
      text: string;
      images?: ScoutImageContent[];
    }
  | { type: 'cancel_follow_up'; id: string }
  | {
      type: 'promote_follow_up';
      id: string;
      resume?: boolean;
      preserveFollowUpQueue?: boolean;
    }
  | { type: 'abort' }
  | { type: 'abort_retry' }
  | { type: 'compact'; customInstructions?: string }
  | { type: 'select_model'; provider: string; modelId: string }
  | { type: 'select_thinking'; level: ThinkingLevel }
  | { type: 'set_active_tools'; toolNames: string[] }
  | { type: 'clear_conversation' }
  | { type: 'reload_resources' }
  | { type: 'open_settings_panel' }
  | { type: 'open_tree_panel' }
  | { type: 'fork_session'; entryId: string; position: 'before' | 'at' }
  | { type: 'request_tree' }
  | {
      type: 'navigate_tree';
      targetId: string;
      summarize: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    }
  | { type: 'set_label'; entryId: string; label?: string }
  | { type: 'set_session_name'; name: string }
  | { type: 'continue_session'; preserveFollowUpQueue?: boolean }
  | { type: 'request_commands' }
  | { type: 'request_file_mentions'; query: string; limit?: number }
  | { type: 'request_tasks'; limit?: number }
  | { type: 'search_tasks'; query: string; limit?: number; requestId?: string }
  | {
      type: 'open_task';
      requestId: string;
      taskId: string;
      sessionPath: string;
      cwdOverride?: string;
    }
  | { type: 'request_sessions' }
  | {
      type: 'restore_session';
      requestId: string;
      sessionId: string;
      sessionPath: string;
      cwdOverride?: string;
    }
  | { type: 'pick_import_session' }
  | { type: 'import_session'; sessionPath: string; cwdOverride?: string }
  | { type: 'delete_session'; sessionId: string; sessionPath: string }
  | { type: 'export_session'; format: 'jsonl'; outputPath?: string };

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

export interface ScoutImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export type ScoutContent =
  | ScoutTextContent
  | ScoutThinkingContent
  | ScoutToolCallContent
  | ScoutImageContent;

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
  content: ScoutContent[];
  details?: unknown;
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

export interface ScoutCompactionSummaryMessage {
  role: 'compactionSummary';
  summary: string;
  tokensBefore: number;
  timestamp: number;
  entryId?: string;
}

export interface ScoutCustomMessage {
  role: 'custom';
  customType: string;
  content: string | ScoutContent[];
  details?: unknown;
  timestamp: number;
  entryId?: string;
}

export type ScoutMessage =
  | ScoutUserMessage
  | ScoutAssistantMessage
  | ScoutToolResultMessage
  | ScoutBranchSummaryMessage
  | ScoutCompactionSummaryMessage
  | ScoutCustomMessage;

// ---------- Extension → Webview ----------

export type ScoutBusyKind =
  | 'idle'
  | 'agent'
  | 'retry'
  | 'compaction'
  | 'branch_summary'
  | 'session'
  | 'tool';

export interface ScoutBusyState {
  kind: ScoutBusyKind;
  label?: string;
  cancellable: boolean;
  attempt?: number;
  maxAttempts?: number;
  reason?: string;
}

export interface ScoutQueuedFollowUp {
  id: string;
  text: string;
  timestamp: number;
}

export type ScoutQueuedMessageDelivery = 'steer' | 'followUp';

export interface ScoutQueuedMessage {
  id: string;
  delivery: ScoutQueuedMessageDelivery;
  text: string;
  timestamp: number;
}

export interface ScoutQueueState {
  messages: ScoutQueuedMessage[];
  followUps: ScoutQueuedFollowUp[];
  paused: boolean;
  pauseReason?: 'aborted';
}

export interface ScoutWebviewState {
  messages: ScoutMessage[];
  isStreaming: boolean;
  busyState: ScoutBusyState;
  queueState?: ScoutQueueState;
  modelProvider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  tools: ToolInfo[];
  activeToolNames: string[];
  commands: ScoutCommandInfo[];
  cwd?: string;
  errorMessage?: string;
  sessionId?: string;
  sessionName?: string;
  sessionFile?: string;
  parentSessionPath?: string;
  leafId?: string | null;
  contextUsage?: ScoutContextUsage;
  sessionStats?: ScoutSessionStats;
  diagnostics?: ScoutDiagnostic[];
  modelFallbackMessage?: string;
}

export interface ScoutConfig {
  models: ScoutModelInfo[];
  defaultModelProvider: string;
  defaultModelId: string;
  branchSummary: {
    reserveTokens: number;
    skipPrompt: boolean;
  };
}

// ---------- Context Usage ----------

export interface ScoutContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface ScoutSessionStats {
  sessionFile?: string;
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
  contextUsage?: ScoutContextUsage;
}

export interface ScoutToolExecutionResult {
  content: ScoutContent[];
  details?: unknown;
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
  | { type: 'message_start'; messageId: string; message: ScoutMessage }
  | { type: 'message_update'; messageId: string; message: ScoutMessage }
  | { type: 'message_end'; messageId: string; message: ScoutMessage }
  | {
      type: 'tool_execution_start';
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: 'tool_execution_update';
      toolCallId: string;
      toolName: string;
      partialResult: ScoutToolExecutionResult;
    }
  | {
      type: 'tool_execution_end';
      toolCallId: string;
      toolName: string;
      result: ScoutToolExecutionResult;
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

export interface ScoutNotificationMessage {
  type: 'notification';
  level: 'info' | 'warning' | 'error';
  message: string;
}

export type ExtensionMessage =
  | { type: 'state_update'; state: ScoutWebviewState }
  | { type: 'queue_update'; queueState: ScoutQueueState }
  | { type: 'agent_event'; event: ScoutAgentEvent }
  | { type: 'config_update'; config: ScoutConfig }
  | { type: 'context_usage_update'; contextUsage?: ScoutContextUsage }
  | ScoutNotificationMessage
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
  | { type: 'commands_data'; commands: ScoutCommandInfo[] }
  | { type: 'file_mentions_data'; query: string; items: ScoutFileMentionItem[] }
  | { type: 'tasks_data'; tasks: ScoutTaskItem[]; query?: string; requestId?: string }
  | { type: 'sessions_data'; sessions: ScoutSessionListItem[] }
  | { type: 'open_settings_panel_result'; success: boolean; error?: string }
  | { type: 'open_tree_panel_result'; success: boolean; error?: string }
  | { type: 'new_session_result'; requestId: string; success: boolean; error?: string }
  | {
      type: 'open_task_result';
      requestId: string;
      sessionPath: string;
      success: boolean;
      error?: string;
    }
  | { type: 'restore_session_result'; requestId: string; success: boolean; error?: string }
  | { type: 'import_session_result'; success: boolean; error?: string }
  | { type: 'export_session_result'; success: boolean; path?: string; error?: string }
  | { type: 'navigate_tree_result'; success: boolean; error?: string; editorText?: string }
  | { type: 'label_result'; success: boolean; error?: string }
  | { type: 'set_session_name_result'; success: boolean; error?: string }
  | { type: 'reload_result'; success: boolean; error?: string }
  | { type: 'delete_session_result'; success: boolean; error?: string };
