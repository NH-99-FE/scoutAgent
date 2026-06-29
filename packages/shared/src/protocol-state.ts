// ============================================================
// Shared 协议状态契约：消息内容、队列与 Webview 快照
// ============================================================

import type { ScoutModelInfo, ThinkingLevel } from './models.ts';
import type { ScoutCommandInfo, ScoutDiagnostic, ToolInfo } from './protocol-core.ts';
import type { ScoutExtensionUIRequest } from './protocol-extension-ui.ts';

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

// ---------- Extension 到 Webview ----------

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
  forkPointEntryId?: string;
  leafId?: string | null;
  contextUsage?: ScoutContextUsage;
  sessionStats?: ScoutSessionStats;
  diagnostics?: ScoutDiagnostic[];
  extensionUIRequests?: ScoutExtensionUIRequest[];
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

// ---------- 上下文用量 ----------

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

export interface ScoutFileEditPreview {
  kind: 'file_edit';
  path: string;
  diff?: string;
  additions: number;
  deletions: number;
  firstChangedLine?: number;
  error?: string;
}

export type ScoutToolCallPreview = ScoutFileEditPreview;

export interface ScoutToolCallPreviewUpdateEvent {
  type: 'tool_call_preview_update';
  sessionId: string;
  sessionFile?: string;
  toolCallId: string;
  toolName: string;
  preview: ScoutToolCallPreview;
}
