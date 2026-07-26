// ============================================================
// File diff request handler — 安全解析 runtime/artifact lazy diff
// ============================================================

import type {
  FileDiffResultMessage,
  RequestFileDiffMessage,
  ScoutFileDiffView,
} from '@scout-agent/shared';
import type { FileReviewTurnSnapshot } from '../../core/review/index.ts';
import type {
  FileReviewArtifact,
  FileReviewArtifactFile,
} from '../../core/review/file-review-artifact.ts';
import { DiffDocumentProjector } from '../review/diff-document-projector.ts';

// ---------- 类型 ----------

export interface FileDiffRequestHandlerOptions {
  getCurrentSessionId: () => string;
  getRuntimeReview: (turnId: string) => FileReviewTurnSnapshot | undefined;
  getArtifact: (turnId: string) => Promise<FileReviewArtifact | undefined>;
  maxCacheEntries?: number;
  projector?: DiffDocumentProjector;
}

interface ResolvedDiffSource {
  filePath: string;
  document: FileReviewArtifactFile['document'];
}

// ---------- 常量 ----------

const INLINE_MAX_ROWS = 40;
const INLINE_MAX_HUNKS = 8;
const PANEL_MAX_ROWS = 2_000;
const PANEL_MAX_HUNKS = 200;

// ---------- Handler ----------

export class FileDiffRequestHandler {
  private readonly getCurrentSessionId: () => string;
  private readonly getRuntimeReview: (turnId: string) => FileReviewTurnSnapshot | undefined;
  private readonly getArtifact: (turnId: string) => Promise<FileReviewArtifact | undefined>;
  private readonly maxCacheEntries: number;
  private readonly projector: DiffDocumentProjector;
  private readonly cache = new Map<string, ScoutFileDiffView>();

  constructor(options: FileDiffRequestHandlerOptions) {
    this.getCurrentSessionId = options.getCurrentSessionId;
    this.getRuntimeReview = options.getRuntimeReview;
    this.getArtifact = options.getArtifact;
    this.maxCacheEntries = Math.max(1, options.maxCacheEntries ?? 64);
    this.projector = options.projector ?? new DiffDocumentProjector();
  }

  async handle(message: RequestFileDiffMessage): Promise<FileDiffResultMessage> {
    const identity = {
      type: 'file_diff_result' as const,
      turnId: message.turnId,
      fileId: message.fileId,
      revision: message.revision,
    };
    if (!message.sessionId || message.sessionId !== this.getCurrentSessionId()) {
      return { ...identity, status: 'error', message: 'File diff session is stale' };
    }
    if (!Number.isInteger(message.revision) || message.revision < 1) {
      return { ...identity, status: 'error', message: 'File diff revision is invalid' };
    }

    const runtime = this.resolveRuntime(message);
    if (runtime.kind === 'pending') return { ...identity, status: 'pending' };
    if (runtime.kind === 'unavailable') {
      return { ...identity, status: 'unavailable', message: runtime.message };
    }

    const source = runtime.source ?? (await this.resolveArtifact(message));
    if (!source) {
      return { ...identity, status: 'error', message: 'File diff is unavailable or stale' };
    }
    if (source.document.unavailableReason) {
      return {
        ...identity,
        status: 'unavailable',
        message: source.document.unavailableReason,
      };
    }

    const policy = createProjectionPolicy(message);
    const cacheKey = JSON.stringify([
      message.sessionId,
      message.turnId,
      message.fileId,
      message.revision,
      message.view,
      policy.mode,
      policy.includeTokens,
      policy.hunkOffset,
      policy.hunkLimit,
      policy.maxRows,
    ]);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return { ...identity, status: 'ready', diff: cloneDiffView(cached) };
    }

    const diff = this.projector.project(source.document, source.filePath, policy);
    this.cache.set(cacheKey, cloneDiffView(diff));
    this.trim();
    return { ...identity, status: 'ready', diff };
  }

  clear(): void {
    this.cache.clear();
    this.projector.clear();
  }

  private resolveRuntime(
    message: RequestFileDiffMessage,
  ):
    | { kind: 'ready'; source?: ResolvedDiffSource }
    | { kind: 'pending' }
    | { kind: 'unavailable'; message?: string } {
    const review = this.getRuntimeReview(message.turnId);
    if (!review) return { kind: 'ready' };
    const file = review.files.find((candidate) => candidate.fileId === message.fileId);
    if (!file) return { kind: 'ready' };
    if (file.revision !== message.revision) {
      return { kind: 'unavailable', message: 'File diff revision is stale' };
    }
    if (file.projectionStatus === 'pending') return { kind: 'pending' };
    if (file.projectionStatus === 'unavailable' || !file.document) {
      return { kind: 'unavailable', message: file.unavailableReason };
    }
    return {
      kind: 'ready',
      source: { filePath: file.absolutePath, document: file.document },
    };
  }

  private async resolveArtifact(
    message: RequestFileDiffMessage,
  ): Promise<ResolvedDiffSource | undefined> {
    const artifact = await this.getArtifact(message.turnId);
    if (!artifact?.complete) return undefined;
    const file = artifact.files.find((candidate) => candidate.fileId === message.fileId);
    if (!file || file.latestRevision !== message.revision) return undefined;
    return { filePath: file.absolutePath, document: file.document };
  }

  private trim(): void {
    while (this.cache.size > this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) return;
      this.cache.delete(oldestKey);
    }
  }
}

function createProjectionPolicy(message: RequestFileDiffMessage) {
  const maxHunks = message.view === 'inline' ? INLINE_MAX_HUNKS : PANEL_MAX_HUNKS;
  const requestedOffset = message.range?.hunkOffset ?? 0;
  const requestedLimit = message.range?.hunkLimit ?? maxHunks;
  return {
    mode: message.mode,
    includeTokens: message.includeTokens,
    hunkOffset: Math.max(0, Math.floor(requestedOffset)),
    hunkLimit: Math.min(maxHunks, Math.max(1, Math.floor(requestedLimit))),
    maxRows: message.view === 'inline' ? INLINE_MAX_ROWS : PANEL_MAX_ROWS,
  };
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
