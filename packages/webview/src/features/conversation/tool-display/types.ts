// ============================================================
// Tool Display Types — 工具展示模型类型
// ============================================================

import type { ScoutToolCallContent, ScoutToolResultMessage } from '@scout-agent/shared';
import type { ToolCallPreviewState, ToolExecutionState } from '@/store/conversation-store';

export type ToolDisplayStatus = 'pending' | 'running' | 'done' | 'error' | 'stopped';
export type ToolDisplayIcon =
  | 'terminal'
  | 'file'
  | 'folder'
  | 'edit'
  | 'search'
  | 'clipboard-list'
  | 'tool';
export type ToolDisplayMetricTone = 'default' | 'added' | 'deleted' | 'muted';
export type ToolDisplayMetricPlacement = 'inline' | 'end';

export interface ToolDisplayMetric {
  key: string;
  value: string | number;
  label?: string;
  prefix?: string;
  tone?: ToolDisplayMetricTone;
}

export interface ToolDisplaySummaryParts {
  action: string;
  target?: string;
}

export interface ToolDisplaySummary {
  title: string;
  parts?: ToolDisplaySummaryParts;
}

export interface TextToolDisplayDetail {
  kind: 'text';
  title: string;
  text: string;
  completionLabel: string;
}

export interface DiffToolDisplayDetail {
  kind: 'diff';
  diffText: string;
  title?: string;
  path?: string;
  additions?: number;
  deletions?: number;
  previewError?: string;
}

export type ToolDisplayDetail = TextToolDisplayDetail | DiffToolDisplayDetail;

export interface ToolDisplayResult {
  kind: string;
  status: ToolDisplayStatus;
  toolName: string;
  summary: ToolDisplaySummary;
  icon: ToolDisplayIcon;
  detail?: ToolDisplayDetail;
  detailLabel?: string;
  detailTarget?: string;
  metrics?: ToolDisplayMetric[];
  metricsPlacement?: ToolDisplayMetricPlacement;
}

export interface ToolActivitySummarySpec {
  key: string;
  icon: ToolDisplayIcon;
}

export interface GenericToolDisplayResult extends ToolDisplayResult {
  kind: 'generic';
  detail?: TextToolDisplayDetail;
}

export interface FileEditToolDisplayResult extends ToolDisplayResult {
  kind: 'file_edit';
  path: string;
  detail?: DiffToolDisplayDetail;
  additions: number;
  deletions: number;
}

export interface ResolveToolDisplayOptions {
  toolCall: ScoutToolCallContent;
  runtime?: ToolExecutionState;
  preview?: ToolCallPreviewState;
  toolResult?: ScoutToolResultMessage;
  assistantErrorMessage?: string;
  assistantStopReason?: string;
}

export interface ToolDisplayContext {
  toolName: string;
  args: Record<string, unknown> | undefined;
  argsText: string;
  status: ToolDisplayStatus;
  bodyText: string;
  isError: boolean;
  completionLabel: string;
  details?: unknown;
  preview?: ToolCallPreviewState;
}

export interface CreateToolDisplayContextOptions {
  toolName: string;
  args: Record<string, unknown> | undefined;
  runtime?: ToolExecutionState;
  preview?: ToolCallPreviewState;
  toolResult?: ScoutToolResultMessage;
  assistantErrorMessage?: string;
  assistantStopReason?: string;
}

export type ToolDisplayPresenter = (context: ToolDisplayContext) => ToolDisplayResult | undefined;
