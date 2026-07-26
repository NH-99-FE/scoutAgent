// ============================================================
// File review artifact — 宿主持久化 canonical DiffDocument
// 负责：只写 v2、集中解码 v1，并对 session artifact 做边界校验与限流。
// ============================================================

import {
  DIFF_DOCUMENT_VERSION,
  type DiffContentFingerprint,
  type DiffDisplayRow,
  type DiffDocument,
  type DiffUnavailableReason,
  type DiffHunk,
  type DiffLine,
  type FileReviewOperation,
  type FileReviewTurnSnapshot,
} from '../../core/review/index.ts';
import type { SessionTreeEntry } from '../../core/session/index.ts';

// ---------- 常量 ----------

export const FILE_REVIEW_ARTIFACT_VERSION = 2;
export const FILE_REVIEW_ARTIFACT_V1_VERSION = 1;
export const FILE_REVIEW_ARTIFACT_CUSTOM_TYPE = 'scout.file_review_artifact';
export const MAX_REVIEW_ARTIFACT_FILES = 100;
export const MAX_REVIEW_ARTIFACT_BYTES = 2 * 1024 * 1024;
/** v2 中对应持久化 hunk line 数；保留旧常量名避免迁移期调用方分叉。 */
export const MAX_REVIEW_ARTIFACT_ROWS = 20_000;

// ---------- v2 类型 ----------

export interface FileReviewArtifactRecord {
  recordId: string;
  toolCallId: string;
  operation: FileReviewOperation;
  fileId: string;
  sequence: number;
  toolOutcome: 'success' | 'error_after_write';
}

export interface FileReviewArtifactFile {
  fileId: string;
  path: string;
  absolutePath: string;
  displayPath?: string;
  recordIds: string[];
  latestRevision: number;
  document: DiffDocument;
}

export interface FileReviewArtifact {
  version: typeof FILE_REVIEW_ARTIFACT_VERSION;
  sessionId: string;
  turnId: string;
  createdAt: string;
  records: FileReviewArtifactRecord[];
  files: FileReviewArtifactFile[];
}

// ---------- v1 只读类型 ----------

export interface FileReviewArtifactV1Record {
  recordId: string;
  turnId: string;
  toolCallId: string;
  operation: FileReviewOperation;
  path: string;
  absolutePath: string;
  displayPath?: string;
  sequence: number;
  unavailableReason?: StoredUnavailableReason;
}

export interface FileReviewArtifactV1File {
  absolutePath: string;
  path: string;
  displayPath?: string;
  recordIds: string[];
  latestRecordId: string;
  latestSequence: number;
  additions: number;
  deletions: number;
  firstChangedLine?: number;
  unavailableReason?: StoredUnavailableReason;
  modifiedFingerprint?: DiffContentFingerprint;
  rows: DiffDisplayRow[];
}

export interface FileReviewArtifactV1 {
  version: typeof FILE_REVIEW_ARTIFACT_V1_VERSION;
  sessionId: string;
  turnId: string;
  createdAt: string;
  files: FileReviewArtifactV1File[];
  records: FileReviewArtifactV1Record[];
}

type StoredUnavailableReason =
  | 'Diff too large to review'
  | 'Original content unavailable'
  | 'Binary or unsupported encoding';

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
  /** v2 中限制 canonical hunk line 总数。 */
  maxRows?: number;
}

// ---------- v2 encoder ----------

export function createFileReviewArtifact(
  sessionId: string,
  review: FileReviewTurnSnapshot,
  options: { createdAt?: string } = {},
): FileReviewArtifact {
  const settledFiles = review.files.filter(
    (file) =>
      file.document !== undefined &&
      (file.projectionStatus === undefined || file.projectionStatus !== 'pending'),
  );
  const fileByRecordId = new Map<string, FileReviewArtifactFile>();
  const files = settledFiles.map((file, index): FileReviewArtifactFile => {
    const persisted: FileReviewArtifactFile = {
      fileId: file.fileId ?? createLegacyRuntimeFileId(file.absolutePath, index),
      path: file.path,
      absolutePath: file.absolutePath,
      displayPath: file.displayPath,
      recordIds: [...file.recordIds],
      latestRevision: file.revision ?? 1,
      document: cloneDiffDocument(file.document!),
    };
    for (const recordId of persisted.recordIds) {
      fileByRecordId.set(recordId, persisted);
    }
    return persisted;
  });

  return {
    version: FILE_REVIEW_ARTIFACT_VERSION,
    sessionId,
    turnId: review.turnId,
    createdAt: options.createdAt ?? new Date().toISOString(),
    records: review.records.flatMap((record) => {
      const file = fileByRecordId.get(record.recordId);
      if (!file) return [];
      return [
        {
          recordId: record.recordId,
          toolCallId: record.toolCallId,
          operation: record.operation,
          fileId: file.fileId,
          sequence: record.sequence,
          toolOutcome: record.toolOutcome ?? 'success',
        },
      ];
    }),
    files,
  };
}

// ---------- Decoder / guards ----------

export function isFileReviewArtifact(value: unknown): value is FileReviewArtifact {
  if (!isRecord(value)) return false;
  if (
    value.version !== FILE_REVIEW_ARTIFACT_VERSION ||
    typeof value.sessionId !== 'string' ||
    typeof value.turnId !== 'string' ||
    typeof value.createdAt !== 'string' ||
    !Array.isArray(value.files) ||
    !value.files.every(isFileReviewArtifactFile) ||
    !Array.isArray(value.records) ||
    !value.records.every(isFileReviewArtifactRecord)
  ) {
    return false;
  }
  return hasConsistentArtifactReferences(value as unknown as FileReviewArtifact);
}

export function isFileReviewArtifactV1(value: unknown): value is FileReviewArtifactV1 {
  if (!isRecord(value)) return false;
  return (
    value.version === FILE_REVIEW_ARTIFACT_V1_VERSION &&
    typeof value.sessionId === 'string' &&
    typeof value.turnId === 'string' &&
    typeof value.createdAt === 'string' &&
    Array.isArray(value.files) &&
    value.files.every(isFileReviewArtifactV1File) &&
    Array.isArray(value.records) &&
    value.records.every(isFileReviewArtifactV1Record)
  );
}

/** 任何 artifact 版本都在此处收敛为内存 v2，v1 语义不泄漏到调用方。 */
export function decodeFileReviewArtifact(value: unknown): FileReviewArtifact | undefined {
  if (isFileReviewArtifact(value)) return value;
  if (isFileReviewArtifactV1(value)) return convertFileReviewArtifactV1(value);
  return undefined;
}

function isFileReviewArtifactRecord(value: unknown): value is FileReviewArtifactRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.recordId === 'string' &&
    typeof value.toolCallId === 'string' &&
    isFileReviewOperation(value.operation) &&
    typeof value.fileId === 'string' &&
    isNonNegativeInteger(value.sequence) &&
    (value.toolOutcome === 'success' || value.toolOutcome === 'error_after_write')
  );
}

function isFileReviewArtifactFile(value: unknown): value is FileReviewArtifactFile {
  if (!isRecord(value)) return false;
  return (
    typeof value.fileId === 'string' &&
    typeof value.path === 'string' &&
    typeof value.absolutePath === 'string' &&
    isOptionalString(value.displayPath) &&
    Array.isArray(value.recordIds) &&
    value.recordIds.every((recordId) => typeof recordId === 'string') &&
    isPositiveInteger(value.latestRevision) &&
    isDiffDocument(value.document)
  );
}

function hasConsistentArtifactReferences(artifact: FileReviewArtifact): boolean {
  const recordsById = new Map(artifact.records.map((record) => [record.recordId, record]));
  if (recordsById.size !== artifact.records.length) return false;
  const fileIds = new Set<string>();
  const referencedRecordIds = new Set<string>();
  for (const file of artifact.files) {
    if (fileIds.has(file.fileId)) return false;
    fileIds.add(file.fileId);
    for (const recordId of file.recordIds) {
      const record = recordsById.get(recordId);
      if (!record || record.fileId !== file.fileId || referencedRecordIds.has(recordId))
        return false;
      referencedRecordIds.add(recordId);
    }
  }
  return referencedRecordIds.size === artifact.records.length;
}

function isDiffDocument(value: unknown): value is DiffDocument {
  if (!isRecord(value)) return false;
  return (
    value.version === DIFF_DOCUMENT_VERSION &&
    isOptionalFingerprint(value.beforeFingerprint) &&
    isOptionalFingerprint(value.afterFingerprint) &&
    isNonNegativeInteger(value.beforeLineCount) &&
    isNonNegativeInteger(value.afterLineCount) &&
    isNonNegativeInteger(value.additions) &&
    isNonNegativeInteger(value.deletions) &&
    (value.firstChangedLine === undefined || isPositiveInteger(value.firstChangedLine)) &&
    Array.isArray(value.hunks) &&
    value.hunks.every(isDiffHunk) &&
    isOptionalUnavailableReason(value.unavailableReason) &&
    !(value.unavailableReason && value.hunks.length > 0)
  );
}

function isDiffHunk(value: unknown): value is DiffHunk {
  if (!isRecord(value)) return false;
  return (
    isPositiveInteger(value.oldStart) &&
    isNonNegativeInteger(value.oldLines) &&
    isPositiveInteger(value.newStart) &&
    isNonNegativeInteger(value.newLines) &&
    Array.isArray(value.lines) &&
    value.lines.every(isDiffLine) &&
    value.oldLines === value.lines.filter((line) => line.type !== 'added').length &&
    value.newLines === value.lines.filter((line) => line.type !== 'removed').length
  );
}

function isDiffLine(value: unknown): value is DiffLine {
  return (
    isRecord(value) &&
    (value.type === 'context' || value.type === 'removed' || value.type === 'added') &&
    typeof value.text === 'string'
  );
}

// ---------- v1 adapter ----------

function convertFileReviewArtifactV1(artifact: FileReviewArtifactV1): FileReviewArtifact {
  const fileByRecordId = new Map<string, FileReviewArtifactFile>();
  const files = artifact.files.map((file, index): FileReviewArtifactFile => {
    const converted: FileReviewArtifactFile = {
      fileId: createLegacyArtifactFileId(file, index),
      path: file.path,
      absolutePath: file.absolutePath,
      displayPath: file.displayPath,
      recordIds: [...file.recordIds],
      latestRevision: 1,
      document: convertV1RowsToDiffDocument(file),
    };
    for (const recordId of converted.recordIds) fileByRecordId.set(recordId, converted);
    return converted;
  });

  return {
    version: FILE_REVIEW_ARTIFACT_VERSION,
    sessionId: artifact.sessionId,
    turnId: artifact.turnId,
    createdAt: artifact.createdAt,
    files,
    records: artifact.records.flatMap((record) => {
      const file = fileByRecordId.get(record.recordId);
      if (!file) return [];
      return [
        {
          recordId: record.recordId,
          toolCallId: record.toolCallId,
          operation: record.operation,
          fileId: file.fileId,
          sequence: record.sequence,
          toolOutcome: 'success' as const,
        },
      ];
    }),
  };
}

function convertV1RowsToDiffDocument(file: FileReviewArtifactV1File): DiffDocument {
  const hunks: DiffHunk[] = [];
  let currentLines: DiffLine[] = [];
  let currentOldStart = 1;
  let currentNewStart = 1;
  let oldPosition = 1;
  let newPosition = 1;

  const flush = (): void => {
    if (currentLines.length === 0) return;
    hunks.push({
      oldStart: currentOldStart,
      oldLines: currentLines.filter((line) => line.type !== 'added').length,
      newStart: currentNewStart,
      newLines: currentLines.filter((line) => line.type !== 'removed').length,
      lines: currentLines,
    });
    currentLines = [];
  };

  for (const row of file.rows) {
    if (row.type === 'fold') {
      flush();
      oldPosition = (row.oldStartLine ?? oldPosition) + (row.count ?? 0);
      newPosition = (row.newStartLine ?? newPosition) + (row.count ?? 0);
      continue;
    }

    if (row.type === 'context') {
      oldPosition = row.oldLineNumber ?? oldPosition;
      newPosition = row.newLineNumber ?? newPosition;
    } else if (row.type === 'removed') {
      oldPosition = row.oldLineNumber ?? oldPosition;
    } else {
      newPosition = row.newLineNumber ?? newPosition;
    }

    if (currentLines.length === 0) {
      currentOldStart = oldPosition;
      currentNewStart = newPosition;
    }
    currentLines.push({ type: row.type, text: row.text ?? '' });
    if (row.type !== 'added') oldPosition += 1;
    if (row.type !== 'removed') newPosition += 1;
  }
  flush();

  return {
    version: DIFF_DOCUMENT_VERSION,
    afterFingerprint: file.modifiedFingerprint,
    beforeLineCount: Math.max(0, oldPosition - 1),
    afterLineCount: Math.max(0, newPosition - 1),
    additions: file.additions,
    deletions: file.deletions,
    firstChangedLine: file.firstChangedLine,
    hunks: file.unavailableReason ? [] : hunks,
    unavailableReason: toCanonicalUnavailableReason(file.unavailableReason),
  };
}

function isFileReviewArtifactV1Record(value: unknown): value is FileReviewArtifactV1Record {
  if (!isRecord(value)) return false;
  return (
    typeof value.recordId === 'string' &&
    typeof value.turnId === 'string' &&
    typeof value.toolCallId === 'string' &&
    isFileReviewOperation(value.operation) &&
    typeof value.path === 'string' &&
    typeof value.absolutePath === 'string' &&
    isOptionalString(value.displayPath) &&
    isNonNegativeInteger(value.sequence) &&
    isOptionalStoredUnavailableReason(value.unavailableReason)
  );
}

function isFileReviewArtifactV1File(value: unknown): value is FileReviewArtifactV1File {
  if (!isRecord(value)) return false;
  return (
    typeof value.absolutePath === 'string' &&
    typeof value.path === 'string' &&
    isOptionalString(value.displayPath) &&
    Array.isArray(value.recordIds) &&
    value.recordIds.every((recordId) => typeof recordId === 'string') &&
    typeof value.latestRecordId === 'string' &&
    isNonNegativeInteger(value.latestSequence) &&
    isNonNegativeInteger(value.additions) &&
    isNonNegativeInteger(value.deletions) &&
    (value.firstChangedLine === undefined || isPositiveInteger(value.firstChangedLine)) &&
    isOptionalStoredUnavailableReason(value.unavailableReason) &&
    isOptionalFingerprint(value.modifiedFingerprint) &&
    Array.isArray(value.rows) &&
    value.rows.every(isReviewDisplayRow)
  );
}

function isReviewDisplayRow(value: unknown): value is DiffDisplayRow {
  if (!isRecord(value)) return false;
  if (value.type === 'fold') {
    return (
      isPositiveInteger(value.oldStartLine) &&
      isPositiveInteger(value.newStartLine) &&
      isPositiveInteger(value.count)
    );
  }
  if (value.type === 'context') {
    return (
      isPositiveInteger(value.oldLineNumber) &&
      isPositiveInteger(value.newLineNumber) &&
      typeof value.text === 'string' &&
      isOptionalTokens(value.tokens)
    );
  }
  if (value.type === 'added') {
    return (
      isPositiveInteger(value.newLineNumber) &&
      typeof value.text === 'string' &&
      isOptionalTokens(value.tokens)
    );
  }
  if (value.type === 'removed') {
    return (
      isPositiveInteger(value.oldLineNumber) &&
      typeof value.text === 'string' &&
      isOptionalTokens(value.tokens)
    );
  }
  return false;
}

function isOptionalTokens(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (token) =>
          isRecord(token) &&
          typeof token.text === 'string' &&
          (token.syntaxScopes === undefined ||
            (Array.isArray(token.syntaxScopes) &&
              token.syntaxScopes.every((scope) => typeof scope === 'string'))) &&
          (token.diff === undefined || token.diff === 'added' || token.diff === 'removed'),
      ))
  );
}

// ---------- Branch collection ----------

export function collectFileReviewArtifacts(
  entries: readonly SessionTreeEntry[] | undefined,
): FileReviewArtifactIndex {
  const artifactsByTurnId = new Map<string, FileReviewArtifact>();
  let latestArtifact: FileReviewArtifact | undefined;
  let latestTurnId: string | undefined;
  for (const entry of entries ?? []) {
    if (entry.type !== 'custom' || entry.customType !== FILE_REVIEW_ARTIFACT_CUSTOM_TYPE) continue;
    const artifact = decodeFileReviewArtifact(entry.data);
    if (!artifact) continue;
    artifactsByTurnId.set(artifact.turnId, artifact);
    latestArtifact = artifact;
    latestTurnId = artifact.turnId;
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

// ---------- Limits ----------

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

  if (countArtifactLines(bounded) > maxRows) {
    warnings.push(
      `Changes review artifact has ${countArtifactLines(bounded)} hunk lines; large file diffs were marked unavailable.`,
    );
    bounded = collapseLargestFilesUntilLineLimit(bounded, maxRows);
  }

  if (getArtifactByteLength(bounded) > maxBytes) {
    warnings.push('Changes review artifact diffs were collapsed to fit the session limit.');
    bounded = collapseLargestFilesUntilByteLimit(bounded, maxBytes);
  }

  while (getArtifactByteLength(bounded) > maxBytes && bounded.files.length > 0) {
    warnings.push('Changes review artifact dropped an overflow file to fit the session limit.');
    bounded.files = bounded.files.slice(0, -1);
    bounded = filterArtifactRecordsToFiles(bounded);
  }

  return { artifact: bounded, warnings };
}

function collapseLargestFilesUntilLineLimit(
  artifact: FileReviewArtifact,
  maxLines: number,
): FileReviewArtifact {
  let totalLines = countArtifactLines(artifact);
  if (totalLines <= maxLines) return artifact;
  const next = cloneFileReviewArtifact(artifact);
  const filesBySize = next.files
    .map((file, index) => ({ index, lines: countDocumentLines(file.document) }))
    .sort((left, right) => right.lines - left.lines);
  for (const { index, lines } of filesBySize) {
    if (totalLines <= maxLines) break;
    if (lines === 0) continue;
    next.files[index] = collapseArtifactFile(next.files[index]!);
    totalLines -= lines;
  }
  return next;
}

function collapseLargestFilesUntilByteLimit(
  artifact: FileReviewArtifact,
  maxBytes: number,
): FileReviewArtifact {
  const next = cloneFileReviewArtifact(artifact);
  const indexes = next.files
    .map((file, index) => ({ index, lines: countDocumentLines(file.document) }))
    .sort((left, right) => right.lines - left.lines);
  for (const { index } of indexes) {
    if (getArtifactByteLength(next) <= maxBytes) break;
    if (next.files[index]?.document.hunks.length === 0) continue;
    next.files[index] = collapseArtifactFile(next.files[index]!);
  }
  return next;
}

function collapseArtifactFile(file: FileReviewArtifactFile): FileReviewArtifactFile {
  return {
    ...file,
    document: {
      ...file.document,
      hunks: [],
      unavailableReason: file.document.unavailableReason ?? 'diff_too_large',
    },
  };
}

function cloneFileReviewArtifact(artifact: FileReviewArtifact): FileReviewArtifact {
  return {
    ...artifact,
    records: artifact.records.map((record) => ({ ...record })),
    files: artifact.files.map((file) => ({
      ...file,
      recordIds: [...file.recordIds],
      document: cloneDiffDocument(file.document),
    })),
  };
}

function cloneDiffDocument(document: DiffDocument): DiffDocument {
  return {
    ...document,
    beforeFingerprint: document.beforeFingerprint && { ...document.beforeFingerprint },
    afterFingerprint: document.afterFingerprint && { ...document.afterFingerprint },
    hunks: document.hunks.map((hunk) => ({
      ...hunk,
      lines: hunk.lines.map((line) => ({ ...line })),
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

function countArtifactLines(artifact: FileReviewArtifact): number {
  return artifact.files.reduce((sum, file) => sum + countDocumentLines(file.document), 0);
}

function countDocumentLines(document: DiffDocument): number {
  return document.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
}

function getArtifactByteLength(artifact: FileReviewArtifact): number {
  return Buffer.byteLength(JSON.stringify(artifact), 'utf-8');
}

// ---------- Helpers ----------

function createLegacyRuntimeFileId(absolutePath: string, index: number): string {
  return `runtime-file-${index + 1}-${encodeURIComponent(absolutePath)}`;
}

function createLegacyArtifactFileId(file: FileReviewArtifactV1File, index: number): string {
  return `legacy-file-${index + 1}-${encodeURIComponent(file.absolutePath)}`;
}

function isFileReviewOperation(value: unknown): value is FileReviewOperation {
  return value === 'edit' || value === 'write';
}

function isOptionalFingerprint(value: unknown): value is DiffContentFingerprint | undefined {
  return value === undefined || isFingerprint(value);
}

function isFingerprint(value: unknown): value is DiffContentFingerprint {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.size) &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/i.test(value.sha256)
  );
}

function isOptionalUnavailableReason(value: unknown): value is DiffUnavailableReason | undefined {
  return (
    value === undefined ||
    value === 'original_unavailable' ||
    value === 'modified_unavailable' ||
    value === 'binary_or_unsupported' ||
    value === 'content_too_large' ||
    value === 'diff_too_large' ||
    value === 'generation_failed' ||
    value === 'content_released'
  );
}

function isOptionalStoredUnavailableReason(
  value: unknown,
): value is StoredUnavailableReason | undefined {
  return value === undefined || isStoredUnavailableReason(value);
}

function isStoredUnavailableReason(value: unknown): value is StoredUnavailableReason {
  return (
    value === 'Diff too large to review' ||
    value === 'Original content unavailable' ||
    value === 'Binary or unsupported encoding'
  );
}

function toCanonicalUnavailableReason(
  reason: StoredUnavailableReason | undefined,
): DiffUnavailableReason | undefined {
  if (reason === 'Diff too large to review') return 'diff_too_large';
  if (reason === 'Original content unavailable') return 'original_unavailable';
  if (reason === 'Binary or unsupported encoding') return 'binary_or_unsupported';
  return undefined;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}
