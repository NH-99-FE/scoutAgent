// ============================================================
// Canonical diff document — 文件审查的规范化中间表示
// 负责：一次性计算行级 diff、统计、fingerprint 与有限上下文 hunk。
// ============================================================

import { createHash } from 'node:crypto';
import * as Diff from 'diff';
import type { ScoutChangesReviewToken } from '@scout-agent/shared';
import { getUtf8ByteLength, MAX_REVIEW_TEXT_BYTES } from '../text-size.ts';
import { normalizeReviewLineEndings, splitReviewLines } from './review-text.ts';

// ---------- 常量 ----------

export const DIFF_DOCUMENT_VERSION = 1;
export const MAX_REVIEW_DIFF_ROWS = 20_000;
export const REVIEW_CONTEXT_LINES = 3;

// ---------- 类型 ----------

export type DiffUnavailableReason =
  | 'original_unavailable'
  | 'modified_unavailable'
  | 'binary_or_unsupported'
  | 'content_too_large'
  | 'diff_too_large'
  | 'generation_failed'
  | 'content_released';

export interface DiffContentFingerprint {
  size: number;
  sha256: string;
}

export interface DiffDocument {
  version: typeof DIFF_DOCUMENT_VERSION;
  beforeFingerprint?: DiffContentFingerprint;
  afterFingerprint?: DiffContentFingerprint;
  beforeLineCount: number;
  afterLineCount: number;
  additions: number;
  deletions: number;
  firstChangedLine?: number;
  hunks: DiffHunk[];
  unavailableReason?: DiffUnavailableReason;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export type DiffLine =
  | { type: 'context'; text: string }
  | { type: 'removed'; text: string }
  | { type: 'added'; text: string };

export interface DiffDisplayRow {
  type: 'context' | 'added' | 'removed' | 'fold';
  oldLineNumber?: number;
  newLineNumber?: number;
  oldStartLine?: number;
  newStartLine?: number;
  text?: string;
  tokens?: ScoutChangesReviewToken[];
  count?: number;
}

export interface CreateDiffDocumentOptions {
  contextLines?: number;
  unavailableReason?: DiffUnavailableReason;
}

export interface ProjectDiffDocumentRowsOptions {
  collapseContext?: boolean;
}

export interface DiffDocumentSummary {
  additions: number;
  deletions: number;
  firstChangedLine?: number;
  unavailableReason?: DiffUnavailableReason;
}

type NumberedDiffLine = DiffLine & {
  oldPositionBefore: number;
  newPositionBefore: number;
};

// ---------- Document ----------

export function createDiffDocument(
  beforeContent: string | null,
  afterContent: string | null,
  options: CreateDiffDocumentOptions = {},
): DiffDocument {
  const beforeFingerprint = createDiffContentFingerprint(beforeContent);
  const afterFingerprint = createDiffContentFingerprint(afterContent);

  if (options.unavailableReason) {
    return createUnavailableDocument(
      beforeContent,
      afterContent,
      beforeFingerprint,
      afterFingerprint,
      options.unavailableReason,
    );
  }

  if (beforeContent !== null && afterContent !== null && beforeContent === afterContent) {
    const lineCount = countLines(beforeContent);
    return createEmptyDocument(beforeFingerprint, afterFingerprint, lineCount, lineCount);
  }

  if (
    getUtf8ByteLength(beforeContent) > MAX_REVIEW_TEXT_BYTES ||
    getUtf8ByteLength(afterContent) > MAX_REVIEW_TEXT_BYTES
  ) {
    const stats = estimateLargeFileStats(beforeContent, afterContent);
    return {
      ...createEmptyDocument(
        beforeFingerprint,
        afterFingerprint,
        countLines(beforeContent),
        countLines(afterContent),
      ),
      ...stats,
      unavailableReason: 'content_too_large',
    };
  }

  const normalizedBefore = normalizeReviewLineEndings(beforeContent ?? '');
  const normalizedAfter = normalizeReviewLineEndings(afterContent ?? '');
  const beforeLineCount = countLines(normalizedBefore);
  const afterLineCount = countLines(normalizedAfter);

  if (normalizedBefore === normalizedAfter) {
    return createEmptyDocument(
      beforeFingerprint,
      afterFingerprint,
      beforeLineCount,
      afterLineCount,
    );
  }

  const lines = buildNumberedDiffLines(normalizedBefore, normalizedAfter);
  const additions = lines.filter((line) => line.type === 'added').length;
  const deletions = lines.filter((line) => line.type === 'removed').length;
  const firstChanged = lines.find((line) => line.type !== 'context');
  const firstChangedLine = firstChanged
    ? firstChanged.type === 'added'
      ? firstChanged.newPositionBefore
      : firstChanged.oldPositionBefore
    : undefined;

  if (additions === 0 && deletions === 0) {
    return createEmptyDocument(
      beforeFingerprint,
      afterFingerprint,
      beforeLineCount,
      afterLineCount,
    );
  }

  if (lines.length > MAX_REVIEW_DIFF_ROWS) {
    return {
      ...createEmptyDocument(beforeFingerprint, afterFingerprint, beforeLineCount, afterLineCount),
      additions,
      deletions,
      firstChangedLine,
      unavailableReason: 'diff_too_large',
    };
  }

  return {
    version: DIFF_DOCUMENT_VERSION,
    beforeFingerprint,
    afterFingerprint,
    beforeLineCount,
    afterLineCount,
    additions,
    deletions,
    firstChangedLine,
    hunks: buildDiffHunks(lines, options.contextLines ?? REVIEW_CONTEXT_LINES),
  };
}

export function createDiffContentFingerprint(
  content: string | null,
): DiffContentFingerprint | undefined {
  if (content === null) return undefined;
  return {
    size: Buffer.byteLength(content, 'utf-8'),
    sha256: createHash('sha256').update(content, 'utf-8').digest('hex'),
  };
}

export function createUnavailableDiffDocument(
  unavailableReason: DiffUnavailableReason,
): DiffDocument {
  return createUnavailableDocument(null, null, undefined, undefined, unavailableReason);
}

export function isSameDiffContentFingerprint(
  left: DiffContentFingerprint | undefined,
  right: DiffContentFingerprint | undefined,
): boolean {
  return Boolean(left && right && left.size === right.size && left.sha256 === right.sha256);
}

// ---------- Projection ----------

export function projectDiffDocumentSummary(document: DiffDocument): DiffDocumentSummary {
  return {
    additions: document.additions,
    deletions: document.deletions,
    firstChangedLine: document.firstChangedLine,
    unavailableReason: document.unavailableReason,
  };
}

export function projectDiffDocumentRows(
  document: DiffDocument,
  options: ProjectDiffDocumentRowsOptions = {},
): DiffDisplayRow[] {
  if (document.unavailableReason || document.hunks.length === 0) return [];

  const rows: DiffDisplayRow[] = [];
  const collapseContext = options.collapseContext ?? true;
  let nextOldLine = 1;
  let nextNewLine = 1;

  for (const hunk of document.hunks) {
    if (collapseContext) {
      appendFoldRow(rows, nextOldLine, nextNewLine, hunk.oldStart, hunk.newStart);
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

    nextOldLine = hunk.oldStart + hunk.oldLines;
    nextNewLine = hunk.newStart + hunk.newLines;
  }

  if (collapseContext) {
    appendFoldRow(
      rows,
      nextOldLine,
      nextNewLine,
      document.beforeLineCount + 1,
      document.afterLineCount + 1,
    );
  }
  return rows;
}

// ---------- Line diff ----------

function buildNumberedDiffLines(
  normalizedBefore: string,
  normalizedAfter: string,
): NumberedDiffLine[] {
  const lines: NumberedDiffLine[] = [];
  let oldPositionBefore = 1;
  let newPositionBefore = 1;

  for (const part of Diff.diffLines(normalizedBefore, normalizedAfter)) {
    for (const text of splitReviewLines(part.value)) {
      const type = part.added ? 'added' : part.removed ? 'removed' : 'context';
      lines.push({ type, text, oldPositionBefore, newPositionBefore });
      if (type !== 'added') oldPositionBefore += 1;
      if (type !== 'removed') newPositionBefore += 1;
    }
  }
  return lines;
}

function buildDiffHunks(lines: readonly NumberedDiffLine[], contextLines: number): DiffHunk[] {
  const normalizedContextLines = Math.max(0, Math.floor(contextLines));
  const visible = new Set<number>();

  lines.forEach((line, index) => {
    if (line.type === 'context') return;
    const start = Math.max(0, index - normalizedContextLines);
    const end = Math.min(lines.length - 1, index + normalizedContextLines);
    for (let visibleIndex = start; visibleIndex <= end; visibleIndex += 1) {
      visible.add(visibleIndex);
    }
  });

  const visibleIndexes = Array.from(visible).sort((left, right) => left - right);
  const hunks: DiffHunk[] = [];
  let start = visibleIndexes[0];
  let end = start;

  for (const index of visibleIndexes.slice(1)) {
    if (index === end + 1) {
      end = index;
      continue;
    }
    hunks.push(createDiffHunk(lines, start, end));
    start = index;
    end = index;
  }
  if (start !== undefined && end !== undefined) {
    hunks.push(createDiffHunk(lines, start, end));
  }
  return hunks;
}

function createDiffHunk(lines: readonly NumberedDiffLine[], start: number, end: number): DiffHunk {
  const selected = lines.slice(start, end + 1);
  const first = selected[0];
  return {
    oldStart: first?.oldPositionBefore ?? 1,
    oldLines: selected.filter((line) => line.type !== 'added').length,
    newStart: first?.newPositionBefore ?? 1,
    newLines: selected.filter((line) => line.type !== 'removed').length,
    lines: selected.map(({ type, text }) => ({ type, text }) as DiffLine),
  };
}

// ---------- Helpers ----------

function createEmptyDocument(
  beforeFingerprint: DiffContentFingerprint | undefined,
  afterFingerprint: DiffContentFingerprint | undefined,
  beforeLineCount: number,
  afterLineCount: number,
): DiffDocument {
  return {
    version: DIFF_DOCUMENT_VERSION,
    beforeFingerprint,
    afterFingerprint,
    beforeLineCount,
    afterLineCount,
    additions: 0,
    deletions: 0,
    hunks: [],
  };
}

function createUnavailableDocument(
  beforeContent: string | null,
  afterContent: string | null,
  beforeFingerprint: DiffContentFingerprint | undefined,
  afterFingerprint: DiffContentFingerprint | undefined,
  unavailableReason: DiffUnavailableReason,
): DiffDocument {
  return {
    ...createEmptyDocument(
      beforeFingerprint,
      afterFingerprint,
      countLines(beforeContent),
      countLines(afterContent),
    ),
    unavailableReason,
  };
}

function appendFoldRow(
  rows: DiffDisplayRow[],
  oldStartLine: number,
  newStartLine: number,
  oldEndLine: number,
  newEndLine: number,
): void {
  const oldCount = Math.max(0, oldEndLine - oldStartLine);
  const newCount = Math.max(0, newEndLine - newStartLine);
  const count = Math.max(oldCount, newCount);
  if (count === 0) return;
  rows.push({ type: 'fold', count, oldStartLine, newStartLine });
}

function estimateLargeFileStats(
  beforeContent: string | null,
  afterContent: string | null,
): { additions: number; deletions: number } {
  if (beforeContent === null) return { additions: countLines(afterContent), deletions: 0 };
  if (afterContent === null) return { additions: 0, deletions: countLines(beforeContent) };
  return {
    additions: countLines(afterContent),
    deletions: countLines(beforeContent),
  };
}

function countLines(content: string | null): number {
  if (!content) return 0;
  return splitReviewLines(content).length;
}
