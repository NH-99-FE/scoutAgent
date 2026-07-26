import { diffLines } from 'diff';
import { describe, expect, it, vi } from 'vitest';

vi.mock('diff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('diff')>();
  return { ...actual, diffLines: vi.fn(actual.diffLines) };
});
import {
  DIFF_DOCUMENT_VERSION,
  REVIEW_CONTEXT_LINES,
  MutationJournal,
  addReviewRowTokens,
  captureStringSnapshot,
  createDiffDocument,
  projectDiffDocumentRows,
  projectDiffDocumentSummary,
  runDiffWorkerRequest,
  type DiffWorkerClientPort,
} from '../../src/core/review/index.ts';
import { DiffDocumentProjector } from '../../src/host/review/diff-document-projector.ts';
import { createFileReviewArtifact } from '../../src/host/review/file-review-artifact.ts';
import { createRuntimeChangesReviewSummary } from '../../src/host/review/changes-review-summary-projector.ts';

function makeMutationJournal(): MutationJournal {
  const client: DiffWorkerClientPort = {
    request: (request, listener) => listener(runDiffWorkerRequest(request)),
    dispose: () => undefined,
  };
  return new MutationJournal({ diffWorkerClient: client });
}

describe('DiffDocument', () => {
  it('creates a canonical edit document with fingerprints and statistics', () => {
    const document = createDiffDocument('alpha\nbeta\ngamma\n', 'alpha\nchanged\ngamma\n');

    expect(document).toMatchObject({
      version: DIFF_DOCUMENT_VERSION,
      beforeLineCount: 3,
      afterLineCount: 3,
      additions: 1,
      deletions: 1,
      firstChangedLine: 2,
      hunks: [
        {
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 3,
          lines: [
            { type: 'context', text: 'alpha' },
            { type: 'removed', text: 'beta' },
            { type: 'added', text: 'changed' },
            { type: 'context', text: 'gamma' },
          ],
        },
      ],
    });
    expect(document.beforeFingerprint).toMatchObject({ size: 17, sha256: expect.any(String) });
    expect(document.afterFingerprint).toMatchObject({ size: 20, sha256: expect.any(String) });
    expect(document.hunks.flatMap((hunk) => hunk.lines).every((line) => !('tokens' in line))).toBe(
      true,
    );
  });

  it('represents created and deleted files without synthetic content state', () => {
    const created = createDiffDocument(null, 'one\ntwo\n');
    const deleted = createDiffDocument('one\ntwo\n', null);

    expect(created).toMatchObject({
      beforeFingerprint: undefined,
      beforeLineCount: 0,
      afterLineCount: 2,
      additions: 2,
      deletions: 0,
      firstChangedLine: 1,
      hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 2 }],
    });
    expect(deleted).toMatchObject({
      afterFingerprint: undefined,
      beforeLineCount: 2,
      afterLineCount: 0,
      additions: 0,
      deletions: 2,
      firstChangedLine: 1,
      hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 0 }],
    });
  });

  it('normalizes CRLF before line diff while fingerprinting original bytes', () => {
    const document = createDiffDocument('one\r\ntwo\r\n', 'one\r\nchanged\r\n');
    const normalizedOnly = createDiffDocument('same\r\ntext\r\n', 'same\ntext\n');

    expect(document).toMatchObject({ additions: 1, deletions: 1, firstChangedLine: 2 });
    expect(JSON.stringify(document.hunks)).not.toContain('\\r');
    expect(normalizedOnly).toMatchObject({ additions: 0, deletions: 0, hunks: [] });
    expect(normalizedOnly.beforeFingerprint).not.toEqual(normalizedOnly.afterFingerprint);
  });

  it('keeps only configured context in separate hunks and projects stable folds', () => {
    const before = Array.from({ length: 20 }, (_, index) => `line-${index + 1}`).join('\n');
    const after = before.replace('line-5', 'changed-5').replace('line-15', 'changed-15');
    const document = createDiffDocument(before, after);
    const rows = projectDiffDocumentRows(document);

    expect(REVIEW_CONTEXT_LINES).toBe(3);
    expect(document.hunks).toHaveLength(2);
    expect(document.hunks).toEqual([
      expect.objectContaining({ oldStart: 2, oldLines: 7, newStart: 2, newLines: 7 }),
      expect.objectContaining({ oldStart: 12, oldLines: 7, newStart: 12, newLines: 7 }),
    ]);
    expect(rows.filter((row) => row.type === 'fold')).toEqual([
      { type: 'fold', count: 1, oldStartLine: 1, newStartLine: 1 },
      { type: 'fold', count: 3, oldStartLine: 9, newStartLine: 9 },
      { type: 'fold', count: 2, oldStartLine: 19, newStartLine: 19 },
    ]);
  });

  it('does not execute line diff again across runtime projections', () => {
    const lineDiff = vi.mocked(diffLines);
    lineDiff.mockClear();
    const journal = makeMutationJournal();
    journal.append({
      ownerId: 'session-1',
      turnId: 'turn-1',
      toolCallId: 'tool-1',
      operation: 'edit',
      path: 'src/app.ts',
      absolutePath: '/workspace/src/app.ts',
      before: captureStringSnapshot('const value = 1;\nkeep\n'),
      after: captureStringSnapshot('const value = 2;\nkeep\n'),
      toolOutcome: 'success',
    });
    const review = journal.toReviewTurnSnapshot('turn-1');
    expect(review).toBeDefined();
    const document = review?.files[0]?.document;
    expect(document).toBeDefined();
    expect(lineDiff).toHaveBeenCalledTimes(1);

    expect(projectDiffDocumentSummary(document!)).toMatchObject({
      additions: 1,
      deletions: 1,
      firstChangedLine: 1,
    });
    const inlineRows = projectDiffDocumentRows(document!);
    const panelRows = addReviewRowTokens(projectDiffDocumentRows(document!), 'src/app.ts');
    const lazyView = new DiffDocumentProjector().project(document!, 'src/app.ts', {
      mode: 'unified',
      maxRows: 40,
      hunkOffset: 0,
      hunkLimit: 8,
      includeTokens: false,
    });
    const summary = createRuntimeChangesReviewSummary(review!);
    const artifact = createFileReviewArtifact('session-1', review!, {
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(inlineRows.some((row) => row.tokens !== undefined)).toBe(false);
    expect(panelRows.some((row) => row.tokens?.length)).toBe(true);
    expect(lazyView.rows).toEqual(inlineRows);
    expect(summary).toMatchObject({ additions: 1, deletions: 1 });
    expect(artifact.files[0]?.document).toEqual(document);
    expect(JSON.stringify(artifact)).not.toContain('"tokens"');
    expect(lineDiff).toHaveBeenCalledTimes(1);
  });
});
