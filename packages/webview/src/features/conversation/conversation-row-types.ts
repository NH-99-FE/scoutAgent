// ============================================================
// Conversation Row Types — 会话展示行类型契约
// ============================================================

import type {
  ScoutBusyState,
  ScoutImageContent,
  ScoutMessage,
  ScoutTextContent,
  ScoutThinkingContent,
  ScoutToolCallContent,
  ScoutToolResultMessage,
} from '@scout-agent/shared';
import type {
  ConversationItem,
  ToolCallPreviewState,
  ToolExecutionState,
} from '@/store/conversation-store';
import type { ToolDisplayResult } from './tool-display';

export type AssistantVisibleContent = ScoutTextContent | ScoutImageContent;

export type ConversationRow =
  | UserConversationRow
  | AssistantConversationRow
  | AssistantOutcomeConversationRow
  | SystemConversationRow;

export interface UserConversationRow {
  type: 'user';
  key: string;
  message: Extract<ScoutMessage, { role: 'user' }>;
}

export interface AssistantConversationRow {
  type: 'assistant';
  key: string;
  entries: AssistantTurnEntry[];
  turnSummary?: AssistantTurnSummary;
  actionText: string;
  timestamp: number;
  isLatestAssistant: boolean;
  isStreaming: boolean;
}

export type AssistantOutcomeKind = 'aborted' | 'error' | 'compacting' | 'compacted';

export type AssistantOutcomeConversationRow =
  | AssistantSimpleOutcomeConversationRow
  | AssistantCompactedOutcomeConversationRow;

export interface AssistantSimpleOutcomeConversationRow {
  type: 'assistant_outcome';
  key: string;
  kind: Exclude<AssistantOutcomeKind, 'compacted'>;
  text: string;
}

export interface AssistantCompactedOutcomeConversationRow {
  type: 'assistant_outcome';
  key: string;
  kind: 'compacted';
  text: string;
  markdown: string;
}

export interface AssistantTurnSummary {
  label: string;
  running: boolean;
  status: 'model_deciding' | 'work_processing' | 'completed' | 'stopped' | 'failed';
  tone: 'default' | 'error';
}

export type AssistantTurnEntry = AssistantContentEntry | AssistantProcessEntry;

export interface AssistantContentEntry {
  type: 'content';
  key: string;
  blocks: AssistantVisibleContent[];
  timestamp: number;
}

export interface AssistantProcessEntry {
  type: 'process';
  key: string;
  lifecycle: AssistantProcessLifecycle;
  summary: AssistantProcessSummary;
  displayMode: AssistantProcessDisplayMode;
  activitySummary: AssistantProcessActivitySummary;
  defaultOpen: boolean;
  phases: AssistantProcessPhase[];
}

export type AssistantProcessDisplayMode = 'live' | 'compact' | 'status';
export type AssistantProcessLifecycle = 'active' | 'closed_by_content' | 'settled';

export interface AssistantProcessActivitySummary {
  primary?: AssistantProcessActivitySummaryItem;
  items: AssistantProcessActivitySummaryItem[];
  mixed: boolean;
  totalCount: number;
}

export interface AssistantProcessActivitySummaryItem {
  key: string;
  icon: ToolDisplayResult['icon'];
  label: string;
  count: number;
}

export type AssistantProcessStatus =
  | 'model_deciding'
  | 'work_processing'
  | 'completed'
  | 'stopped'
  | 'failed';

export interface AssistantProcessSummary {
  status: AssistantProcessStatus;
  label: string;
  running: boolean;
  tone: 'default' | 'error';
}

export type AssistantProcessActivity =
  | AssistantThinkingActivity
  | AssistantToolActivity
  | AssistantStatusActivity;

export type AssistantProcessPhaseKind = 'model_responding' | 'tool_processing' | 'status';

export interface AssistantProcessPhase {
  kind: AssistantProcessPhaseKind;
  key: string;
  activities: AssistantProcessActivity[];
}

export interface AssistantThinkingActivity {
  type: 'thinking';
  key: string;
  content: ScoutThinkingContent;
  isStreaming: boolean;
  messageKey: string;
}

export interface AssistantToolActivity {
  type: 'tool';
  key: string;
  toolCall: ScoutToolCallContent;
  display: ToolDisplayResult;
  runtime?: ToolExecutionState;
  preview?: ToolCallPreviewState;
  toolResult?: ScoutToolResultMessage;
}

export interface AssistantStatusActivity {
  type: 'status';
  key: string;
  text: string;
  tone?: 'default' | 'error';
  running?: boolean;
}

export interface SystemConversationRow {
  type: 'system';
  key: string;
  title: string;
  text: string;
  tone: 'default' | 'error';
  defaultOpen: boolean;
}

export interface BuildConversationRowsOptions {
  items: ConversationItem[];
  isStreaming: boolean;
  busyState: ScoutBusyState;
  toolExecutionsById: Record<string, ToolExecutionState>;
  toolPreviewsById?: Record<string, ToolCallPreviewState>;
}
