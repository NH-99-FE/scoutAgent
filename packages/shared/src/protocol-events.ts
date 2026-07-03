// ============================================================
// Shared 协议事件契约：运行态事件与 Extension 消息
// ============================================================

import type {
  ScoutCommandInfo,
  ScoutSessionListItem,
  ScoutSessionTreeNode,
  ScoutTaskHistoryPurpose,
  ScoutTaskItem,
} from './protocol-core.ts';
import type { ScoutProtocolResponsePayload } from './protocol-results.ts';
import type {
  ScoutExtensionUIRequest,
  ScoutExtensionUIRequestClosedEvent,
} from './protocol-extension-ui.ts';
import type {
  ScoutBusyState,
  ScoutConfig,
  ScoutContextUsage,
  ScoutMessage,
  ScoutQueueState,
  ScoutToolCallPreviewUpdateEvent,
  ScoutToolExecutionResult,
  ScoutWebviewState,
} from './protocol-state.ts';
import type { ScoutChangesReviewSummary } from './protocol-review.ts';

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
      /** UI 展示用参数；例如 path 已由 host/core 格式化为 display path。 */
      displayArgs?: Record<string, unknown>;
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

// ---------- 自动重试事件 ----------

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

// ---------- 压缩事件 ----------

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
  | ScoutToolCallPreviewUpdateEvent
  | ScoutAutoRetryStartEvent
  | ScoutAutoRetryEndEvent
  | ScoutCompactionStartEvent
  | ScoutCompactionEndEvent;

export interface ScoutRuntimeStateUpdateEvent {
  type: 'runtime_state_update';
  isStreaming: boolean;
  busyState: ScoutBusyState;
}

export interface ScoutChangesReviewUpdateEvent {
  type: 'changes_review_update';
  sessionId: string;
  sessionFile?: string;
  changesReview?: ScoutChangesReviewSummary;
}

export type ScoutRuntimeExtensionEvent =
  | ScoutRuntimeStateUpdateEvent
  | { type: 'agent_event'; event: ScoutAgentEvent }
  | ScoutToolCallPreviewUpdateEvent
  | ScoutAutoRetryStartEvent
  | ScoutAutoRetryEndEvent
  | ScoutCompactionStartEvent
  | ScoutCompactionEndEvent;

export interface ScoutNotificationMessage {
  type: 'notification';
  level: 'success' | 'info' | 'warning' | 'error';
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
  | ScoutChangesReviewUpdateEvent
  | ScoutNotificationMessage
  | ScoutExtensionUIRequest
  | ScoutExtensionUIRequestClosedEvent
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

export const EXTENSION_TO_WEBVIEW_MESSAGE_TYPES = [
  'protocol_response',
  'state_update',
  'queue_update',
  'changes_review_update',
  'runtime_state_update',
  'agent_event',
  'tool_call_preview_update',
  'config_update',
  'context_usage_update',
  'commands_update',
  'tree_update',
  'task_history_update',
  'sessions_update',
  'notification',
  'extension_ui_request',
  'extension_ui_request_closed',
  'auto_retry_start',
  'auto_retry_end',
  'compaction_start',
  'compaction_end',
] as const satisfies readonly ExtensionMessage['type'][];
