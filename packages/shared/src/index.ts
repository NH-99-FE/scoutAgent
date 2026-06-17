// ============================================================
// Shared message protocol between Extension and Webview
// 纯通信契约 —— 两端运行时之间的消息格式
// 不引入任何包的内部类型，所有类型都自包含且可序列化
// ============================================================

// ---------- Thinking levels ----------

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

// ---------- Webview surfaces ----------

export type ScoutWebviewSurface = 'chat' | 'settings' | 'tree';

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

export type ScoutTaskHistoryPurpose = 'recent' | 'panel';

// ---------- Webview → Extension ----------

export type ScoutProtocolService =
  | 'lifecycle'
  | 'state'
  | 'config'
  | 'session'
  | 'task'
  | 'tree'
  | 'mention'
  | 'ui';

export type ScoutProtocolKind = 'lifecycle' | 'query' | 'command';

export interface ScoutProtocolRoute {
  kind: ScoutProtocolKind;
  service: ScoutProtocolService;
  method: string;
  response?: ScoutProtocolResponsePayloadType;
  emits?: readonly ScoutDomainEventType[];
  surfaces?: readonly ScoutWebviewSurface[];
}

export interface ScoutProtocolRequest<T = WebviewRequestPayload> {
  type: 'protocol_request';
  /**
   * Transport-only correlation id. 仅用于 webview-extension envelope
   * 响应匹配与取消，不属于业务 payload。
   */
  requestId: string;
  service: ScoutProtocolService;
  method: string;
  payload: T;
  streaming?: boolean;
}

export interface ScoutProtocolCancel {
  type: 'protocol_cancel';
  /** 取消对应 transport envelope，不取消某个业务实体。 */
  requestId: string;
}

export type WebviewMessage = ScoutProtocolRequest | ScoutProtocolCancel;

export type WebviewRequestPayload =
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
  | {
      type: 'request_task_history';
      query: string;
      limit?: number;
      offset?: number;
      scope?: 'workspace' | 'all';
      purpose?: ScoutTaskHistoryPurpose;
    }
  | {
      type: 'open_task';
      taskId: string;
      sessionPath: string;
      cwdOverride?: string;
    }
  | { type: 'request_sessions' }
  | {
      type: 'restore_session';
      sessionId: string;
      sessionPath: string;
      cwdOverride?: string;
    }
  | { type: 'pick_import_session' }
  | { type: 'import_session'; sessionPath: string; cwdOverride?: string }
  | { type: 'delete_session'; sessionId: string; sessionPath: string }
  | { type: 'export_session'; format: 'jsonl'; outputPath?: string };

export const SCOUT_PROTOCOL = {
  ready: {
    kind: 'lifecycle',
    service: 'lifecycle',
    method: 'ready',
    response: 'bootstrap_result',
    surfaces: ['chat', 'settings', 'tree'],
  },
  request_state: {
    kind: 'query',
    service: 'state',
    method: 'request_state',
    response: 'state_result',
    surfaces: ['chat', 'settings', 'tree'],
  },
  request_config: {
    kind: 'query',
    service: 'config',
    method: 'request_config',
    response: 'config_result',
    surfaces: ['chat', 'settings', 'tree'],
  },
  request_context_usage: {
    kind: 'query',
    service: 'state',
    method: 'request_context_usage',
    response: 'context_usage_result',
    surfaces: ['chat'],
  },
  user_message: {
    kind: 'command',
    service: 'session',
    method: 'user_message',
    emits: [
      'state_update',
      'queue_update',
      'agent_event',
      'context_usage_update',
      'tree_update',
      'task_history_update',
    ],
    surfaces: ['chat'],
  },
  new_session_message: {
    kind: 'command',
    service: 'session',
    method: 'new_session_message',
    response: 'new_session_result',
    emits: ['state_update', 'tree_update', 'task_history_update', 'sessions_update'],
    surfaces: ['chat'],
  },
  cancel_follow_up: {
    kind: 'command',
    service: 'session',
    method: 'cancel_follow_up',
    emits: ['queue_update'],
    surfaces: ['chat'],
  },
  promote_follow_up: {
    kind: 'command',
    service: 'session',
    method: 'promote_follow_up',
    emits: ['state_update', 'queue_update', 'agent_event', 'tree_update'],
    surfaces: ['chat'],
  },
  abort: {
    kind: 'command',
    service: 'session',
    method: 'abort',
    emits: ['state_update', 'queue_update'],
    surfaces: ['chat'],
  },
  abort_retry: {
    kind: 'command',
    service: 'session',
    method: 'abort_retry',
    emits: ['state_update'],
    surfaces: ['chat'],
  },
  compact: {
    kind: 'command',
    service: 'session',
    method: 'compact',
    emits: ['compaction_start', 'compaction_end', 'state_update', 'tree_update'],
    surfaces: ['chat'],
  },
  select_model: {
    kind: 'command',
    service: 'config',
    method: 'select_model',
    emits: ['state_update', 'config_update'],
    surfaces: ['chat', 'settings'],
  },
  select_thinking: {
    kind: 'command',
    service: 'config',
    method: 'select_thinking',
    emits: ['state_update', 'thinking_level_changed'],
    surfaces: ['chat', 'settings'],
  },
  set_active_tools: {
    kind: 'command',
    service: 'config',
    method: 'set_active_tools',
    emits: ['state_update', 'config_update'],
    surfaces: ['chat', 'settings'],
  },
  clear_conversation: {
    kind: 'command',
    service: 'session',
    method: 'clear_conversation',
    emits: ['state_update', 'tree_update'],
    surfaces: ['chat'],
  },
  reload_resources: {
    kind: 'command',
    service: 'config',
    method: 'reload_resources',
    response: 'reload_result',
    emits: ['config_update', 'commands_update', 'state_update', 'tree_update'],
    surfaces: ['chat', 'settings'],
  },
  open_settings_panel: {
    kind: 'command',
    service: 'ui',
    method: 'open_settings_panel',
    response: 'open_settings_panel_result',
    surfaces: ['chat', 'tree'],
  },
  open_tree_panel: {
    kind: 'command',
    service: 'ui',
    method: 'open_tree_panel',
    response: 'open_tree_panel_result',
    surfaces: ['chat', 'settings'],
  },
  fork_session: {
    kind: 'command',
    service: 'tree',
    method: 'fork_session',
    response: 'fork_result',
    emits: ['state_update', 'tree_update', 'sessions_update'],
    surfaces: ['tree'],
  },
  request_tree: {
    kind: 'query',
    service: 'tree',
    method: 'request_tree',
    response: 'tree_result',
    surfaces: ['chat', 'tree'],
  },
  navigate_tree: {
    kind: 'command',
    service: 'tree',
    method: 'navigate_tree',
    response: 'navigate_tree_result',
    emits: ['state_update', 'tree_update'],
    surfaces: ['tree'],
  },
  set_label: {
    kind: 'command',
    service: 'tree',
    method: 'set_label',
    response: 'label_result',
    emits: ['tree_update'],
    surfaces: ['tree'],
  },
  set_session_name: {
    kind: 'command',
    service: 'session',
    method: 'set_session_name',
    response: 'set_session_name_result',
    emits: ['sessions_update', 'state_update'],
    surfaces: ['chat', 'tree'],
  },
  continue_session: {
    kind: 'command',
    service: 'session',
    method: 'continue_session',
    emits: ['state_update', 'queue_update', 'agent_event', 'tree_update'],
    surfaces: ['chat'],
  },
  request_commands: {
    kind: 'query',
    service: 'ui',
    method: 'request_commands',
    response: 'commands_result',
    surfaces: ['chat', 'settings'],
  },
  request_file_mentions: {
    kind: 'query',
    service: 'mention',
    method: 'request_file_mentions',
    response: 'file_mentions_result',
    surfaces: ['chat'],
  },
  request_task_history: {
    kind: 'query',
    service: 'task',
    method: 'request_task_history',
    response: 'task_history_result',
    surfaces: ['chat'],
  },
  open_task: {
    kind: 'command',
    service: 'session',
    method: 'open_task',
    response: 'open_task_result',
    emits: ['state_update', 'tree_update', 'sessions_update'],
    surfaces: ['chat'],
  },
  request_sessions: {
    kind: 'query',
    service: 'session',
    method: 'request_sessions',
    response: 'sessions_result',
    surfaces: ['chat', 'tree'],
  },
  restore_session: {
    kind: 'command',
    service: 'session',
    method: 'restore_session',
    response: 'restore_session_result',
    emits: ['state_update', 'tree_update', 'sessions_update'],
    surfaces: ['chat', 'tree'],
  },
  pick_import_session: {
    kind: 'command',
    service: 'session',
    method: 'pick_import_session',
    response: 'import_session_result',
    emits: ['state_update', 'tree_update', 'sessions_update'],
    surfaces: ['chat'],
  },
  import_session: {
    kind: 'command',
    service: 'session',
    method: 'import_session',
    response: 'import_session_result',
    emits: ['state_update', 'tree_update', 'sessions_update'],
    surfaces: ['chat'],
  },
  delete_session: {
    kind: 'command',
    service: 'session',
    method: 'delete_session',
    response: 'delete_session_result',
    emits: ['sessions_update'],
    surfaces: ['chat'],
  },
  export_session: {
    kind: 'command',
    service: 'session',
    method: 'export_session',
    response: 'export_session_result',
    surfaces: ['chat'],
  },
} as const satisfies Record<WebviewRequestPayload['type'], ScoutProtocolRoute>;

export type ScoutProtocolPayloadType = WebviewRequestPayload['type'];

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

export type ScoutBusyState =
  | { kind: 'idle'; cancellable: false }
  | { kind: 'agent'; label?: string; cancellable: boolean }
  | {
      kind: 'retry';
      label?: string;
      cancellable: boolean;
      attempt?: number;
      maxAttempts?: number;
      reason?: string;
    }
  | { kind: 'compaction'; label?: string; cancellable: boolean; reason?: string };

export type ScoutBusyKind = ScoutBusyState['kind'];

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
  /** bootstrap/state_result/state_update 使用的运行态快照；流式增量以事件为准。 */
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

// ---------- Request-scoped protocol results ----------

export interface ScoutBootstrapResult {
  type: 'bootstrap_result';
  surface: ScoutWebviewSurface;
  config: ScoutConfig;
  state: ScoutWebviewState;
  commands: ScoutCommandInfo[];
  sessions?: ScoutSessionListItem[];
  recentTasks?: ScoutTaskItem[];
  tree?: {
    nodes: ScoutSessionTreeNode[];
    leafId: string | null;
  };
}

export interface ScoutStateResult {
  type: 'state_result';
  state: ScoutWebviewState;
}

export interface ScoutConfigResult {
  type: 'config_result';
  config: ScoutConfig;
}

export interface ScoutContextUsageResult {
  type: 'context_usage_result';
  contextUsage?: ScoutContextUsage;
}

export interface ScoutCommandsResult {
  type: 'commands_result';
  commands: ScoutCommandInfo[];
}

export interface ScoutTreeResult {
  type: 'tree_result';
  tree: ScoutSessionTreeNode[];
  leafId: string | null;
}

export interface ScoutSessionsResult {
  type: 'sessions_result';
  sessions: ScoutSessionListItem[];
}

export interface ScoutFileMentionsResult {
  type: 'file_mentions_result';
  query: string;
  items: ScoutFileMentionItem[];
}

export interface ScoutTaskHistoryResult {
  type: 'task_history_result';
  query: string;
  purpose?: ScoutTaskHistoryPurpose;
  tasks: ScoutTaskItem[];
  offset: number;
  hasMore: boolean;
  nextOffset: number;
}

export interface ScoutCommandResult {
  type:
    | 'fork_result'
    | 'new_session_result'
    | 'open_task_result'
    | 'open_settings_panel_result'
    | 'open_tree_panel_result'
    | 'restore_session_result'
    | 'import_session_result'
    | 'export_session_result'
    | 'navigate_tree_result'
    | 'label_result'
    | 'set_session_name_result'
    | 'reload_result'
    | 'delete_session_result';
  success: boolean;
  error?: string;
  sessionPath?: string;
  path?: string;
  editorText?: string;
}

export type ScoutProtocolResponsePayload =
  | ScoutBootstrapResult
  | ScoutStateResult
  | ScoutConfigResult
  | ScoutContextUsageResult
  | ScoutCommandsResult
  | ScoutTreeResult
  | ScoutSessionsResult
  | ScoutFileMentionsResult
  | ScoutTaskHistoryResult
  | ScoutCommandResult;

export type ScoutProtocolResponsePayloadType = ScoutProtocolResponsePayload['type'];

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

/**
 * Webview 运行态 reducer 消费的实时事件集合。
 * 这些事件只用于增量投影 UI，state_update/state_result/bootstrap 仍负责快照同步。
 */
export type ScoutRuntimeEvent =
  | ScoutAgentEvent
  | ScoutAutoRetryStartEvent
  | ScoutAutoRetryEndEvent
  | ScoutCompactionStartEvent
  | ScoutCompactionEndEvent;

export type ScoutRuntimeExtensionEvent =
  | { type: 'agent_event'; event: ScoutAgentEvent }
  | ScoutAutoRetryStartEvent
  | ScoutAutoRetryEndEvent
  | ScoutCompactionStartEvent
  | ScoutCompactionEndEvent;

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

export type ExtensionMessage = ScoutProtocolResponse | ExtensionEventMessage;

export interface ScoutProtocolResponse<T = ScoutProtocolResponsePayload> {
  type: 'protocol_response';
  /** 必须回填请求 envelope 的 requestId，用于 webview transport 关联 callback。 */
  requestId: string;
  payload?: T;
  error?: ScoutProtocolError;
  done?: boolean;
  sequence?: number;
}

export interface ScoutProtocolError {
  code: string;
  message: string;
}

export type ExtensionEventMessage =
  | { type: 'state_update'; state: ScoutWebviewState }
  | { type: 'queue_update'; queueState: ScoutQueueState }
  | ScoutRuntimeExtensionEvent
  | { type: 'config_update'; config: ScoutConfig }
  | { type: 'commands_update'; commands: ScoutCommandInfo[] }
  | { type: 'context_usage_update'; contextUsage?: ScoutContextUsage }
  | ScoutNotificationMessage
  | ScoutThinkingLevelChangedEvent
  | { type: 'tree_update'; tree: ScoutSessionTreeNode[]; leafId: string | null }
  | {
      type: 'task_history_update';
      query: string;
      purpose?: ScoutTaskHistoryPurpose;
      tasks: ScoutTaskItem[];
      offset: number;
      hasMore: boolean;
      nextOffset: number;
    }
  | { type: 'sessions_update'; sessions: ScoutSessionListItem[] };

export type ScoutDomainEventType = ExtensionEventMessage['type'];
