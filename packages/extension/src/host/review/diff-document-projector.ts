// ============================================================
// DiffDocument projector — canonical document 到 lazy shared view
// ============================================================

import type { ScoutChangesReviewRow, ScoutFileDiffView } from '@scout-agent/shared';
import type { DiffDocument, DiffHunk } from '../../core/review/index.ts';
import { ReviewTokenCache } from './review-token-cache.ts';

// ---------- 类型 ----------

export interface FileDiffProjectionPolicy {
  mode: 'unified' | 'split';
  includeTokens: boolean;
  hunkOffset: number;
  hunkLimit: number;
  maxRows: number;
}

export interface DiffDocumentProjectorOptions {
  tokenCache?: ReviewTokenCache;
}

// ---------- Projector ----------

export class DiffDocumentProjector {
  private readonly tokenCache: ReviewTokenCache;

  constructor(options: DiffDocumentProjectorOptions = {}) {
    this.tokenCache = options.tokenCache ?? new ReviewTokenCache();
  }

  project(
    document: DiffDocument,
    filePath: string,
    policy: FileDiffProjectionPolicy,
  ): ScoutFileDiffView {
    const totalHunks = document.hunks.length;
    const hunkOffset = Math.min(totalHunks, Math.max(0, policy.hunkOffset));
    const selectedHunks = document.hunks.slice(
      hunkOffset,
      hunkOffset + Math.max(0, policy.hunkLimit),
    );
    const allRows = projectHunks(
      document,
      selectedHunks,
      hunkOffset === 0,
      hunkOffset + selectedHunks.length === totalHunks,
    );
    const rows = allRows.slice(0, Math.max(0, policy.maxRows));
    const projectedRows = policy.includeTokens ? this.tokenCache.tokenize(rows, filePath) : rows;

    return {
      mode: policy.mode,
      rows: projectedRows,
      additions: document.additions,
      deletions: document.deletions,
      firstChangedLine: document.firstChangedLine,
      hunkOffset,
      hunkCount: selectedHunks.length,
      totalHunks,
      truncated:
        hunkOffset + selectedHunks.length < totalHunks || rows.length < allRows.length || undefined,
    };
  }

  clear(): void {
    this.tokenCache.clear();
  }
}

function projectHunks(
  document: DiffDocument,
  hunks: readonly DiffHunk[],
  includeLeadingContext: boolean,
  includeTrailingContext: boolean,
): ScoutChangesReviewRow[] {
  const rows: ScoutChangesReviewRow[] = [];
  let previousOldEnd: number | undefined;
  let previousNewEnd: number | undefined;

  for (const hunk of hunks) {
    if (previousOldEnd === undefined && previousNewEnd === undefined && includeLeadingContext) {
      appendFold(rows, 1, 1, hunk.oldStart, hunk.newStart);
    }
    if (previousOldEnd !== undefined && previousNewEnd !== undefined) {
      appendFold(rows, previousOldEnd, previousNewEnd, hunk.oldStart, hunk.newStart);
    }

    let oldLineNumber = hunk.oldStart;
    let newLineNumber = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.type === 'context') {
        rows.push({ type: 'context', oldLineNumber, newLineNumber, text: line.text });
        oldLineNumber += 1;
        newLineNumber += 1;
      } else if (line.type === 'removed') {
        rows.push({ type: 'removed', oldLineNumber, text: line.text });
        oldLineNumber += 1;
      } else {
        rows.push({ type: 'added', newLineNumber, text: line.text });
        newLineNumber += 1;
      }
    }
    previousOldEnd = hunk.oldStart + hunk.oldLines;
    previousNewEnd = hunk.newStart + hunk.newLines;
  }

  if (includeTrailingContext && previousOldEnd !== undefined && previousNewEnd !== undefined) {
    appendFold(
      rows,
      previousOldEnd,
      previousNewEnd,
      document.beforeLineCount + 1,
      document.afterLineCount + 1,
    );
  }

  return rows;
}

function appendFold(
  rows: ScoutChangesReviewRow[],
  oldStartLine: number,
  newStartLine: number,
  oldEndLine: number,
  newEndLine: number,
): void {
  const oldCount = Math.max(0, oldEndLine - oldStartLine);
  const newCount = Math.max(0, newEndLine - newStartLine);
  const count = Math.max(oldCount, newCount);
  if (count <= 0) return;
  rows.push({ type: 'fold', oldStartLine, newStartLine, count });
}
