import { describe, expect, it } from 'vitest';
import { createDiffDocument } from '../../../src/core/review/diff-document.ts';
import type { FileReviewTurnSnapshot } from '../../../src/core/review/file-review.ts';
import {
  createArtifactChangesReviewSummary,
  createRuntimeChangesReviewSummary,
} from '../../../src/host/review/changes-review-summary-projector.ts';
import type { FileReviewArtifact } from '../../../src/host/review/file-review-artifact.ts';

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

describe('createArtifactChangesReviewSummary', () => {
  it('projects persisted artifact files without carrying row previews into the summary', () => {
    const artifact: FileReviewArtifact = {
      version: 2,
      sessionId: 'session-1',
      turnId: 'turn-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      records: ['test.c', 'test.py', 'Test.java', 'test.js'].map((_path, index) => ({
        recordId: `review-${index + 1}`,
        toolCallId: `tool-${index + 1}`,
        operation: 'edit',
        fileId: `file-${index + 1}`,
        sequence: index + 1,
        toolOutcome: 'success',
      })),
      files: ['test.c', 'test.py', 'Test.java', 'test.js'].map((path, index) => ({
        fileId: `file-${index + 1}`,
        absolutePath: `/workspace/${path}`,
        path,
        displayPath: path,
        recordIds: [`review-${index + 1}`],
        latestRevision: 1,
        document: {
          ...createDiffDocument(`old ${path}\n`, `new ${path}\n`),
          additions: index + 1,
        },
      })),
    };

    expect(createArtifactChangesReviewSummary(artifact)).toEqual({
      turnId: 'turn-1',
      fileCount: 4,
      additions: 10,
      deletions: 4,
      files: [
        { path: '/workspace/test.js', displayPath: 'test.js', additions: 4, deletions: 1 },
        { path: '/workspace/Test.java', displayPath: 'Test.java', additions: 3, deletions: 1 },
        { path: '/workspace/test.py', displayPath: 'test.py', additions: 2, deletions: 1 },
        { path: '/workspace/test.c', displayPath: 'test.c', additions: 1, deletions: 1 },
      ],
    });
  });
});
