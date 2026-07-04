import { describe, expect, it } from 'vitest';
import type { ScoutFileChangeDetails } from '@scout-agent/shared';
import type { FileReviewTurnSnapshot } from '../../../src/core/review/file-review.ts';
import {
  ArtifactFileChangeDiffPreviewProvider,
  CompositeFileChangeDiffPreviewProvider,
  FileChangeDiffPreviewMemo,
  type FileChangeDiffPreviewProvider,
  RuntimeFileChangeDiffPreviewProvider,
  createMemoizedFileChangeDetailsEnricher,
  enrichFileChangeDetails,
} from '../../../src/host/review/file-change-diff-preview.ts';
import type { FileReviewArtifact } from '../../../src/host/review/file-review-artifact.ts';

describe('file change diff preview enrichment', () => {
  it('enriches latest runtime file_change details with bounded token-free preview rows', () => {
    const review = makeRuntimeReview();
    const provider = new RuntimeFileChangeDiffPreviewProvider((turnId) =>
      turnId === review.turnId ? review : undefined,
    );

    const enriched = enrichFileChangeDetails(makeDetails(), provider, {
      maxRows: 2,
      includeTokens: false,
    }) as ScoutFileChangeDetails;

    expect(enriched.diffPreview).toMatchObject({
      truncated: true,
      rows: [
        expect.objectContaining({ type: 'context', text: 'const keep = 1;' }),
        expect.objectContaining({ type: 'removed', text: 'const value = 1;' }),
      ],
    });
    expect(enriched.diffPreview?.rows[1]?.tokens).toBeUndefined();
  });

  it('falls back to persisted artifacts after runtime review content is released', () => {
    const runtimeReview = { ...makeRuntimeReview(), contentReleased: true };
    const artifact = makeArtifact();
    const provider = new CompositeFileChangeDiffPreviewProvider([
      new RuntimeFileChangeDiffPreviewProvider((turnId) =>
        turnId === runtimeReview.turnId ? runtimeReview : undefined,
      ),
      new ArtifactFileChangeDiffPreviewProvider((turnId) =>
        turnId === artifact.turnId ? artifact : undefined,
      ),
    ]);

    const enriched = enrichFileChangeDetails(makeDetails(), provider, {
      maxRows: 10,
      includeTokens: false,
    }) as ScoutFileChangeDetails;

    expect(enriched.diffPreview).toEqual({
      rows: [
        {
          type: 'removed',
          oldLineNumber: 2,
          newLineNumber: undefined,
          text: 'const value = 1;',
        },
        {
          type: 'added',
          oldLineNumber: undefined,
          newLineNumber: 2,
          text: 'const value = 2;',
        },
      ],
      truncated: undefined,
      unavailableReason: undefined,
    });
  });

  it('does not attach the final same-file preview to earlier records', () => {
    const review = makeRuntimeReview();
    const provider = new RuntimeFileChangeDiffPreviewProvider((turnId) =>
      turnId === review.turnId ? review : undefined,
    );

    const enriched = enrichFileChangeDetails(
      makeDetails({ review: { turnId: 'turn-1', recordId: 'review-1' } }),
      provider,
    ) as ScoutFileChangeDetails;

    expect(enriched.diffPreview).toBeUndefined();
  });

  it('preserves unavailable reasons even when no preview rows are available', () => {
    const artifact = makeArtifact({
      rows: [],
      unavailableReason: 'Diff too large to review',
    });
    const provider = new ArtifactFileChangeDiffPreviewProvider((turnId) =>
      turnId === artifact.turnId ? artifact : undefined,
    );

    const enriched = enrichFileChangeDetails(makeDetails(), provider) as ScoutFileChangeDetails;

    expect(enriched.diffPreview).toEqual({
      rows: [],
      truncated: undefined,
      unavailableReason: 'Diff too large to review',
    });
  });

  it('does not resolve previews again when details are already enriched', () => {
    const details = makeDetails({
      diffPreview: {
        rows: [{ type: 'added', newLineNumber: 1, text: 'const value = 2;' }],
      },
    });
    const provider: FileChangeDiffPreviewProvider = {
      resolve() {
        throw new Error('preview should not be resolved for already enriched details');
      },
    };

    expect(enrichFileChangeDetails(details, provider)).toBe(details);
  });

  it('memoizes preview results for the same turn, record, and policy', () => {
    let resolveCount = 0;
    const provider: FileChangeDiffPreviewProvider = {
      resolve() {
        resolveCount += 1;
        return {
          rows: [{ type: 'added', newLineNumber: 1, text: `resolved ${resolveCount}` }],
        };
      },
    };
    const enrich = createMemoizedFileChangeDetailsEnricher(provider, {
      maxRows: 10,
      includeTokens: false,
    });

    const first = enrich(makeDetails()) as ScoutFileChangeDetails;
    const second = enrich(makeDetails({ additions: 5 })) as ScoutFileChangeDetails;

    expect(resolveCount).toBe(1);
    expect(first.diffPreview).toEqual({
      rows: [{ type: 'added', newLineNumber: 1, text: 'resolved 1' }],
    });
    expect(second.diffPreview).toEqual(first.diffPreview);
  });

  it('memoizes missing preview results for the same turn, record, and policy', () => {
    let resolveCount = 0;
    const provider: FileChangeDiffPreviewProvider = {
      resolve() {
        resolveCount += 1;
        return undefined;
      },
    };
    const enrich = createMemoizedFileChangeDetailsEnricher(provider);

    const first = enrich(makeDetails()) as ScoutFileChangeDetails;
    const second = enrich(makeDetails()) as ScoutFileChangeDetails;

    expect(resolveCount).toBe(1);
    expect(first.diffPreview).toBeUndefined();
    expect(second.diffPreview).toBeUndefined();
  });

  it('shares memo entries across enricher instances within the same projection scope', () => {
    let resolveCount = 0;
    const provider: FileChangeDiffPreviewProvider = {
      resolve() {
        resolveCount += 1;
        return {
          rows: [{ type: 'added', newLineNumber: 1, text: `resolved ${resolveCount}` }],
        };
      },
    };
    const memo = new FileChangeDiffPreviewMemo({ maxEntries: 8 });
    const policy = { maxRows: 10, includeTokens: false };
    const firstEnrich = createMemoizedFileChangeDetailsEnricher(
      provider,
      policy,
      memo,
      'session-1:projection-1',
    );
    const secondEnrich = createMemoizedFileChangeDetailsEnricher(
      provider,
      policy,
      memo,
      'session-1:projection-1',
    );
    const nextProjectionEnrich = createMemoizedFileChangeDetailsEnricher(
      provider,
      policy,
      memo,
      'session-1:projection-2',
    );

    const first = firstEnrich(makeDetails()) as ScoutFileChangeDetails;
    const second = secondEnrich(makeDetails({ additions: 5 })) as ScoutFileChangeDetails;
    const nextProjection = nextProjectionEnrich(makeDetails()) as ScoutFileChangeDetails;

    expect(resolveCount).toBe(2);
    expect(first.diffPreview).toEqual({
      rows: [{ type: 'added', newLineNumber: 1, text: 'resolved 1' }],
    });
    expect(second.diffPreview).toEqual(first.diffPreview);
    expect(nextProjection.diffPreview).toEqual({
      rows: [{ type: 'added', newLineNumber: 1, text: 'resolved 2' }],
    });
  });

  it('keeps the shared memo bounded by evicting the oldest preview entries', () => {
    let resolveCount = 0;
    const provider: FileChangeDiffPreviewProvider = {
      resolve(details) {
        resolveCount += 1;
        return {
          rows: [
            {
              type: 'added',
              newLineNumber: 1,
              text: `${details.review.recordId}:${resolveCount}`,
            },
          ],
        };
      },
    };
    const memo = new FileChangeDiffPreviewMemo({ maxEntries: 1 });
    const enrich = createMemoizedFileChangeDetailsEnricher(
      provider,
      { maxRows: 10, includeTokens: false },
      memo,
      'session-1:projection-1',
    );

    enrich(makeDetails({ review: { turnId: 'turn-1', recordId: 'review-2' } }));
    enrich(makeDetails({ review: { turnId: 'turn-1', recordId: 'review-3' } }));
    const repeated = enrich(
      makeDetails({ review: { turnId: 'turn-1', recordId: 'review-2' } }),
    ) as ScoutFileChangeDetails;

    expect(resolveCount).toBe(3);
    expect(repeated.diffPreview).toEqual({
      rows: [{ type: 'added', newLineNumber: 1, text: 'review-2:3' }],
    });
  });
});

function makeDetails(overrides: Partial<ScoutFileChangeDetails> = {}): ScoutFileChangeDetails {
  return {
    kind: 'file_change',
    path: '/workspace/src/app.ts',
    displayPath: 'src/app.ts',
    additions: 1,
    deletions: 1,
    review: { turnId: 'turn-1', recordId: 'review-2' },
    ...overrides,
  };
}

function makeRuntimeReview(): FileReviewTurnSnapshot {
  return {
    turnId: 'turn-1',
    records: [],
    files: [
      {
        absolutePath: '/workspace/src/app.ts',
        path: 'src/app.ts',
        displayPath: 'src/app.ts',
        originalContent: ['const keep = 1;', 'const value = 1;', 'export { value };'].join('\n'),
        modifiedContent: ['const keep = 1;', 'const value = 2;', 'export { value };'].join('\n'),
        recordIds: ['review-1', 'review-2'],
        latestRecordId: 'review-2',
        latestSequence: 2,
        additions: 1,
        deletions: 1,
      },
    ],
  };
}

function makeArtifact(
  overrides: Partial<FileReviewArtifact['files'][number]> = {},
): FileReviewArtifact {
  return {
    version: 1,
    sessionId: 'session-1',
    turnId: 'turn-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    records: [],
    files: [
      {
        absolutePath: '/workspace/src/app.ts',
        path: 'src/app.ts',
        displayPath: 'src/app.ts',
        recordIds: ['review-1', 'review-2'],
        latestRecordId: 'review-2',
        latestSequence: 2,
        additions: 1,
        deletions: 1,
        rows: [
          {
            type: 'removed',
            oldLineNumber: 2,
            text: 'const value = 1;',
            tokens: [{ text: '1', syntaxScopes: ['hljs-number'] }],
          },
          {
            type: 'added',
            newLineNumber: 2,
            text: 'const value = 2;',
            tokens: [{ text: '2', syntaxScopes: ['hljs-number'] }],
          },
        ],
        ...overrides,
      },
    ],
  };
}
