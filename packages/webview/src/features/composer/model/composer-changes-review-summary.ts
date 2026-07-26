// ============================================================
// Composer changes review summary — 输入框托盘变更摘要投影
// ============================================================

import type { ScoutChangesReviewSummary } from '@scout-agent/shared';

// ---------- Types ----------

export interface ComposerChangesReviewSummary {
  fileCount: number;
  additions: number;
  deletions: number;
}

// ---------- Projector ----------

export function createComposerChangesReviewSummary(
  changesReview: ScoutChangesReviewSummary | undefined,
): ComposerChangesReviewSummary | undefined {
  const files = changesReview?.files ?? [];
  if (files.length === 0) return undefined;

  return {
    fileCount: files.length,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  };
}
