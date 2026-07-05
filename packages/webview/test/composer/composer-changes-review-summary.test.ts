import { describe, expect, it } from 'vitest';
import type { ScoutChangesReviewSummary, ScoutFileEditPreview } from '@scout-agent/shared';
import { createComposerChangesReviewSummary } from '@/features/composer/composer-changes-review-summary';

function makeReview(
  files: ScoutChangesReviewSummary['files'],
  overrides: Partial<ScoutChangesReviewSummary> = {},
): ScoutChangesReviewSummary {
  return {
    turnId: 'turn-1',
    fileCount: files.length,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    files,
    ...overrides,
  };
}

function makePreview(
  path: string,
  additions: number,
  deletions: number,
  overrides: Partial<ScoutFileEditPreview> = {},
) {
  return {
    preview: {
      kind: 'file_edit' as const,
      path,
      additions,
      deletions,
      ...overrides,
    },
  };
}

describe('createComposerChangesReviewSummary', () => {
  it('summarizes preview files before the settled review exists', () => {
    expect(
      createComposerChangesReviewSummary(undefined, {
        'tool-1': makePreview('/workspace/src/app.ts', 10, 4),
      }),
    ).toEqual({
      fileCount: 1,
      additions: 10,
      deletions: 4,
      hasPreview: true,
      hasReview: false,
    });
  });

  it('keeps an existing settled review when no preview files contribute', () => {
    const review = makeReview([{ path: '/workspace/src/app.ts', additions: 2, deletions: 1 }]);

    expect(createComposerChangesReviewSummary(review, {})).toEqual({
      fileCount: 1,
      additions: 2,
      deletions: 1,
      hasPreview: false,
      hasReview: true,
    });
  });

  it('uses path rather than displayPath when skipping previews already present in review', () => {
    const review = makeReview([
      {
        path: '/workspace/src/app.ts',
        displayPath: 'src/app.ts',
        additions: 2,
        deletions: 1,
      },
    ]);

    expect(
      createComposerChangesReviewSummary(review, {
        'tool-1': makePreview('/workspace/src/app.ts', 99, 88, {
          displayPath: 'different-display.ts',
        }),
      }),
    ).toEqual({
      fileCount: 1,
      additions: 2,
      deletions: 1,
      hasPreview: false,
      hasReview: true,
    });
  });

  it('does not merge different business paths that share a display path', () => {
    const review = makeReview([
      {
        path: '/workspace/src/app.ts',
        displayPath: 'app.ts',
        additions: 2,
        deletions: 1,
      },
    ]);

    expect(
      createComposerChangesReviewSummary(review, {
        'tool-1': makePreview('/external/src/app.ts', 5, 3, { displayPath: 'app.ts' }),
      }),
    ).toEqual({
      fileCount: 2,
      additions: 7,
      deletions: 4,
      hasPreview: true,
      hasReview: true,
    });
  });

  it('merges settled review files with new preview files', () => {
    const review = makeReview([{ path: '/workspace/src/app.ts', additions: 19, deletions: 19 }]);

    expect(
      createComposerChangesReviewSummary(review, {
        'tool-2': makePreview('/workspace/src/other.ts', 8, 4),
      }),
    ).toEqual({
      fileCount: 2,
      additions: 27,
      deletions: 23,
      hasPreview: true,
      hasReview: true,
    });
  });

  it('ignores preview errors', () => {
    expect(
      createComposerChangesReviewSummary(undefined, {
        'tool-1': makePreview('/workspace/src/app.ts', 0, 0, { error: 'not found' }),
      }),
    ).toBeUndefined();
  });
});
