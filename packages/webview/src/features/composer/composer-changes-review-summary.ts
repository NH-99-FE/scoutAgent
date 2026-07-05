// ============================================================
// Composer changes review summary — 输入框托盘变更摘要投影
// ============================================================

import type { ScoutChangesReviewSummary, ScoutFileEditPreview } from '@scout-agent/shared';

// ---------- Types ----------

export interface ComposerChangesReviewSummary {
  fileCount: number;
  additions: number;
  deletions: number;
  hasPreview: boolean;
  hasReview: boolean;
}

export interface ComposerToolPreviewState {
  preview: ScoutFileEditPreview;
}

// ---------- Projector ----------

export function createComposerChangesReviewSummary(
  changesReview: ScoutChangesReviewSummary | undefined,
  toolPreviewsById: Record<string, ComposerToolPreviewState>,
): ComposerChangesReviewSummary | undefined {
  const filesByPath = new Map<string, { path: string; additions: number; deletions: number }>();
  const settledPathKeys = new Set<string>();
  let hasPreviewFile = false;
  const hasReview = Boolean(changesReview);

  for (const file of changesReview?.files ?? []) {
    const key = getComposerChangePathKey(file.path);
    if (!key) continue;
    settledPathKeys.add(key);
    filesByPath.set(key, {
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
    });
  }

  for (const state of Object.values(toolPreviewsById)) {
    const preview = state.preview;
    if (preview.error) continue;
    const key = getComposerChangePathKey(preview.path);
    if (!key || settledPathKeys.has(key)) continue;
    const existing = filesByPath.get(key);
    if (existing) {
      existing.additions += preview.additions;
      existing.deletions += preview.deletions;
      hasPreviewFile = true;
      continue;
    }
    filesByPath.set(key, {
      path: preview.path,
      additions: preview.additions,
      deletions: preview.deletions,
    });
    hasPreviewFile = true;
  }

  const files = [...filesByPath.values()];
  if (files.length === 0) return undefined;

  return {
    fileCount: files.length,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    hasPreview: hasPreviewFile,
    hasReview,
  };
}

function getComposerChangePathKey(path: string): string {
  return path.trim();
}
