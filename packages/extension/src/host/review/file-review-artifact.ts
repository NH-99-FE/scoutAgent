// ============================================================
// File review artifact — 宿主持久化审查视图
// 负责：把 core runtime snapshot 物化为可恢复的 review artifact，并校验落盘内容。
// ============================================================

import {
  computeReviewDiff,
  createReviewContentFingerprint,
  REVIEW_CONTEXT_LINES,
  type FileReviewContentFingerprint,
  type FileReviewOperation,
  type FileReviewTurnSnapshot,
  type FileReviewUnavailableReason,
  type ReviewDisplayRow,
} from '../../core/review/file-review.ts';
import type { SessionTreeEntry } from '../../core/session/index.ts';

// ---------- 常量 ----------

export const FILE_REVIEW_ARTIFACT_VERSION = 1;
export const FILE_REVIEW_ARTIFACT_CUSTOM_TYPE = 'scout.file_review_artifact';
export const MAX_REVIEW_ARTIFACT_FILES = 100;
export const MAX_REVIEW_ARTIFACT_BYTES = 2 * 1024 * 1024;
export const MAX_REVIEW_ARTIFACT_ROWS = 20_000;

// ---------- 类型 ----------

export interface FileReviewArtifactRecord {
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

export interface FileReviewArtifactFile {
  absolutePath: string;
  path: string;
  displayPath?: string;
  recordIds: string[];
  latestRecordId: string;
  latestSequence: number;
  additions: number;
  deletions: number;
  firstChangedLine?: number;
  unavailableReason?: Exclude<FileReviewUnavailableReason, 'Changes are no longer available'>;
  modifiedFingerprint?: FileReviewContentFingerprint;
  rows: ReviewDisplayRow[];
}

export interface FileReviewArtifact {
  version: typeof FILE_REVIEW_ARTIFACT_VERSION;
  sessionId: string;
  turnId: string;
  createdAt: string;
  files: FileReviewArtifactFile[];
  records: FileReviewArtifactRecord[];
}

export interface FileReviewArtifactIndex {
  artifactsByTurnId: Map<string, FileReviewArtifact>;
  latestArtifact?: FileReviewArtifact;
  latestTurnId?: string;
}

export interface BoundedFileReviewArtifactResult {
  artifact: FileReviewArtifact;
  warnings: string[];
}

export interface FileReviewArtifactLimitOptions {
  maxBytes?: number;
  maxFiles?: number;
  maxRows?: number;
}

// ---------- Artifact ----------

export function createFileReviewArtifact(
  sessionId: string,
  review: FileReviewTurnSnapshot,
  options: { createdAt?: string } = {},
): FileReviewArtifact {
  return {
    version: FILE_REVIEW_ARTIFACT_VERSION,
    sessionId,
    turnId: review.turnId,
    createdAt: options.createdAt ?? new Date().toISOString(),
    records: review.records.map((record) => ({
      recordId: record.recordId,
      turnId: record.turnId,
      toolCallId: record.toolCallId,
      operation: record.operation,
      path: record.path,
      absolutePath: record.absolutePath,
      displayPath: record.displayPath,
      sequence: record.sequence,
      unavailableReason: record.unavailableReason,
    })),
    files: review.files.map((file) => {
      const diff = computeReviewDiff(file.originalContent, file.modifiedContent, {
        collapseContext: true,
        contextLines: REVIEW_CONTEXT_LINES,
        filePath: file.absolutePath,
        includeTokens: true,
        unavailableReason: file.unavailableReason,
      });
      return {
        absolutePath: file.absolutePath,
        path: file.path,
        displayPath: file.displayPath,
        recordIds: [...file.recordIds],
        latestRecordId: file.latestRecordId,
        latestSequence: file.latestSequence,
        additions: diff.unavailableReason ? file.additions : diff.additions,
        deletions: diff.unavailableReason ? file.deletions : diff.deletions,
        firstChangedLine: diff.firstChangedLine ?? file.firstChangedLine,
        unavailableReason: diff.unavailableReason,
        modifiedFingerprint: createReviewContentFingerprint(file.modifiedContent),
        rows: diff.rows,
      };
    }),
  };
}

export function isFileReviewArtifact(value: unknown): value is FileReviewArtifact {
  if (!isRecord(value)) return false;
  return (
    value.version === FILE_REVIEW_ARTIFACT_VERSION &&
    typeof value.sessionId === 'string' &&
    typeof value.turnId === 'string' &&
    typeof value.createdAt === 'string' &&
    Array.isArray(value.files) &&
    value.files.every(isFileReviewArtifactFile) &&
    Array.isArray(value.records) &&
    value.records.every(isFileReviewArtifactRecord)
  );
}

function isFileReviewArtifactRecord(value: unknown): value is FileReviewArtifactRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.recordId === 'string' &&
    typeof value.turnId === 'string' &&
    typeof value.toolCallId === 'string' &&
    isFileReviewOperation(value.operation) &&
    typeof value.path === 'string' &&
    typeof value.absolutePath === 'string' &&
    isOptionalString(value.displayPath) &&
    isFiniteNumber(value.sequence) &&
    isOptionalUnavailableReason(value.unavailableReason)
  );
}

function isFileReviewArtifactFile(value: unknown): value is FileReviewArtifactFile {
  if (!isRecord(value)) return false;
  return (
    typeof value.absolutePath === 'string' &&
    typeof value.path === 'string' &&
    isOptionalString(value.displayPath) &&
    Array.isArray(value.recordIds) &&
    value.recordIds.every((recordId) => typeof recordId === 'string') &&
    typeof value.latestRecordId === 'string' &&
    isFiniteNumber(value.latestSequence) &&
    isFiniteNumber(value.additions) &&
    isFiniteNumber(value.deletions) &&
    (value.firstChangedLine === undefined || isFiniteNumber(value.firstChangedLine)) &&
    isOptionalUnavailableReason(value.unavailableReason) &&
    (value.modifiedFingerprint === undefined ||
      isReviewContentFingerprint(value.modifiedFingerprint)) &&
    Array.isArray(value.rows) &&
    value.rows.every(isReviewDisplayRow)
  );
}

function isReviewDisplayRow(value: unknown): value is ReviewDisplayRow {
  if (!isRecord(value)) return false;
  if (!isReviewRowType(value.type)) return false;
  if (
    !(
      (value.oldLineNumber === undefined || isFiniteNumber(value.oldLineNumber)) &&
      (value.newLineNumber === undefined || isFiniteNumber(value.newLineNumber)) &&
      (value.oldStartLine === undefined || isFiniteNumber(value.oldStartLine)) &&
      (value.newStartLine === undefined || isFiniteNumber(value.newStartLine)) &&
      (value.text === undefined || typeof value.text === 'string') &&
      (value.tokens === undefined || isReviewDisplayTokens(value.tokens)) &&
      (value.count === undefined || isFiniteNumber(value.count))
    )
  ) {
    return false;
  }

  if (value.type === 'context') {
    return (
      isFiniteNumber(value.oldLineNumber) &&
      isFiniteNumber(value.newLineNumber) &&
      typeof value.text === 'string'
    );
  }
  if (value.type === 'added') {
    return isFiniteNumber(value.newLineNumber) && typeof value.text === 'string';
  }
  if (value.type === 'removed') {
    return isFiniteNumber(value.oldLineNumber) && typeof value.text === 'string';
  }
  return isFiniteNumber(value.count);
}

function isReviewDisplayTokens(value: unknown): value is ReviewDisplayRow['tokens'] {
  return Array.isArray(value) && value.every(isReviewDisplayToken);
}

function isReviewDisplayToken(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.text === 'string' &&
    (value.syntaxScopes === undefined ||
      (Array.isArray(value.syntaxScopes) &&
        value.syntaxScopes.every((scope) => typeof scope === 'string'))) &&
    (value.diff === undefined || value.diff === 'added' || value.diff === 'removed')
  );
}

function isReviewContentFingerprint(value: unknown): value is FileReviewContentFingerprint {
  return (
    isRecord(value) &&
    isFiniteNumber(value.size) &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/i.test(value.sha256)
  );
}

function isFileReviewOperation(value: unknown): value is FileReviewOperation {
  return value === 'edit' || value === 'write';
}

function isReviewRowType(value: unknown): value is ReviewDisplayRow['type'] {
  return value === 'context' || value === 'added' || value === 'removed' || value === 'fold';
}

function isOptionalUnavailableReason(
  value: unknown,
): value is Exclude<FileReviewUnavailableReason, 'Changes are no longer available'> | undefined {
  return (
    value === undefined ||
    value === 'Diff too large to review' ||
    value === 'Original content unavailable' ||
    value === 'Binary or unsupported encoding'
  );
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

export function collectFileReviewArtifacts(
  entries: readonly SessionTreeEntry[] | undefined,
): FileReviewArtifactIndex {
  const artifactsByTurnId = new Map<string, FileReviewArtifact>();
  let latestArtifact: FileReviewArtifact | undefined;
  let latestTurnId: string | undefined;
  for (const entry of entries ?? []) {
    if (
      entry.type !== 'custom' ||
      entry.customType !== FILE_REVIEW_ARTIFACT_CUSTOM_TYPE ||
      !isFileReviewArtifact(entry.data)
    ) {
      continue;
    }
    artifactsByTurnId.set(entry.data.turnId, entry.data);
    latestArtifact = entry.data;
    latestTurnId = entry.data.turnId;
  }
  const index: FileReviewArtifactIndex = { artifactsByTurnId };
  if (latestArtifact) index.latestArtifact = latestArtifact;
  if (latestTurnId) index.latestTurnId = latestTurnId;
  return index;
}

export function collectCurrentBranchFileReviewArtifacts(
  entries: readonly SessionTreeEntry[] | undefined,
  branchEntries: readonly SessionTreeEntry[] | undefined,
): FileReviewArtifactIndex {
  if (!entries || !branchEntries) return collectFileReviewArtifacts(undefined);

  const includedEntryIds = collectBranchAndMetadataDescendantIds(entries, branchEntries);
  return collectFileReviewArtifacts(entries.filter((entry) => includedEntryIds.has(entry.id)));
}

function collectBranchAndMetadataDescendantIds(
  entries: readonly SessionTreeEntry[],
  branchEntries: readonly SessionTreeEntry[],
): Set<string> {
  const includedEntryIds = new Set(branchEntries.map((entry) => entry.id));
  const childrenByParentId = new Map<string | null, SessionTreeEntry[]>();
  for (const entry of entries) {
    const children = childrenByParentId.get(entry.parentId) ?? [];
    children.push(entry);
    childrenByParentId.set(entry.parentId, children);
  }

  const queue = [...includedEntryIds];
  const visitedParentIds = new Set<string>();
  while (queue.length > 0) {
    const parentId = queue.shift();
    if (!parentId || visitedParentIds.has(parentId)) continue;
    visitedParentIds.add(parentId);

    for (const child of childrenByParentId.get(parentId) ?? []) {
      if (includedEntryIds.has(child.id) || !isSessionMetadataEntry(child)) continue;
      includedEntryIds.add(child.id);
      queue.push(child.id);
    }
  }

  return includedEntryIds;
}

function isSessionMetadataEntry(entry: SessionTreeEntry): boolean {
  return (
    entry.type === 'custom' ||
    entry.type === 'label' ||
    entry.type === 'session_info' ||
    entry.type === 'model_change' ||
    entry.type === 'thinking_level_change'
  );
}

export function prepareFileReviewArtifactForSession(
  artifact: FileReviewArtifact,
  options: FileReviewArtifactLimitOptions = {},
): BoundedFileReviewArtifactResult {
  const maxBytes = options.maxBytes ?? MAX_REVIEW_ARTIFACT_BYTES;
  const maxFiles = options.maxFiles ?? MAX_REVIEW_ARTIFACT_FILES;
  const maxRows = options.maxRows ?? MAX_REVIEW_ARTIFACT_ROWS;
  const warnings: string[] = [];
  let bounded = cloneFileReviewArtifact(artifact);

  if (bounded.files.length > maxFiles) {
    warnings.push(
      `Changes review artifact has ${bounded.files.length} files; only ${maxFiles} were persisted.`,
    );
    bounded.files = bounded.files.slice(0, Math.max(0, maxFiles));
    bounded = filterArtifactRecordsToFiles(bounded);
  }

  if (countArtifactRows(bounded) > maxRows) {
    warnings.push(
      `Changes review artifact has ${countArtifactRows(bounded)} rows; large file rows were collapsed.`,
    );
    bounded = collapseLargestFilesUntilRowLimit(bounded, maxRows);
  }

  if (getArtifactByteLength(bounded) > maxBytes) {
    warnings.push('Changes review artifact row tokens were removed to fit the session limit.');
    bounded = stripArtifactRowTokens(bounded);
  }

  if (getArtifactByteLength(bounded) > maxBytes) {
    warnings.push('Changes review artifact rows were collapsed to fit the session limit.');
    bounded = collapseAllFileRows(bounded);
  }

  while (getArtifactByteLength(bounded) > maxBytes && bounded.files.length > 0) {
    warnings.push('Changes review artifact dropped an overflow file to fit the session limit.');
    bounded.files = bounded.files.slice(0, -1);
    bounded = filterArtifactRecordsToFiles(bounded);
  }

  return { artifact: bounded, warnings };
}

function cloneFileReviewArtifact(artifact: FileReviewArtifact): FileReviewArtifact {
  return {
    ...artifact,
    records: artifact.records.map((record) => ({ ...record })),
    files: artifact.files.map((file) => ({
      ...file,
      recordIds: [...file.recordIds],
      rows: file.rows.map((row) => ({
        ...row,
        tokens: row.tokens?.map((token) => ({ ...token })),
      })),
    })),
  };
}

function getArtifactByteLength(artifact: FileReviewArtifact): number {
  return Buffer.byteLength(JSON.stringify(artifact), 'utf-8');
}

function countArtifactRows(artifact: FileReviewArtifact): number {
  return artifact.files.reduce((sum, file) => sum + file.rows.length, 0);
}

function collapseLargestFilesUntilRowLimit(
  artifact: FileReviewArtifact,
  maxRows: number,
): FileReviewArtifact {
  if (maxRows <= 0) return collapseAllFileRows(artifact);
  let totalRows = countArtifactRows(artifact);
  if (totalRows <= maxRows) return artifact;

  const next = cloneFileReviewArtifact(artifact);
  const indexesByRowCount = next.files
    .map((file, index) => ({ index, rowCount: file.rows.length }))
    .sort((left, right) => right.rowCount - left.rowCount);

  for (const { index, rowCount } of indexesByRowCount) {
    if (totalRows <= maxRows) break;
    if (rowCount === 0) continue;
    next.files[index] = collapseFileRows(next.files[index]!);
    totalRows -= rowCount;
  }

  return next;
}

function collapseAllFileRows(artifact: FileReviewArtifact): FileReviewArtifact {
  return {
    ...artifact,
    files: artifact.files.map((file) => collapseFileRows(file)),
  };
}

function collapseFileRows(file: FileReviewArtifactFile): FileReviewArtifactFile {
  return {
    ...file,
    unavailableReason: file.unavailableReason ?? 'Diff too large to review',
    modifiedFingerprint: undefined,
    rows: [],
  };
}

function stripArtifactRowTokens(artifact: FileReviewArtifact): FileReviewArtifact {
  return {
    ...artifact,
    files: artifact.files.map((file) => ({
      ...file,
      rows: file.rows.map((row) => {
        const rest = { ...row };
        delete rest.tokens;
        return rest;
      }),
    })),
  };
}

function filterArtifactRecordsToFiles(artifact: FileReviewArtifact): FileReviewArtifact {
  const keptRecordIds = new Set(artifact.files.flatMap((file) => file.recordIds));
  return {
    ...artifact,
    records: artifact.records.filter((record) => keptRecordIds.has(record.recordId)),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}
