// ============================================================
// Tool Display Model — 工具展示模型判定
// ============================================================

import type { ToolDisplayDetail, ToolDisplayResult } from './types';

export function hasToolDisplaySummary(display: ToolDisplayResult): boolean {
  return display.summary.title.trim().length > 0;
}

export function hasExpandableToolDisplayDetail(display: ToolDisplayResult): boolean {
  return display.detail ? hasToolDisplayDetail(display.detail) : false;
}

export function hasToolDisplayDetail(detail: ToolDisplayDetail): boolean {
  if (detail.kind === 'text') return detail.text.trim().length > 0;
  if (detail.kind === 'diff') {
    return Boolean(detail.previewError?.trim() || detail.diffText.trim());
  }
  return false;
}
