// ============================================================
// Tool Display — barrel file
// ============================================================

export { contentToText } from './content';
export {
  formatMixedToolActivitySummaryLabel,
  formatToolActivitySummaryLabel,
  resolveToolActivitySummary,
} from './helpers';
export { hasExpandableToolDisplayDetail, hasToolDisplaySummary } from './model';
export { resolveToolDisplayResult } from './resolve-tool-display';
export type {
  DiffToolDisplayDetail,
  FileEditToolDisplayResult,
  FileWriteToolDisplayResult,
  GenericToolDisplayResult,
  ResolveToolDisplayOptions,
  TextToolDisplayDetail,
  ToolDisplayDetail,
  ToolDisplayIcon,
  ToolDisplayMetric,
  ToolDisplayMetricPlacement,
  ToolDisplayMetricTone,
  ToolDisplayResult,
  ToolDisplayStatus,
  ToolActivitySummarySpec,
  WriteContentToolDisplayDetail,
} from './types';
