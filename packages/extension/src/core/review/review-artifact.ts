// ============================================================
// Review Artifact — session 轻量引用与外部完整快照 manifest
// ============================================================

import type { ScoutChangesReviewSummary } from '@scout-agent/shared';
import { mkdir, open, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isSessionMetadataEntry, type SessionTreeEntry } from '../session/index.ts';
import type { DiffUnavailableReason } from './diff-document.ts';
import type { CapturedTextSnapshot } from './mutation-capture-context.ts';
import type { FileReviewTurnSnapshot } from './file-review.ts';
import { ReviewArtifactStore } from './review-artifact-store.ts';
import {
  REVIEW_ARTIFACT_GC_GRACE_MS,
  REVIEW_ARTIFACT_SOFT_LIMIT_BYTES,
  type ReviewArtifactGarbageCollectionResult,
} from './review-artifact-store.ts';

export const REVIEW_ARTIFACT_REF_VERSION = 1;
export const REVIEW_ARTIFACT_MANIFEST_VERSION = 1;
export const REVIEW_ARTIFACT_CUSTOM_TYPE = 'scout.file_review_artifact_ref';

export type StoredSnapshotRef =
  | { kind: 'blob'; hash: string; byteLength: number }
  | { kind: 'absent' }
  | { kind: 'unavailable'; reason: DiffUnavailableReason; byteLength: number };

export interface ReviewArtifactRecord {
  recordId: string;
  toolCallId: string;
  fileId: string;
  revision: number;
  operation: 'edit' | 'write';
  sequence: number;
  toolOutcome: 'success' | 'error_after_write';
  before: StoredSnapshotRef;
  after: StoredSnapshotRef;
}

export interface ReviewArtifactFile {
  fileId: string;
  path: string;
  absolutePath: string;
  displayPath?: string;
  recordIds: string[];
  latestRevision: number;
  additions: number;
  deletions: number;
  unavailableReason?: DiffUnavailableReason;
  baseline: StoredSnapshotRef;
  final: StoredSnapshotRef;
}

export interface ReviewArtifactManifest {
  version: typeof REVIEW_ARTIFACT_MANIFEST_VERSION;
  sessionId: string;
  turnId: string;
  createdAt: string;
  records: ReviewArtifactRecord[];
  files: ReviewArtifactFile[];
}

export interface ReviewArtifactRef {
  version: typeof REVIEW_ARTIFACT_REF_VERSION;
  sessionId: string;
  turnId: string;
  createdAt: string;
  complete: true;
  manifestHash: string;
  summary: ScoutChangesReviewSummary;
}

export interface ReviewArtifactRefIndex {
  refsByTurnId: Map<string, ReviewArtifactRef>;
  latestRef?: ReviewArtifactRef;
  latestTurnId?: string;
}

export interface ReviewArtifactGarbageCollectionReport extends ReviewArtifactGarbageCollectionResult {
  skipped: boolean;
  overSoftLimit: boolean;
}

export function createReviewArtifactSummary(
  review: FileReviewTurnSnapshot,
): ScoutChangesReviewSummary {
  const files = [...review.files]
    .sort((left, right) => right.latestSequence - left.latestSequence)
    .map((file) => ({
      path: file.absolutePath,
      displayPath: file.displayPath ?? file.path,
      additions: file.additions,
      deletions: file.deletions,
    }));
  return {
    turnId: review.turnId,
    fileCount: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files,
  };
}

export async function persistReviewArtifact(
  store: ReviewArtifactStore,
  sessionId: string,
  review: FileReviewTurnSnapshot,
  summary: ScoutChangesReviewSummary,
  createdAt = new Date().toISOString(),
): Promise<{ manifest: ReviewArtifactManifest; ref: ReviewArtifactRef }> {
  if (review.phase !== 'finalized') {
    throw new Error(`Changes review turn 尚未完成，不能持久化 artifact: ${review.turnId}`);
  }
  const records = await Promise.all(
    review.records.map(
      async (record): Promise<ReviewArtifactRecord> => ({
        recordId: record.recordId,
        toolCallId: record.toolCallId,
        fileId: record.fileId,
        revision: record.revision,
        operation: record.operation,
        sequence: record.sequence,
        toolOutcome: record.toolOutcome ?? 'success',
        before: await persistSnapshot(store, record.before),
        after: await persistSnapshot(store, record.after),
      }),
    ),
  );
  const files = await Promise.all(
    review.files.map(async (file): Promise<ReviewArtifactFile> => {
      if (!file.fileId || !file.revision) {
        throw new Error(`Review file identity is incomplete: ${file.absolutePath}`);
      }
      return {
        fileId: file.fileId,
        path: file.path,
        absolutePath: file.absolutePath,
        displayPath: file.displayPath,
        recordIds: [...file.recordIds],
        latestRevision: file.revision,
        additions: file.additions,
        deletions: file.deletions,
        // generation_failed/diff_too_large 是可重算的派生状态；只有源快照本身
        // 不可用时才阻止历史 exact 请求。
        unavailableReason: file.originalReason ?? file.modifiedReason,
        baseline: await persistSnapshot(
          store,
          toSnapshot(file.originalContent, file.originalReason),
        ),
        final: await persistSnapshot(store, toSnapshot(file.modifiedContent, file.modifiedReason)),
      };
    }),
  );
  const manifest: ReviewArtifactManifest = {
    version: REVIEW_ARTIFACT_MANIFEST_VERSION,
    sessionId,
    turnId: review.turnId,
    createdAt,
    records,
    files,
  };
  const manifestHash = await store.putManifest(manifest);
  return {
    manifest,
    ref: {
      version: REVIEW_ARTIFACT_REF_VERSION,
      sessionId,
      turnId: review.turnId,
      createdAt,
      complete: true,
      manifestHash,
      summary,
    },
  };
}

export async function loadReviewArtifact(
  store: ReviewArtifactStore,
  ref: ReviewArtifactRef,
): Promise<ReviewArtifactManifest> {
  const value = await store.getManifest(ref.manifestHash);
  if (!isReviewArtifactManifest(value)) throw new Error('Review artifact manifest is invalid');
  if (value.sessionId !== ref.sessionId || value.turnId !== ref.turnId) {
    throw new Error('Review artifact manifest identity is stale');
  }
  return value;
}

export async function loadStoredSnapshot(
  store: ReviewArtifactStore,
  ref: StoredSnapshotRef,
): Promise<{ content: string | null; unavailableReason?: DiffUnavailableReason }> {
  if (ref.kind === 'absent') return { content: null };
  if (ref.kind === 'unavailable') return { content: null, unavailableReason: ref.reason };
  const content = await store.getText(ref.hash);
  if (Buffer.byteLength(content, 'utf8') !== ref.byteLength) {
    throw new Error(`Review artifact declared length mismatch: ${ref.hash}`);
  }
  return { content };
}

export function decodeReviewArtifactRef(value: unknown): ReviewArtifactRef | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.version !== REVIEW_ARTIFACT_REF_VERSION ||
    typeof value.sessionId !== 'string' ||
    typeof value.turnId !== 'string' ||
    typeof value.createdAt !== 'string' ||
    value.complete !== true ||
    typeof value.manifestHash !== 'string' ||
    !isChangesReviewSummary(value.summary)
  ) {
    return undefined;
  }
  return value as unknown as ReviewArtifactRef;
}

export function collectCurrentBranchReviewArtifactRefs(
  entries: readonly SessionTreeEntry[] | undefined,
  branchEntries: readonly SessionTreeEntry[] | undefined,
): ReviewArtifactRefIndex {
  if (!entries || !branchEntries) return { refsByTurnId: new Map() };
  const includedEntryIds = collectBranchAndMetadataDescendantIds(entries, branchEntries);
  const refsByTurnId = new Map<string, ReviewArtifactRef>();
  let latestRef: ReviewArtifactRef | undefined;
  for (const entry of entries) {
    if (!includedEntryIds.has(entry.id)) continue;
    if (entry.type !== 'custom' || entry.customType !== REVIEW_ARTIFACT_CUSTOM_TYPE) continue;
    const ref = decodeReviewArtifactRef(entry.data);
    if (!ref) continue;
    refsByTurnId.set(ref.turnId, ref);
    latestRef = ref;
  }
  return {
    refsByTurnId,
    latestRef,
    latestTurnId: latestRef?.turnId,
  };
}

/** 扫描全部 session JSONL（包括非当前分支 ref）并执行一次保守 mark-and-sweep。 */
export async function runReviewArtifactGarbageCollection(options: {
  agentDir: string;
  sessionsRoot: string;
}): Promise<ReviewArtifactGarbageCollectionReport> {
  const store = new ReviewArtifactStore({ agentDir: options.agentDir });
  await mkdir(store.root, { recursive: true, mode: 0o700 });
  const lockPath = join(store.root, '.gc.lock');
  const lock = await acquireGcLock(lockPath);
  if (!lock) {
    return {
      skipped: true,
      deletedFiles: 0,
      deletedBytes: 0,
      retainedBytes: 0,
      reclaimableFiles: 0,
      reclaimableBytes: 0,
      overSoftLimit: false,
    };
  }
  try {
    const manifestHashes = await collectSessionManifestHashes(options.sessionsRoot);
    const blobHashes = new Set<string>();
    // 只要任一被引用 manifest 无法解析，就跳过本轮 sweep，避免误删共享 blob。
    for (const hash of manifestHashes) {
      let value: unknown;
      try {
        value = await store.getManifest(hash);
      } catch {
        return {
          skipped: true,
          deletedFiles: 0,
          deletedBytes: 0,
          retainedBytes: 0,
          reclaimableFiles: 0,
          reclaimableBytes: 0,
          overSoftLimit: false,
        };
      }
      collectManifestBlobHashes(value, blobHashes);
    }
    const result = await store.collectGarbage(manifestHashes, blobHashes);
    return {
      ...result,
      skipped: false,
      overSoftLimit: result.retainedBytes > REVIEW_ARTIFACT_SOFT_LIMIT_BYTES,
    };
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

function toSnapshot(
  content: string | null,
  unavailableReason?: DiffUnavailableReason,
): CapturedTextSnapshot {
  return {
    content,
    byteLength: content === null ? 0 : Buffer.byteLength(content, 'utf8'),
    unavailableReason: unavailableReason as CapturedTextSnapshot['unavailableReason'],
  };
}

async function persistSnapshot(
  store: ReviewArtifactStore,
  snapshot: CapturedTextSnapshot,
): Promise<StoredSnapshotRef> {
  if (snapshot.unavailableReason) {
    return {
      kind: 'unavailable',
      reason: snapshot.unavailableReason,
      byteLength: snapshot.byteLength,
    };
  }
  if (snapshot.content === null) return { kind: 'absent' };
  return {
    kind: 'blob',
    hash: await store.putText(snapshot.content),
    byteLength: snapshot.byteLength,
  };
}

function isReviewArtifactManifest(value: unknown): value is ReviewArtifactManifest {
  if (!isRecord(value)) return false;
  const manifest = value as unknown as ReviewArtifactManifest;
  return (
    value.version === REVIEW_ARTIFACT_MANIFEST_VERSION &&
    typeof value.sessionId === 'string' &&
    typeof value.turnId === 'string' &&
    typeof value.createdAt === 'string' &&
    Array.isArray(value.records) &&
    value.records.every(isArtifactRecord) &&
    Array.isArray(value.files) &&
    value.files.every(isArtifactFile) &&
    hasConsistentManifestReferences(manifest)
  );
}

function isArtifactRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.recordId === 'string' &&
    typeof value.toolCallId === 'string' &&
    typeof value.fileId === 'string' &&
    Number.isInteger(value.revision) &&
    (value.operation === 'edit' || value.operation === 'write') &&
    Number.isInteger(value.sequence) &&
    (value.toolOutcome === 'success' || value.toolOutcome === 'error_after_write') &&
    isSnapshotRef(value.before) &&
    isSnapshotRef(value.after)
  );
}

function isArtifactFile(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.fileId === 'string' &&
    typeof value.path === 'string' &&
    typeof value.absolutePath === 'string' &&
    Array.isArray(value.recordIds) &&
    value.recordIds.every((id) => typeof id === 'string') &&
    Number.isInteger(value.latestRevision) &&
    Number.isInteger(value.additions) &&
    Number.isInteger(value.deletions) &&
    isSnapshotRef(value.baseline) &&
    isSnapshotRef(value.final)
  );
}

function isSnapshotRef(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'absent') return true;
  if (value.kind === 'blob') {
    return (
      typeof value.hash === 'string' &&
      /^[a-f0-9]{64}$/.test(value.hash) &&
      typeof value.byteLength === 'number' &&
      Number.isInteger(value.byteLength) &&
      value.byteLength >= 0
    );
  }
  return (
    value.kind === 'unavailable' &&
    typeof value.reason === 'string' &&
    Number.isInteger(value.byteLength)
  );
}

function hasConsistentManifestReferences(manifest: ReviewArtifactManifest): boolean {
  const recordsById = new Map(manifest.records.map((record) => [record.recordId, record]));
  const filesById = new Map(manifest.files.map((file) => [file.fileId, file]));
  if (recordsById.size !== manifest.records.length || filesById.size !== manifest.files.length) {
    return false;
  }
  for (const record of manifest.records) {
    const file = filesById.get(record.fileId);
    if (!file || !file.recordIds.includes(record.recordId)) return false;
  }
  for (const file of manifest.files) {
    if (new Set(file.recordIds).size !== file.recordIds.length) return false;
    const records = file.recordIds.map((recordId) => recordsById.get(recordId));
    if (records.some((record) => !record || record.fileId !== file.fileId)) return false;
    if (
      records.length > 0 &&
      Math.max(...records.map((record) => record!.revision)) !== file.latestRevision
    ) {
      return false;
    }
  }
  return true;
}

function isChangesReviewSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.turnId === 'string' &&
    Number.isInteger(value.fileCount) &&
    Number.isInteger(value.additions) &&
    Number.isInteger(value.deletions) &&
    Array.isArray(value.files)
  );
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
  while (queue.length > 0) {
    const parentId = queue.shift();
    if (!parentId) continue;
    for (const child of childrenByParentId.get(parentId) ?? []) {
      if (includedEntryIds.has(child.id) || !isSessionMetadataEntry(child)) continue;
      includedEntryIds.add(child.id);
      queue.push(child.id);
    }
  }
  return includedEntryIds;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function acquireGcLock(lockPath: string) {
  try {
    return await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) throw error;
  }
  try {
    const metadata = await stat(lockPath);
    if (Date.now() - metadata.mtimeMs < REVIEW_ARTIFACT_GC_GRACE_MS) return undefined;
    await rm(lockPath, { force: true });
    return await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'EEXIST')) return undefined;
    throw error;
  }
}

async function collectSessionManifestHashes(sessionsRoot: string): Promise<Set<string>> {
  const hashes = new Set<string>();
  for (const path of await listJsonlFiles(sessionsRoot)) {
    const content = await readFile(path, 'utf8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as unknown;
        if (
          !isRecord(entry) ||
          entry.type !== 'custom' ||
          entry.customType !== REVIEW_ARTIFACT_CUSTOM_TYPE
        ) {
          continue;
        }
        const ref = decodeReviewArtifactRef(entry.data);
        if (ref) hashes.add(ref.manifestHash);
      } catch {
        // 其他 session entry 损坏由 session loader 负责；GC 只忽略不可识别行。
      }
    }
  }
  return hashes;
}

async function listJsonlFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await listJsonlFiles(path)));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
  }
  return files;
}

function collectManifestBlobHashes(value: unknown, result: Set<string>): void {
  if (!isRecord(value) || value.version !== REVIEW_ARTIFACT_MANIFEST_VERSION) return;
  for (const collection of [value.records, value.files]) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      if (!isRecord(item)) continue;
      for (const field of ['before', 'after', 'baseline', 'final']) {
        const ref = item[field];
        if (isRecord(ref) && ref.kind === 'blob' && typeof ref.hash === 'string') {
          result.add(ref.hash);
        }
      }
    }
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
