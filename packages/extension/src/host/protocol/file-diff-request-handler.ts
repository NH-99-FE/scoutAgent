// ============================================================
// File diff request handler — 从 runtime/外部 artifact 精确解析 snapshot pair
// ============================================================

import type {
  FileDiffContextResultMessage,
  FileDiffResultMessage,
  RequestFileDiffContextMessage,
  RequestFileDiffMessage,
  ScoutChangesReviewRow,
  ScoutFileDiffView,
} from '@scout-agent/shared';
import { createHash } from 'node:crypto';
import type { DiffDocument, DiffUnavailableReason } from '../../core/review/diff-document.ts';
import {
  MAX_REVIEW_DIFF_ROWS,
  createDiffContentFingerprint,
  createUnavailableDiffDocument,
} from '../../core/review/diff-document.ts';
import type { FileReviewTurnSnapshot } from '../../core/review/file-review.ts';
import type { ExactMutationDiffInput } from '../../core/review/mutation-journal.ts';
import {
  loadStoredSnapshot,
  type ReviewArtifactManifest,
  type StoredSnapshotRef,
} from '../../core/review/review-artifact.ts';
import type { ReviewArtifactStore } from '../../core/review/review-artifact-store.ts';
import { splitReviewLines } from '../../core/review/review-text.ts';
import { DiffDocumentProjector, createDiffFoldId } from '../review/diff-document-projector.ts';

export interface FileDiffRequestHandlerOptions {
  getCurrentSessionId: () => string;
  getRuntimeReview: (turnId: string) => FileReviewTurnSnapshot | undefined;
  getArtifact: (turnId: string) => Promise<ReviewArtifactManifest | undefined>;
  artifactStore: ReviewArtifactStore;
  computeDiff: (input: ExactMutationDiffInput) => Promise<DiffDocument> | undefined;
  maxCacheEntries?: number;
  projector?: DiffDocumentProjector;
}

interface ResolvedDiffSource {
  filePath: string;
  originalContent: string | null;
  modifiedContent: string | null;
  unavailableReason?: DiffUnavailableReason;
  pairIdentity: string;
}

const INLINE_MAX_ROWS = 40;
const INLINE_MAX_HUNKS = 8;
const PANEL_MAX_ROWS = MAX_REVIEW_DIFF_ROWS;
const PANEL_MAX_HUNKS = MAX_REVIEW_DIFF_ROWS;
const MAX_CONTEXT_REVEAL = 20_000;

export class FileDiffRequestHandler {
  private readonly getCurrentSessionId: () => string;
  private readonly getRuntimeReview: (turnId: string) => FileReviewTurnSnapshot | undefined;
  private readonly getArtifact: (turnId: string) => Promise<ReviewArtifactManifest | undefined>;
  private readonly artifactStore: ReviewArtifactStore;
  private readonly computeDiff: FileDiffRequestHandlerOptions['computeDiff'];
  private readonly maxCacheEntries: number;
  private readonly projector: DiffDocumentProjector;
  private readonly viewCache = new Map<string, ScoutFileDiffView>();
  private readonly documentCache = new Map<string, Promise<DiffDocument>>();

  constructor(options: FileDiffRequestHandlerOptions) {
    this.getCurrentSessionId = options.getCurrentSessionId;
    this.getRuntimeReview = options.getRuntimeReview;
    this.getArtifact = options.getArtifact;
    this.artifactStore = options.artifactStore;
    this.computeDiff = options.computeDiff;
    this.maxCacheEntries = Math.max(1, options.maxCacheEntries ?? 64);
    this.projector = options.projector ?? new DiffDocumentProjector();
  }

  async handle(message: RequestFileDiffMessage): Promise<FileDiffResultMessage> {
    const identity = diffIdentity(message);
    const validation = this.validateRequest(message);
    if (validation) return { ...identity, status: 'error', message: validation };

    const resolved = await this.resolveSource(message);
    if ('error' in resolved) {
      return { ...identity, status: 'unavailable', message: resolved.error };
    }
    const source = resolved.source;
    const document = await this.getDocument(message, source);
    if (document.unavailableReason) {
      return { ...identity, status: 'unavailable', message: document.unavailableReason };
    }

    const policy = createProjectionPolicy(message, createFoldIdentity(message, source));
    const cacheKey = JSON.stringify([
      source.pairIdentity,
      source.filePath,
      message.recordId,
      message.view,
      policy.mode,
      policy.includeTokens,
      policy.hunkOffset,
      policy.hunkLimit,
      policy.maxRows,
    ]);
    const cached = touch(this.viewCache, cacheKey);
    if (cached) return { ...identity, status: 'ready', diff: cloneDiffView(cached) };

    const diff = this.projector.project(document, source.filePath, policy);
    this.viewCache.set(cacheKey, cloneDiffView(diff));
    this.trim();
    return { ...identity, status: 'ready', diff };
  }

  async handleContext(
    message: RequestFileDiffContextMessage,
  ): Promise<FileDiffContextResultMessage> {
    const identity = {
      type: 'file_diff_context_result' as const,
      turnId: message.turnId,
      fileId: message.fileId,
      revision: message.revision,
      foldId: message.foldId,
    };
    if (!message.sessionId || message.sessionId !== this.getCurrentSessionId()) {
      return { ...identity, status: 'error', message: 'File diff session is stale' };
    }
    if (message.recordId) {
      return { ...identity, status: 'error', message: 'Inline diff folds cannot be expanded' };
    }
    if (
      !isRevealCount(message.revealHead) ||
      !isRevealCount(message.revealTail) ||
      !Number.isInteger(message.revision) ||
      message.revision < 1
    ) {
      return { ...identity, status: 'error', message: 'File diff context range is invalid' };
    }

    const baseMessage: RequestFileDiffMessage = {
      type: 'request_file_diff',
      sessionId: message.sessionId,
      turnId: message.turnId,
      fileId: message.fileId,
      revision: message.revision,
      view: 'panel',
      mode: 'unified',
      includeTokens: false,
    };
    const resolved = await this.resolveSource(baseMessage);
    if ('error' in resolved) {
      return { ...identity, status: 'unavailable', message: resolved.error };
    }
    const source = resolved.source;
    const document = await this.getDocument(baseMessage, source);
    if (document.unavailableReason) {
      return { ...identity, status: 'unavailable', message: document.unavailableReason };
    }

    // 重新从同一 snapshot pair 生成 fold，并以稳定 identity 校验请求范围。
    const complete = this.projector.project(document, source.filePath, {
      mode: 'unified',
      includeTokens: false,
      hunkOffset: 0,
      hunkLimit: document.hunks.length || 1,
      maxRows: Number.MAX_SAFE_INTEGER,
      foldIdentity: createFoldIdentity(baseMessage, source),
    });
    const fold = complete.rows.find((row) => row.type === 'fold' && row.foldId === message.foldId);
    if (!fold?.count || !fold.oldStartLine || !fold.newStartLine) {
      return { ...identity, status: 'error', message: 'File diff fold is stale' };
    }
    const expectedFoldId = createDiffFoldId(
      createFoldIdentity(baseMessage, source),
      fold.oldStartLine,
      fold.newStartLine,
      fold.count,
    );
    if (expectedFoldId !== message.foldId) {
      return { ...identity, status: 'error', message: 'File diff fold identity is invalid' };
    }

    const rows = createContextRows(source, fold.oldStartLine, fold.newStartLine, fold.count);
    const headCount = Math.min(rows.length, message.revealHead);
    const tailCount = Math.min(rows.length - headCount, message.revealTail);
    let headRows = rows.slice(0, headCount);
    let tailRows = tailCount === 0 ? [] : rows.slice(rows.length - tailCount);
    if (message.includeTokens) {
      headRows = this.projector.tokenizeRows(headRows, source.filePath);
      tailRows = this.projector.tokenizeRows(tailRows, source.filePath);
    }
    return { ...identity, status: 'ready', headRows, tailRows, total: rows.length };
  }

  clear(): void {
    this.viewCache.clear();
    this.documentCache.clear();
    this.projector.clear();
  }

  private validateRequest(message: RequestFileDiffMessage): string | undefined {
    if (!message.sessionId || message.sessionId !== this.getCurrentSessionId()) {
      return 'File diff session is stale';
    }
    if (!Number.isInteger(message.revision) || message.revision < 1) {
      return 'File diff revision is invalid';
    }
    if (message.view === 'inline' && !message.recordId) {
      return 'Inline file diff requires recordId';
    }
    if (message.view === 'panel' && message.recordId) {
      return 'Panel file diff uses the turn baseline and final snapshots';
    }
    return undefined;
  }

  private async resolveSource(
    message: RequestFileDiffMessage,
  ): Promise<{ source: ResolvedDiffSource } | { error: string }> {
    const runtime = this.resolveRuntime(message);
    if (runtime) return { source: runtime };
    let artifact: ReviewArtifactManifest | undefined;
    try {
      artifact = await this.getArtifact(message.turnId);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (!artifact) return { error: 'Review artifact is missing or corrupt' };
    try {
      if (message.view === 'inline') {
        const record = artifact.records.find(
          (candidate) =>
            candidate.recordId === message.recordId &&
            candidate.fileId === message.fileId &&
            candidate.revision === message.revision,
        );
        if (!record) return { error: 'File diff record is unavailable or stale' };
        return {
          source: await this.loadStoredSource(
            artifact.files.find((file) => file.fileId === record.fileId)?.absolutePath ?? '',
            record.before,
            record.after,
          ),
        };
      }
      const file = artifact.files.find(
        (candidate) =>
          candidate.fileId === message.fileId && candidate.latestRevision === message.revision,
      );
      if (!file) return { error: 'File diff revision is unavailable or stale' };
      return { source: await this.loadStoredSource(file.absolutePath, file.baseline, file.final) };
    } catch (error) {
      return {
        error: `Review artifact is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private resolveRuntime(message: RequestFileDiffMessage): ResolvedDiffSource | undefined {
    const review = this.getRuntimeReview(message.turnId);
    if (!review || review.contentReleased) return undefined;
    if (message.view === 'inline') {
      const record = review.records.find(
        (candidate) =>
          candidate.recordId === message.recordId &&
          candidate.fileId === message.fileId &&
          candidate.revision === message.revision,
      );
      if (!record) return undefined;
      return createRuntimeSource(
        record.absolutePath,
        record.before.content,
        record.after.content,
        record.before.unavailableReason,
        record.after.unavailableReason,
      );
    }
    const file = review.files.find(
      (candidate) => candidate.fileId === message.fileId && candidate.revision === message.revision,
    );
    if (!file) return undefined;
    return createRuntimeSource(
      file.absolutePath,
      file.originalContent,
      file.modifiedContent,
      file.originalReason,
      file.modifiedReason,
    );
  }

  private async loadStoredSource(
    filePath: string,
    before: StoredSnapshotRef,
    after: StoredSnapshotRef,
  ): Promise<ResolvedDiffSource> {
    const [original, modified] = await Promise.all([
      loadStoredSnapshot(this.artifactStore, before),
      loadStoredSnapshot(this.artifactStore, after),
    ]);
    return {
      filePath,
      originalContent: original.content,
      modifiedContent: modified.content,
      unavailableReason: original.unavailableReason ?? modified.unavailableReason,
      pairIdentity: createStoredPairIdentity(before, after),
    };
  }

  private getDocument(
    message: Pick<RequestFileDiffMessage, 'turnId' | 'fileId' | 'revision'>,
    source: ResolvedDiffSource,
  ): Promise<DiffDocument> {
    const key = `${source.pairIdentity}:diff-v1:context-3`;
    const cached = touch(this.documentCache, key);
    if (cached) return cached;
    const computed = this.computeDiff({
      turnId: message.turnId,
      fileId: message.fileId,
      revision: message.revision,
      filePath: source.filePath,
      originalContent: source.originalContent,
      modifiedContent: source.modifiedContent,
      unavailableReason: source.unavailableReason,
      contextLines: 3,
    });
    const promise = computed ?? Promise.reject(new Error('Diff Worker is unavailable'));
    const guarded: Promise<DiffDocument> = promise
      .catch(() => createUnavailableDiffDocument('generation_failed'))
      .then((document) => {
        // generation_failed 表示 Worker/调度暂时失败。保留本次 in-flight 去重，
        // 但完成后释放缓存，让 Worker 重建后的下一次请求可以重新计算。
        if (
          document.unavailableReason === 'generation_failed' &&
          this.documentCache.get(key) === guarded
        ) {
          this.documentCache.delete(key);
        }
        return document;
      });
    this.documentCache.set(key, guarded);
    this.trim();
    return guarded;
  }

  private trim(): void {
    trimMap(this.viewCache, this.maxCacheEntries);
    trimMap(this.documentCache, this.maxCacheEntries);
  }
}

function diffIdentity(message: RequestFileDiffMessage) {
  return {
    type: 'file_diff_result' as const,
    turnId: message.turnId,
    fileId: message.fileId,
    revision: message.revision,
  };
}

function createProjectionPolicy(message: RequestFileDiffMessage, foldIdentity: string) {
  const maxHunks = message.view === 'inline' ? INLINE_MAX_HUNKS : PANEL_MAX_HUNKS;
  const requestedOffset = message.range?.hunkOffset ?? 0;
  const requestedLimit = message.range?.hunkLimit ?? maxHunks;
  return {
    mode: message.mode,
    includeTokens: message.includeTokens,
    hunkOffset: Math.max(0, Math.floor(requestedOffset)),
    hunkLimit: Math.min(maxHunks, Math.max(1, Math.floor(requestedLimit))),
    maxRows: message.view === 'inline' ? INLINE_MAX_ROWS : PANEL_MAX_ROWS,
    foldIdentity,
  };
}

function createFoldIdentity(
  message: Pick<RequestFileDiffMessage, 'fileId' | 'recordId'>,
  source: ResolvedDiffSource,
): string {
  return `${source.pairIdentity}:${message.fileId}:${message.recordId ?? 'panel'}`;
}

function createRuntimeSource(
  filePath: string,
  originalContent: string | null,
  modifiedContent: string | null,
  originalUnavailableReason?: DiffUnavailableReason,
  modifiedUnavailableReason?: DiffUnavailableReason,
): ResolvedDiffSource {
  return {
    filePath,
    originalContent,
    modifiedContent,
    unavailableReason: originalUnavailableReason ?? modifiedUnavailableReason,
    pairIdentity: hashIdentity([
      createRuntimeSnapshotIdentity(originalContent, originalUnavailableReason),
      createRuntimeSnapshotIdentity(modifiedContent, modifiedUnavailableReason),
    ]),
  };
}

function createStoredPairIdentity(before: StoredSnapshotRef, after: StoredSnapshotRef): string {
  return hashIdentity([createStoredSnapshotIdentity(before), createStoredSnapshotIdentity(after)]);
}

function createRuntimeSnapshotIdentity(
  content: string | null,
  unavailableReason?: DiffUnavailableReason,
): string {
  if (unavailableReason) return `unavailable:${unavailableReason}`;
  if (content === null) return 'absent';
  const fingerprint = createDiffContentFingerprint(content);
  if (!fingerprint) return 'absent';
  return `content:${fingerprint.sha256}:${fingerprint.size}`;
}

function createStoredSnapshotIdentity(ref: StoredSnapshotRef): string {
  if (ref.kind === 'blob') return `content:${ref.hash}:${ref.byteLength}`;
  if (ref.kind === 'absent') return 'absent';
  return `unavailable:${ref.reason}`;
}

function hashIdentity(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

function createContextRows(
  source: ResolvedDiffSource,
  oldStartLine: number,
  newStartLine: number,
  count: number,
): ScoutChangesReviewRow[] {
  const before = splitReviewLines(source.originalContent ?? '');
  const after = splitReviewLines(source.modifiedContent ?? '');
  const rows: ScoutChangesReviewRow[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const oldLineNumber = oldStartLine + offset;
    const newLineNumber = newStartLine + offset;
    const text = after[newLineNumber - 1] ?? before[oldLineNumber - 1];
    if (text === undefined) break;
    rows.push({ type: 'context', oldLineNumber, newLineNumber, text });
  }
  return rows;
}

function isRevealCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_CONTEXT_REVEAL;
}

function touch<K, V>(map: Map<K, V>, key: K): V | undefined {
  const value = map.get(key);
  if (value === undefined) return undefined;
  map.delete(key);
  map.set(key, value);
  return value;
}

function trimMap<K, V>(map: Map<K, V>, maxEntries: number): void {
  while (map.size > maxEntries) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest === undefined) return;
    map.delete(oldest);
  }
}

function cloneDiffView(view: ScoutFileDiffView): ScoutFileDiffView {
  return {
    ...view,
    rows: view.rows.map((row) => ({
      ...row,
      tokens: row.tokens?.map((token) => ({
        ...token,
        syntaxScopes: token.syntaxScopes && [...token.syntaxScopes],
      })),
    })),
  };
}
