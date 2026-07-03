import { describe, expect, it } from 'vitest';
import type { FileReviewTurnSnapshot } from '../../../src/core/review/file-review.ts';
import { createRuntimeChangesReviewSummary } from '../../../src/host/review/changes-review-summary-projector.ts';

describe('createRuntimeChangesReviewSummary', () => {
  it('projects locatable review files with display paths and stable latest-first order', () => {
    const review: FileReviewTurnSnapshot = {
      turnId: 'turn-1',
      records: [],
      files: [
        {
          absolutePath: '/workspace/src/newer.ts',
          path: 'src/newer.ts',
          displayPath: 'src/newer.ts',
          originalContent: 'old\n',
          modifiedContent: 'new\n',
          recordIds: ['review-2'],
          latestRecordId: 'review-2',
          latestSequence: 2,
          additions: 2,
          deletions: 1,
        },
        {
          absolutePath: '/workspace/src/older.ts',
          path: 'src/older.ts',
          originalContent: 'old\n',
          modifiedContent: 'new\n',
          recordIds: ['review-1'],
          latestRecordId: 'review-1',
          latestSequence: 1,
          additions: 1,
          deletions: 0,
        },
      ],
    };

    expect(createRuntimeChangesReviewSummary(review)).toEqual({
      turnId: 'turn-1',
      fileCount: 2,
      additions: 3,
      deletions: 1,
      files: [
        {
          path: '/workspace/src/newer.ts',
          displayPath: 'src/newer.ts',
          additions: 2,
          deletions: 1,
        },
        {
          path: '/workspace/src/older.ts',
          displayPath: 'src/older.ts',
          additions: 1,
          deletions: 0,
        },
      ],
    });
  });
});
