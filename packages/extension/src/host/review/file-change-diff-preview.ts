// ============================================================
// File change diff preview — host 边界的 tool result diff 预览装饰器
// 负责：按 recordId 从 runtime/artifact 中解析轻量 diffPreview，附到 file_change details。
// ============================================================

import type {
  ScoutChangesReviewRow,
  ScoutFileChangeDetails,
  ScoutFileChangeDiffPreview,
} from '@scout-agent/shared';
import {
  computeReviewDiff,
  REVIEW_CONTEXT_LINES,
  type FileReviewFile,
  type FileReviewTurnSnapshot,
} from '../../core/review/file-review.ts';
import type { FileReviewArtifact, FileReviewArtifactFile } from './file-review-artifact.ts';

// ---------- 类型 ----------

export interface FileChangeDiffPreviewPolicy {
  maxRows: number;
  includeTokens: boolean;
}

export interface FileChangeDiffPreviewProvider {
  resolve(
    details: ScoutFileChangeDetails,
    policy: FileChangeDiffPreviewPolicy,
  ): ScoutFileChangeDiffPreview | undefined;
}

type FileChangeDiffPreviewMemoValue = ScoutFileChangeDiffPreview | null;

// ---------- 常量 ----------

export const CHAT_FILE_CHANGE_DIFF_PREVIEW_POLICY: FileChangeDiffPreviewPolicy = {
  maxRows: 40,
  includeTokens: false,
};

const DEFAULT_PREVIEW_MEMO_MAX_ENTRIES = 64;

// ---------- Provider ----------

export class RuntimeFileChangeDiffPreviewProvider implements FileChangeDiffPreviewProvider {
  private readonly getReview: (turnId: string) => FileReviewTurnSnapshot | undefined;

  constructor(getReview: (turnId: string) => FileReviewTurnSnapshot | undefined) {
    this.getReview = getReview;
  }

  resolve(
    details: ScoutFileChangeDetails,
    policy: FileChangeDiffPreviewPolicy,
  ): ScoutFileChangeDiffPreview | undefined {
    const review = this.getReview(details.review.turnId);
    if (!review || review.contentReleased) return undefined;
    const file = findMatchingRuntimeFile(review, details);
    if (!file) return undefined;

    const diff = computeReviewDiff(file.originalContent, file.modifiedContent, {
      collapseContext: true,
      contextLines: REVIEW_CONTEXT_LINES,
      filePath: file.absolutePath,
      includeTokens: policy.includeTokens,
      unavailableReason: file.unavailableReason,
    });
    return createDiffPreview(diff.rows, policy, diff.unavailableReason);
  }
}

export class ArtifactFileChangeDiffPreviewProvider implements FileChangeDiffPreviewProvider {
  private readonly getArtifact: (turnId: string) => FileReviewArtifact | undefined;

  constructor(getArtifact: (turnId: string) => FileReviewArtifact | undefined) {
    this.getArtifact = getArtifact;
  }

  resolve(
    details: ScoutFileChangeDetails,
    policy: FileChangeDiffPreviewPolicy,
  ): ScoutFileChangeDiffPreview | undefined {
    const artifact = this.getArtifact(details.review.turnId);
    const file = artifact?.files.find((candidate) => isMatchingArtifactFile(candidate, details));
    if (!file) return undefined;
    return createDiffPreview(file.rows, policy, file.unavailableReason);
  }
}

export class CompositeFileChangeDiffPreviewProvider implements FileChangeDiffPreviewProvider {
  private readonly providers: readonly FileChangeDiffPreviewProvider[];

  constructor(providers: readonly FileChangeDiffPreviewProvider[]) {
    this.providers = providers;
  }

  resolve(
    details: ScoutFileChangeDetails,
    policy: FileChangeDiffPreviewPolicy,
  ): ScoutFileChangeDiffPreview | undefined {
    for (const provider of this.providers) {
      const preview = provider.resolve(details, policy);
      if (preview) return preview;
    }
    return undefined;
  }
}

// ---------- Enricher ----------

export class FileChangeDiffPreviewMemo {
  private readonly maxEntries: number;
  private readonly entries = new Map<string, FileChangeDiffPreviewMemoValue>();

  constructor(options: { maxEntries?: number } = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_PREVIEW_MEMO_MAX_ENTRIES);
  }

  getOrResolve(
    scopeKey: string,
    details: ScoutFileChangeDetails,
    policy: FileChangeDiffPreviewPolicy,
    resolve: () => ScoutFileChangeDiffPreview | undefined,
  ): ScoutFileChangeDiffPreview | undefined {
    const key = createPreviewMemoKey(scopeKey, details, policy);
    if (this.entries.has(key)) {
      const cached = this.entries.get(key) ?? null;
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached ?? undefined;
    }

    const resolved = resolve() ?? null;
    this.entries.set(key, resolved);
    this.trim();
    return resolved ?? undefined;
  }

  clear(): void {
    this.entries.clear();
  }

  private trim(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) return;
      this.entries.delete(oldestKey);
    }
  }
}

export function enrichFileChangeDetails(
  details: unknown,
  provider: FileChangeDiffPreviewProvider,
  policy: FileChangeDiffPreviewPolicy = CHAT_FILE_CHANGE_DIFF_PREVIEW_POLICY,
): unknown {
  if (!isFileChangeDetails(details)) return details;
  if (details.diffPreview) return details;
  const diffPreview = provider.resolve(details, policy);
  return diffPreview ? { ...details, diffPreview } : details;
}

export function createMemoizedFileChangeDetailsEnricher(
  provider: FileChangeDiffPreviewProvider,
  policy: FileChangeDiffPreviewPolicy = CHAT_FILE_CHANGE_DIFF_PREVIEW_POLICY,
  memo = new FileChangeDiffPreviewMemo(),
  scopeKey = '',
): (details: unknown) => unknown {
  return (details) => {
    if (!isFileChangeDetails(details)) return details;
    if (details.diffPreview) return details;

    const diffPreview = memo.getOrResolve(scopeKey, details, policy, () =>
      provider.resolve(details, policy),
    );
    return diffPreview ? { ...details, diffPreview } : details;
  };
}

// ---------- 内部 ----------

function findMatchingRuntimeFile(
  review: FileReviewTurnSnapshot,
  details: ScoutFileChangeDetails,
): FileReviewFile | undefined {
  return review.files.find(
    (file) =>
      file.latestRecordId === details.review.recordId &&
      (file.absolutePath === details.path ||
        Boolean(details.displayPath && file.displayPath === details.displayPath)),
  );
}

function isMatchingArtifactFile(
  file: FileReviewArtifactFile,
  details: ScoutFileChangeDetails,
): boolean {
  return (
    file.latestRecordId === details.review.recordId &&
    (file.absolutePath === details.path ||
      Boolean(details.displayPath && file.displayPath === details.displayPath))
  );
}

function createDiffPreview(
  rows: readonly ScoutChangesReviewRow[],
  policy: FileChangeDiffPreviewPolicy,
  unavailableReason: string | undefined,
): ScoutFileChangeDiffPreview | undefined {
  const preview: ScoutFileChangeDiffPreview = {
    rows: rows.slice(0, policy.maxRows).map((row) => copyPreviewRow(row, policy)),
    truncated: rows.length > policy.maxRows || undefined,
    unavailableReason,
  };
  if (preview.rows.length === 0 && !preview.unavailableReason) return undefined;
  return preview;
}

function createPreviewMemoKey(
  scopeKey: string,
  details: ScoutFileChangeDetails,
  policy: FileChangeDiffPreviewPolicy,
): string {
  return [
    scopeKey,
    details.review.turnId,
    details.review.recordId,
    policy.maxRows,
    policy.includeTokens ? 'tokens' : 'no_tokens',
  ].join('\u0000');
}

function copyPreviewRow(
  row: ScoutChangesReviewRow,
  policy: FileChangeDiffPreviewPolicy,
): ScoutChangesReviewRow {
  if (row.type === 'fold') {
    return {
      type: 'fold',
      oldStartLine: row.oldStartLine,
      newStartLine: row.newStartLine,
      count: row.count,
    };
  }
  const copy: ScoutChangesReviewRow = {
    type: row.type,
    oldLineNumber: row.oldLineNumber,
    newLineNumber: row.newLineNumber,
    text: row.text,
  };
  if (policy.includeTokens && row.tokens) {
    copy.tokens = row.tokens.map((token) => ({ ...token }));
  }
  return copy;
}

function isFileChangeDetails(value: unknown): value is ScoutFileChangeDetails {
  if (!value || typeof value !== 'object') return false;
  const details = value as Partial<ScoutFileChangeDetails>;
  return (
    details.kind === 'file_change' &&
    typeof details.path === 'string' &&
    typeof details.additions === 'number' &&
    typeof details.deletions === 'number' &&
    Boolean(details.review) &&
    typeof details.review?.turnId === 'string' &&
    typeof details.review?.recordId === 'string'
  );
}
