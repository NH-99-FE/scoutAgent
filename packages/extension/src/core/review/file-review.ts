// ============================================================
// File review store — 当前 runtime 内的文件变更审查数据
// 负责：捕获工具写入前后内容、按 turn 聚合、生成轻量 file_change details
// ============================================================

import { createHash } from 'node:crypto';
import * as Diff from 'diff';
import type { ScoutChangesReviewToken, ScoutFileChangeDetails } from '@scout-agent/shared';
import { getUtf8ByteLength, MAX_REVIEW_TEXT_BYTES } from '../text-size.ts';
import {
  applyReviewTokenDiff,
  createReviewIntralineRanges,
  createReviewLineTokens,
} from './review-syntax-tokens.ts';
import { normalizeReviewLineEndings, splitReviewLines } from './review-text.ts';

// ---------- 常量 ----------

export const FILE_REVIEW_PAYLOAD_KIND = 'file_review_payload';
export const FILE_CHANGE_DETAILS_KIND = 'file_change';
export const MAX_REVIEW_DIFF_ROWS = 20_000;
export const REVIEW_CONTEXT_LINES = 3;
export const MAX_RELEASED_REVIEW_TURNS = 20;

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

// ---------- 类型 ----------

export type FileReviewOperation = 'edit' | 'write';
export type FileReviewUnavailableReason =
  | 'Changes are no longer available'
  | 'Diff too large to review'
  | 'Original content unavailable'
  | 'Binary or unsupported encoding';
type ReviewStoredUnavailableReason = Exclude<
  FileReviewUnavailableReason,
  'Changes are no longer available'
>;

export interface FileReviewPayload {
  kind: typeof FILE_REVIEW_PAYLOAD_KIND;
  operation: FileReviewOperation;
  /** 工具调用中的原始 path 参数，保留给审计和 artifact。 */
  path: string;
  /** 可定位文件的规范路径，review 聚合和 host 打开文件都基于它。 */
  absolutePath: string;
  /** UI-only 展示路径，由创建 payload 的运行上下文格式化。 */
  displayPath?: string;
  originalContent: string | null;
  modifiedContent: string | null;
  unavailableReason?: Exclude<FileReviewUnavailableReason, 'Changes are no longer available'>;
}

export interface DecodedReviewContent {
  content: string | null;
  unavailableReason?: Exclude<FileReviewUnavailableReason, 'Changes are no longer available'>;
}

export interface FileReviewRecord {
  recordId: string;
  turnId: string;
  toolCallId: string;
  operation: FileReviewOperation;
  path: string;
  absolutePath: string;
  displayPath?: string;
  sequence: number;
  unavailableReason?: Exclude<FileReviewUnavailableReason, 'Changes are no longer available'>;
}

export interface FileReviewFile {
  absolutePath: string;
  path: string;
  displayPath?: string;
  originalContent: string | null;
  modifiedContent: string | null;
  recordIds: string[];
  latestRecordId: string;
  latestSequence: number;
  additions: number;
  deletions: number;
  firstChangedLine?: number;
  unavailableReason?: Exclude<FileReviewUnavailableReason, 'Changes are no longer available'>;
}

export interface FileReviewTurnSnapshot {
  turnId: string;
  files: FileReviewFile[];
  records: FileReviewRecord[];
  contentReleased?: boolean;
}

export interface ReviewDisplayRow {
  type: 'context' | 'added' | 'removed' | 'fold';
  oldLineNumber?: number;
  newLineNumber?: number;
  oldStartLine?: number;
  newStartLine?: number;
  text?: string;
  tokens?: ScoutChangesReviewToken[];
  count?: number;
}

export interface ReviewDiffResult {
  rows: ReviewDisplayRow[];
  additions: number;
  deletions: number;
  firstChangedLine?: number;
  unavailableReason?: Exclude<FileReviewUnavailableReason, 'Changes are no longer available'>;
}

export interface FileReviewContentFingerprint {
  size: number;
  sha256: string;
}

interface MutableFileReviewTurn {
  turnId: string;
  filesByPath: Map<string, MutableFileReviewFile>;
  records: FileReviewRecord[];
  contentReleased?: boolean;
}

interface MutableFileReviewFile extends FileReviewFile {
  aggregateUnavailableReason?: ReviewStoredUnavailableReason;
  modifiedUnavailableReason?: ReviewStoredUnavailableReason;
  originalUnavailableReason?: ReviewStoredUnavailableReason;
}

// ---------- Store ----------

export class FileReviewStore {
  private readonly turns = new Map<string, MutableFileReviewTurn>();
  private readonly releasedTurnIds: string[] = [];
  private readonly releasedTurnIdSet = new Set<string>();
  private sequence = 0;

  addRecord(
    turnId: string,
    toolCallId: string,
    payload: FileReviewPayload,
  ): ScoutFileChangeDetails {
    const recordId = `review-${this.sequence + 1}`;
    const sequence = ++this.sequence;
    const record: FileReviewRecord = {
      recordId,
      turnId,
      toolCallId,
      operation: payload.operation,
      path: payload.path,
      absolutePath: payload.absolutePath,
      displayPath: payload.displayPath,
      sequence,
      unavailableReason: payload.unavailableReason,
    };
    const turn = this.ensureTurn(turnId);
    turn.contentReleased = false;
    turn.records.push(record);

    const existing = turn.filesByPath.get(payload.absolutePath);
    const file: MutableFileReviewFile = existing
      ? {
          ...existing,
          path: payload.path,
          displayPath: payload.displayPath ?? existing.displayPath,
          modifiedContent: payload.modifiedContent,
          modifiedUnavailableReason:
            payload.modifiedContent === null ? payload.unavailableReason : undefined,
          recordIds: [...existing.recordIds, recordId],
          latestRecordId: recordId,
          latestSequence: sequence,
        }
      : {
          absolutePath: payload.absolutePath,
          path: payload.path,
          displayPath: payload.displayPath,
          originalContent: payload.originalContent,
          modifiedContent: payload.modifiedContent,
          originalUnavailableReason:
            payload.originalContent === null ? payload.unavailableReason : undefined,
          modifiedUnavailableReason:
            payload.modifiedContent === null ? payload.unavailableReason : undefined,
          recordIds: [recordId],
          latestRecordId: recordId,
          latestSequence: sequence,
          additions: 0,
          deletions: 0,
        };

    const aggregateUnavailableReason =
      file.aggregateUnavailableReason ??
      file.originalUnavailableReason ??
      file.modifiedUnavailableReason;
    const stats = computeReviewDiff(file.originalContent, file.modifiedContent, {
      collapseContext: false,
      unavailableReason: aggregateUnavailableReason,
    });
    if (stats.unavailableReason === 'Diff too large to review' && !aggregateUnavailableReason) {
      file.aggregateUnavailableReason = stats.unavailableReason;
      file.originalContent = null;
      file.modifiedContent = null;
    }
    file.additions = stats.additions;
    file.deletions = stats.deletions;
    file.firstChangedLine = stats.firstChangedLine;
    file.unavailableReason = stats.unavailableReason;
    turn.filesByPath.set(payload.absolutePath, file);

    return {
      kind: FILE_CHANGE_DETAILS_KIND,
      path: payload.absolutePath,
      displayPath: payload.displayPath,
      additions: file.additions,
      deletions: file.deletions,
      firstChangedLine: file.firstChangedLine,
      review: {
        turnId,
        recordId,
      },
    };
  }

  getTurn(turnId: string): FileReviewTurnSnapshot | undefined {
    const turn = this.turns.get(turnId);
    if (!turn) return undefined;
    return this.snapshotTurn(turn);
  }

  releaseTurnContent(turnId: string, options: { maxReleasedTurns?: number } = {}): boolean {
    const turn = this.turns.get(turnId);
    if (!turn) return false;

    for (const file of turn.filesByPath.values()) {
      file.originalContent = null;
      file.modifiedContent = null;
    }

    turn.contentReleased = true;
    this.markReleasedTurn(turnId);
    this.pruneReleasedTurns(options.maxReleasedTurns ?? MAX_RELEASED_REVIEW_TURNS);
    return true;
  }

  private snapshotTurn(turn: MutableFileReviewTurn): FileReviewTurnSnapshot {
    return {
      turnId: turn.turnId,
      records: [...turn.records],
      files: Array.from(turn.filesByPath.values())
        .sort((a, b) => b.latestSequence - a.latestSequence)
        .map((file) => this.snapshotFile(file)),
      contentReleased: turn.contentReleased || undefined,
    };
  }

  private snapshotFile(file: MutableFileReviewFile): FileReviewFile {
    return {
      absolutePath: file.absolutePath,
      path: file.path,
      displayPath: file.displayPath,
      originalContent: file.originalContent,
      modifiedContent: file.modifiedContent,
      recordIds: [...file.recordIds],
      latestRecordId: file.latestRecordId,
      latestSequence: file.latestSequence,
      additions: file.additions,
      deletions: file.deletions,
      firstChangedLine: file.firstChangedLine,
      unavailableReason: file.unavailableReason,
    };
  }

  private ensureTurn(turnId: string): MutableFileReviewTurn {
    const existing = this.turns.get(turnId);
    if (existing) return existing;
    const turn = { turnId, filesByPath: new Map<string, FileReviewFile>(), records: [] };
    this.turns.set(turnId, turn);
    return turn;
  }

  private markReleasedTurn(turnId: string): void {
    if (this.releasedTurnIdSet.has(turnId)) return;
    this.releasedTurnIdSet.add(turnId);
    this.releasedTurnIds.push(turnId);
  }

  private pruneReleasedTurns(maxReleasedTurns: number): void {
    if (maxReleasedTurns <= 0) {
      for (const turnId of this.releasedTurnIds) {
        this.turns.delete(turnId);
      }
      this.releasedTurnIds.length = 0;
      this.releasedTurnIdSet.clear();
      return;
    }

    while (this.releasedTurnIds.length > maxReleasedTurns) {
      const turnId = this.releasedTurnIds.shift();
      if (!turnId) return;
      this.releasedTurnIdSet.delete(turnId);
      this.turns.delete(turnId);
    }
  }
}

// ---------- Payload helpers ----------

export function isFileReviewPayload(value: unknown): value is FileReviewPayload {
  if (!isRecord(value)) return false;
  return (
    value.kind === FILE_REVIEW_PAYLOAD_KIND &&
    isFileReviewOperation(value.operation) &&
    typeof value.path === 'string' &&
    typeof value.absolutePath === 'string' &&
    isOptionalString(value.displayPath) &&
    isNullableString(value.originalContent) &&
    isNullableString(value.modifiedContent) &&
    isOptionalPayloadUnavailableReason(value.unavailableReason)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function isFileReviewOperation(value: unknown): value is FileReviewOperation {
  return value === 'edit' || value === 'write';
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalPayloadUnavailableReason(
  value: unknown,
): value is Exclude<FileReviewUnavailableReason, 'Changes are no longer available'> | undefined {
  return (
    value === undefined ||
    value === 'Diff too large to review' ||
    value === 'Original content unavailable' ||
    value === 'Binary or unsupported encoding'
  );
}

export function decodeReviewContent(buffer: Buffer): DecodedReviewContent {
  try {
    const content = UTF8_DECODER.decode(buffer);
    if (content.includes('\u0000')) {
      return { content: null, unavailableReason: 'Binary or unsupported encoding' };
    }
    return { content };
  } catch {
    return { content: null, unavailableReason: 'Binary or unsupported encoding' };
  }
}

export function createReviewContentFingerprint(
  content: string | null,
): FileReviewContentFingerprint | undefined {
  if (content === null) return undefined;
  return {
    size: Buffer.byteLength(content, 'utf-8'),
    sha256: createHash('sha256').update(content, 'utf-8').digest('hex'),
  };
}

export function isSameReviewContentFingerprint(
  left: FileReviewContentFingerprint | undefined,
  right: FileReviewContentFingerprint | undefined,
): boolean {
  return Boolean(left && right && left.size === right.size && left.sha256 === right.sha256);
}

// ---------- Diff ----------

export function computeReviewDiff(
  originalContent: string | null,
  modifiedContent: string | null,
  options: {
    collapseContext?: boolean;
    contextLines?: number;
    filePath?: string;
    unavailableReason?: Exclude<FileReviewUnavailableReason, 'Changes are no longer available'>;
  } = {},
): ReviewDiffResult {
  if (options.unavailableReason) {
    return {
      rows: [],
      additions: 0,
      deletions: 0,
      unavailableReason: options.unavailableReason,
    };
  }

  if (originalContent !== null && modifiedContent !== null && originalContent === modifiedContent) {
    return {
      rows: [],
      additions: 0,
      deletions: 0,
    };
  }

  if (
    getUtf8ByteLength(originalContent) > MAX_REVIEW_TEXT_BYTES ||
    getUtf8ByteLength(modifiedContent) > MAX_REVIEW_TEXT_BYTES
  ) {
    return {
      rows: [],
      ...estimateLargeFileStats(originalContent, modifiedContent),
      unavailableReason: 'Diff too large to review',
    };
  }

  const normalizedOriginalContent =
    originalContent === null ? null : normalizeReviewLineEndings(originalContent);
  const normalizedModifiedContent =
    modifiedContent === null ? null : normalizeReviewLineEndings(modifiedContent);
  if (
    normalizedOriginalContent !== null &&
    normalizedModifiedContent !== null &&
    normalizedOriginalContent === normalizedModifiedContent
  ) {
    return {
      rows: [],
      additions: 0,
      deletions: 0,
    };
  }

  const rows = buildDiffRows(
    normalizedOriginalContent ?? '',
    normalizedModifiedContent ?? '',
    options.filePath,
  );
  const additions = rows.filter((row) => row.type === 'added').length;
  const deletions = rows.filter((row) => row.type === 'removed').length;
  const firstChangedRow = rows.find((row) => row.type === 'added' || row.type === 'removed');
  const firstChangedLine = firstChangedRow?.newLineNumber ?? firstChangedRow?.oldLineNumber;

  if (additions === 0 && deletions === 0) {
    return {
      rows: [],
      additions,
      deletions,
    };
  }

  if (rows.length > MAX_REVIEW_DIFF_ROWS) {
    return {
      rows: [],
      additions,
      deletions,
      firstChangedLine,
      unavailableReason: 'Diff too large to review',
    };
  }

  return {
    rows: options.collapseContext
      ? collapseUnchangedRows(rows, options.contextLines ?? REVIEW_CONTEXT_LINES)
      : rows,
    additions,
    deletions,
    firstChangedLine,
  };
}

function buildDiffRows(
  normalizedOriginalContent: string,
  normalizedModifiedContent: string,
  filePath?: string,
): ReviewDisplayRow[] {
  const rows: ReviewDisplayRow[] = [];
  const originalLines = splitReviewLines(normalizedOriginalContent);
  const modifiedLines = splitReviewLines(normalizedModifiedContent);
  const tokenLines = filePath
    ? {
        original: createReviewLineTokens(normalizedOriginalContent, filePath),
        modified: createReviewLineTokens(normalizedModifiedContent, filePath),
      }
    : undefined;
  let oldLineNumber = 1;
  let newLineNumber = 1;

  const parts = Diff.diffLines(normalizedOriginalContent, normalizedModifiedContent);
  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex];
    const lines = splitReviewLines(part.value);
    const nextPart = parts[partIndex + 1];

    if (part.removed && nextPart?.added) {
      const removedLines = lines;
      const addedLines = splitReviewLines(nextPart.value);
      const oldStartLine = oldLineNumber;
      const newStartLine = newLineNumber;

      removedLines.forEach((line, index) => {
        const oldLineIndex = oldStartLine - 1 + index;
        const row = createRemovedRow(
          oldLineNumber,
          originalLines[oldLineIndex] ?? line,
          tokenLines?.original[oldLineIndex],
        );
        if (index < addedLines.length) {
          const newLineIndex = newStartLine - 1 + index;
          const ranges = createReviewIntralineRanges(
            row.text ?? '',
            modifiedLines[newLineIndex] ?? addedLines[index] ?? '',
          );
          row.tokens = applyReviewTokenDiff(row.tokens, ranges.removed, 'removed');
        }
        rows.push(row);
        oldLineNumber += 1;
      });

      addedLines.forEach((line, index) => {
        const newLineIndex = newStartLine - 1 + index;
        const row = createAddedRow(
          newLineNumber,
          modifiedLines[newLineIndex] ?? line,
          tokenLines?.modified[newLineIndex],
        );
        if (index < removedLines.length) {
          const oldLineIndex = oldStartLine - 1 + index;
          const ranges = createReviewIntralineRanges(
            originalLines[oldLineIndex] ?? removedLines[index] ?? '',
            row.text ?? '',
          );
          row.tokens = applyReviewTokenDiff(row.tokens, ranges.added, 'added');
        }
        rows.push(row);
        newLineNumber += 1;
      });

      partIndex += 1;
      continue;
    }

    for (const line of lines) {
      if (part.added) {
        const lineIndex = newLineNumber - 1;
        rows.push(
          createAddedRow(
            newLineNumber,
            modifiedLines[lineIndex] ?? line,
            tokenLines?.modified[lineIndex],
          ),
        );
        newLineNumber += 1;
      } else if (part.removed) {
        const lineIndex = oldLineNumber - 1;
        rows.push(
          createRemovedRow(
            oldLineNumber,
            originalLines[lineIndex] ?? line,
            tokenLines?.original[lineIndex],
          ),
        );
        oldLineNumber += 1;
      } else {
        const lineIndex = newLineNumber - 1;
        rows.push({
          type: 'context',
          oldLineNumber,
          newLineNumber,
          text: modifiedLines[lineIndex] ?? line,
          tokens: tokenLines?.modified[lineIndex],
        });
        oldLineNumber += 1;
        newLineNumber += 1;
      }
    }
  }

  return rows;
}

function createAddedRow(
  newLineNumber: number,
  text: string,
  tokens: ScoutChangesReviewToken[] | undefined,
): ReviewDisplayRow {
  return { type: 'added', newLineNumber, text, tokens };
}

function createRemovedRow(
  oldLineNumber: number,
  text: string,
  tokens: ScoutChangesReviewToken[] | undefined,
): ReviewDisplayRow {
  return { type: 'removed', oldLineNumber, text, tokens };
}

function collapseUnchangedRows(rows: ReviewDisplayRow[], contextLines: number): ReviewDisplayRow[] {
  const changedIndexes = rows
    .map((row, index) => (row.type === 'added' || row.type === 'removed' ? index : -1))
    .filter((index) => index >= 0);
  if (changedIndexes.length === 0) return rows;

  const visible = new Set<number>();
  for (const index of changedIndexes) {
    const start = Math.max(0, index - contextLines);
    const end = Math.min(rows.length - 1, index + contextLines);
    for (let i = start; i <= end; i += 1) {
      visible.add(i);
    }
  }

  const collapsed: ReviewDisplayRow[] = [];
  let hiddenCount = 0;
  let oldStartLine: number | undefined;
  let newStartLine: number | undefined;
  const flushHidden = (): void => {
    if (hiddenCount === 0) return;
    collapsed.push({ type: 'fold', count: hiddenCount, oldStartLine, newStartLine });
    hiddenCount = 0;
    oldStartLine = undefined;
    newStartLine = undefined;
  };

  rows.forEach((row, index) => {
    if (row.type === 'context' && !visible.has(index)) {
      if (hiddenCount === 0) {
        oldStartLine = row.oldLineNumber;
        newStartLine = row.newLineNumber;
      }
      hiddenCount += 1;
      return;
    }
    flushHidden();
    collapsed.push(row);
  });
  flushHidden();

  return collapsed;
}

function estimateLargeFileStats(
  originalContent: string | null,
  modifiedContent: string | null,
): { additions: number; deletions: number } {
  if (originalContent === null) return { additions: countLines(modifiedContent), deletions: 0 };
  if (modifiedContent === null) return { additions: 0, deletions: countLines(originalContent) };
  return {
    additions: countLines(modifiedContent),
    deletions: countLines(originalContent),
  };
}

function countLines(content: string | null): number {
  if (!content) return 0;
  return splitReviewLines(content).length;
}
