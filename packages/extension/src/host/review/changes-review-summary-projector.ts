// ============================================================
// Changes review summary projector — 宿主侧 review 摘要投影
// 负责：把 runtime/artifact 的文件变更模型稳定投影为 shared summary。
// ============================================================

import type { ScoutChangesReviewSummary } from '@scout-agent/shared';
import type { FileReviewTurnSnapshot } from '../../core/review/file-review.ts';
import type { FileReviewArtifact } from './file-review-artifact.ts';

// ---------- 类型 ----------

interface ChangesReviewSummaryFileInput {
  path: string;
  displayPath?: string;
  additions: number;
  deletions: number;
  latestSequence?: number;
}

interface ChangesReviewSummaryInput {
  turnId: string;
  files: readonly ChangesReviewSummaryFileInput[];
}

interface GroupedChangesReviewSummaryFile extends ChangesReviewSummaryFileInput {
  order: number;
}

// ---------- Projector ----------

export function createRuntimeChangesReviewSummary(
  review: FileReviewTurnSnapshot,
): ScoutChangesReviewSummary {
  return createChangesReviewSummary({
    turnId: review.turnId,
    files: review.files.map((file) => ({
      path: file.absolutePath,
      displayPath: file.displayPath ?? file.path,
      additions: file.additions,
      deletions: file.deletions,
      latestSequence: file.latestSequence,
    })),
  });
}

export function createArtifactChangesReviewSummary(
  artifact: FileReviewArtifact,
): ScoutChangesReviewSummary {
  return createChangesReviewSummary({
    turnId: artifact.turnId,
    files: artifact.files.map((file) => ({
      path: file.absolutePath,
      displayPath: file.displayPath ?? file.path,
      additions: file.additions,
      deletions: file.deletions,
      latestSequence: file.latestSequence,
    })),
  });
}

function createChangesReviewSummary(input: ChangesReviewSummaryInput): ScoutChangesReviewSummary {
  const files = groupSummaryFiles(input.files);
  return {
    turnId: input.turnId,
    fileCount: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files: files.map((file) => ({
      path: file.path,
      displayPath: file.displayPath,
      additions: file.additions,
      deletions: file.deletions,
    })),
  };
}

function groupSummaryFiles(
  files: readonly ChangesReviewSummaryFileInput[],
): GroupedChangesReviewSummaryFile[] {
  const latestByPath = new Map<string, GroupedChangesReviewSummaryFile>();

  files.forEach((file, order) => {
    const existing = latestByPath.get(file.path);
    if (!existing || isNewerSummaryFile(file, order, existing)) {
      latestByPath.set(file.path, { ...file, order });
    }
  });

  return Array.from(latestByPath.values()).sort(compareSummaryFiles);
}

function isNewerSummaryFile(
  file: ChangesReviewSummaryFileInput,
  order: number,
  existing: GroupedChangesReviewSummaryFile,
): boolean {
  if (file.latestSequence !== undefined || existing.latestSequence !== undefined) {
    return (file.latestSequence ?? -1) >= (existing.latestSequence ?? -1);
  }
  return order >= existing.order;
}

function compareSummaryFiles(
  left: GroupedChangesReviewSummaryFile,
  right: GroupedChangesReviewSummaryFile,
): number {
  if (left.latestSequence !== undefined || right.latestSequence !== undefined) {
    return (right.latestSequence ?? -1) - (left.latestSequence ?? -1);
  }
  return right.order - left.order;
}
