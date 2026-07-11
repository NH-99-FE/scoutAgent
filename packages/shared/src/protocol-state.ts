// ============================================================
// Shared 协议状态契约：消息内容、队列与 Webview 快照
// ============================================================

import type { ScoutModelInfo, ThinkingLevel } from './models.ts';
import type { ScoutCommandInfo, ScoutDiagnostic, ToolInfo } from './protocol-core.ts';
import type { ScoutExtensionUIRequest } from './protocol-extension-ui.ts';
import type { ScoutChangesReviewRow, ScoutChangesReviewSummary } from './protocol-review.ts';

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
  /** UI 展示用参数；例如 host 已经把 path 转成 cwd-relative/display path。 */
  displayArguments?: Record<string, unknown>;
}

export interface ScoutImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

/** 跨 Webview 与宿主共用的图片下载扩展名映射。 */
export const SCOUT_IMAGE_EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface ScoutSkillInvocationContent {
  type: 'skillInvocation';
  name: string;
  location: string;
  content: string;
  userMessage?: string;
}

export type ScoutContent =
  | ScoutTextContent
  | ScoutThinkingContent
  | ScoutToolCallContent
  | ScoutImageContent
  | ScoutSkillInvocationContent;

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
  /** Host 已归并的 settled changes review 摘要；webview 只负责渲染。 */
  changesReviews?: ScoutChangesReviewSummary[];
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
  activeChangesReview?: ScoutChangesReviewSummary;
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

export interface ScoutFileChangeReviewRef {
  turnId: string;
  recordId: string;
}

export interface ScoutFileChangeDiffPreview {
  rows: ScoutChangesReviewRow[];
  truncated?: boolean;
  unavailableReason?: string;
}

export interface ScoutFileChangeDetails {
  kind: 'file_change';
  /** 可定位的业务路径，通常为 host/core 规范化后的绝对路径；不要当作 UI 展示规则来源。 */
  path: string;
  /** UI-only 展示路径，由 host/core 格式化；webview 只负责渲染与截断。 */
  displayPath?: string;
  additions: number;
  deletions: number;
  firstChangedLine?: number;
  review: ScoutFileChangeReviewRef;
  /** Host 在协议边界附加的轻量最终 diff 预览；不进入 provider runtime context。 */
  diffPreview?: ScoutFileChangeDiffPreview;
}

export interface ScoutFileEditPreview {
  kind: 'file_edit';
  /** 预览关联的业务 path，用于标识文件；展示优先使用 displayPath。 */
  path: string;
  /** UI-only 展示路径，由 core preview 根据当前 cwd 格式化。 */
  displayPath?: string;
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
