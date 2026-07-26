import { describe, expect, it } from 'vitest';
import type { ScoutChangesReviewSummary } from '@scout-agent/shared';
import { createComposerChangesReviewSummary } from '@/features/composer/model/composer-changes-review-summary';

function makeReview(files: ScoutChangesReviewSummary['files']): ScoutChangesReviewSummary {
  return {
    turnId: 'turn-1',
    fileCount: files.length,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    files,
  };
}

describe('createComposerChangesReviewSummary', () => {
  it('returns no tray summary before actual file changes are projected', () => {
    expect(createComposerChangesReviewSummary(undefined)).toBeUndefined();
  });

  it('summarizes only the landed changes review', () => {
    const review = makeReview([
      { path: '/workspace/src/app.ts', additions: 19, deletions: 19 },
      { path: '/workspace/src/other.ts', additions: 8, deletions: 4 },
    ]);

    expect(createComposerChangesReviewSummary(review)).toEqual({
      fileCount: 2,
      additions: 27,
      deletions: 23,
    });
  });
});
