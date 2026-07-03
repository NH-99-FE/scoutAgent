import { describe, expect, it } from 'vitest';
import {
  computeReviewDiff,
  decodeReviewContent,
  FileReviewStore,
  isFileReviewPayload,
} from '../../src/core/review/file-review.ts';
import { MAX_REVIEW_TEXT_BYTES } from '../../src/core/text-size.ts';
import { createReviewLineTokens } from '../../src/core/review/review-syntax-tokens.ts';

describe('FileReviewStore', () => {
  it('merges same-turn edits by path using first original and final modified content', () => {
    const store = new FileReviewStore();

    const first = store.addRecord('turn-1', 'tool-1', {
      kind: 'file_review_payload',
      operation: 'edit',
      path: 'src/app.ts',
      absolutePath: '/workspace/src/app.ts',
      originalContent: 'old\nkeep\n',
      modifiedContent: 'mid\nkeep\n',
    });
    const second = store.addRecord('turn-1', 'tool-2', {
      kind: 'file_review_payload',
      operation: 'edit',
      path: 'src/app.ts',
      absolutePath: '/workspace/src/app.ts',
      originalContent: 'mid\nkeep\n',
      modifiedContent: 'final\nkeep\n',
    });

    const turn = store.getTurn('turn-1');

    expect(first.review.recordId).toBe('review-1');
    expect(second.review.recordId).toBe('review-2');
    expect(turn?.files).toHaveLength(1);
    expect(turn?.files[0]).toMatchObject({
      path: 'src/app.ts',
      originalContent: 'old\nkeep\n',
      modifiedContent: 'final\nkeep\n',
      latestRecordId: 'review-2',
      recordIds: ['review-1', 'review-2'],
      additions: 1,
      deletions: 1,
    });
    expect(turn?.records[0]).not.toHaveProperty('originalContent');
    expect(turn?.records[0]).not.toHaveProperty('modifiedContent');
    expect(turn?.records[1]).not.toHaveProperty('originalContent');
    expect(turn?.records[1]).not.toHaveProperty('modifiedContent');
  });

  it('returns locatable file_change details with separate display path', () => {
    const store = new FileReviewStore();

    const details = store.addRecord('turn-1', 'tool-1', {
      kind: 'file_review_payload',
      operation: 'edit',
      path: '../workspace/src/app.ts',
      absolutePath: '/workspace/src/app.ts',
      displayPath: 'src/app.ts',
      originalContent: 'old\n',
      modifiedContent: 'new\n',
    });

    expect(details).toMatchObject({
      kind: 'file_change',
      path: '/workspace/src/app.ts',
      displayPath: 'src/app.ts',
      additions: 1,
      deletions: 1,
    });
    expect(store.getTurn('turn-1')?.files[0]).toMatchObject({
      path: '../workspace/src/app.ts',
      absolutePath: '/workspace/src/app.ts',
      displayPath: 'src/app.ts',
    });
  });

  it('sorts files by latest touch and keeps different turns separated', () => {
    const store = new FileReviewStore();

    store.addRecord('turn-1', 'tool-1', {
      kind: 'file_review_payload',
      operation: 'write',
      path: 'a.txt',
      absolutePath: '/workspace/a.txt',
      originalContent: null,
      modifiedContent: 'a\n',
    });
    store.addRecord('turn-1', 'tool-2', {
      kind: 'file_review_payload',
      operation: 'write',
      path: 'b.txt',
      absolutePath: '/workspace/b.txt',
      originalContent: null,
      modifiedContent: 'b\n',
    });
    store.addRecord('turn-1', 'tool-3', {
      kind: 'file_review_payload',
      operation: 'edit',
      path: 'a.txt',
      absolutePath: '/workspace/a.txt',
      originalContent: 'a\n',
      modifiedContent: 'a2\n',
    });
    store.addRecord('turn-2', 'tool-4', {
      kind: 'file_review_payload',
      operation: 'write',
      path: 'a.txt',
      absolutePath: '/workspace/a.txt',
      originalContent: 'a2\n',
      modifiedContent: 'a3\n',
    });

    expect(store.getTurn('turn-1')?.files.map((file) => file.path)).toEqual(['a.txt', 'b.txt']);
    expect(store.getTurn('turn-1')?.records.map((record) => record.recordId)).toEqual([
      'review-1',
      'review-2',
      'review-3',
    ]);
    expect(store.getTurn('turn-2')?.records.map((record) => record.recordId)).toEqual(['review-4']);
  });

  it('drops retained contents once an aggregate diff is too large to review', () => {
    const store = new FileReviewStore();
    const large = `${'x'.repeat(MAX_REVIEW_TEXT_BYTES + 1)}\n`;

    const details = store.addRecord('turn-1', 'tool-1', {
      kind: 'file_review_payload',
      operation: 'write',
      path: 'file.txt',
      absolutePath: '/workspace/file.txt',
      originalContent: 'old\n',
      modifiedContent: large,
    });

    const file = store.getTurn('turn-1')?.files[0];
    expect(details.review).toEqual({ turnId: 'turn-1', recordId: 'review-1' });
    expect(file).toMatchObject({
      originalContent: null,
      modifiedContent: null,
      additions: 1,
      deletions: 1,
      unavailableReason: 'Diff too large to review',
    });
  });

  it('recovers aggregate reviewability when only an intermediate record is unavailable', () => {
    const store = new FileReviewStore();

    store.addRecord('turn-1', 'tool-1', {
      kind: 'file_review_payload',
      operation: 'edit',
      path: 'src/app.ts',
      absolutePath: '/workspace/src/app.ts',
      originalContent: 'old\n',
      modifiedContent: 'mid\n',
    });
    store.addRecord('turn-1', 'tool-2', {
      kind: 'file_review_payload',
      operation: 'write',
      path: 'src/app.ts',
      absolutePath: '/workspace/src/app.ts',
      originalContent: null,
      modifiedContent: null,
      unavailableReason: 'Original content unavailable',
    });
    store.addRecord('turn-1', 'tool-3', {
      kind: 'file_review_payload',
      operation: 'edit',
      path: 'src/app.ts',
      absolutePath: '/workspace/src/app.ts',
      originalContent: 'unknown-intermediate\n',
      modifiedContent: 'final\n',
    });

    const turn = store.getTurn('turn-1');
    expect(turn?.records[1]).toMatchObject({
      recordId: 'review-2',
      unavailableReason: 'Original content unavailable',
    });
    expect(turn?.files[0]).toMatchObject({
      originalContent: 'old\n',
      modifiedContent: 'final\n',
      additions: 1,
      deletions: 1,
      unavailableReason: undefined,
    });
  });

  it('keeps the aggregate review unavailable when the original endpoint is unavailable', () => {
    const store = new FileReviewStore();

    store.addRecord('turn-1', 'tool-1', {
      kind: 'file_review_payload',
      operation: 'write',
      path: 'src/app.ts',
      absolutePath: '/workspace/src/app.ts',
      originalContent: null,
      modifiedContent: null,
      unavailableReason: 'Original content unavailable',
    });
    store.addRecord('turn-1', 'tool-2', {
      kind: 'file_review_payload',
      operation: 'edit',
      path: 'src/app.ts',
      absolutePath: '/workspace/src/app.ts',
      originalContent: 'intermediate\n',
      modifiedContent: 'final\n',
    });

    expect(store.getTurn('turn-1')?.files[0]).toMatchObject({
      originalContent: null,
      modifiedContent: 'final\n',
      additions: 0,
      deletions: 0,
      unavailableReason: 'Original content unavailable',
    });
  });

  it('releases retained contents while keeping lightweight review metadata', () => {
    const store = new FileReviewStore();

    store.addRecord('turn-1', 'tool-1', {
      kind: 'file_review_payload',
      operation: 'edit',
      path: 'src/app.ts',
      absolutePath: '/workspace/src/app.ts',
      originalContent: 'old\n',
      modifiedContent: 'new\n',
    });

    expect(store.releaseTurnContent('turn-1')).toBe(true);

    const turn = store.getTurn('turn-1');
    expect(turn?.contentReleased).toBe(true);
    expect(turn?.records).toEqual([
      expect.objectContaining({ recordId: 'review-1', toolCallId: 'tool-1' }),
    ]);
    expect(turn?.files[0]).toMatchObject({
      path: 'src/app.ts',
      originalContent: null,
      modifiedContent: null,
      additions: 1,
      deletions: 1,
    });
  });

  it('prunes old released turns beyond the retention limit', () => {
    const store = new FileReviewStore();

    for (const turnId of ['turn-1', 'turn-2']) {
      store.addRecord(turnId, `tool-${turnId}`, {
        kind: 'file_review_payload',
        operation: 'write',
        path: `${turnId}.txt`,
        absolutePath: `/workspace/${turnId}.txt`,
        originalContent: null,
        modifiedContent: `${turnId}\n`,
      });
      store.releaseTurnContent(turnId, { maxReleasedTurns: 1 });
    }

    expect(store.getTurn('turn-1')).toBeUndefined();
    expect(store.getTurn('turn-2')).toBeDefined();
  });
});

describe('isFileReviewPayload', () => {
  it('accepts only complete internal review payloads', () => {
    expect(
      isFileReviewPayload({
        kind: 'file_review_payload',
        operation: 'edit',
        path: 'src/app.ts',
        absolutePath: '/workspace/src/app.ts',
        originalContent: 'old\n',
        modifiedContent: 'new\n',
      }),
    ).toBe(true);

    expect(isFileReviewPayload({ kind: 'file_review_payload' })).toBe(false);
    expect(
      isFileReviewPayload({
        kind: 'file_review_payload',
        operation: 'remove',
        path: 'src/app.ts',
        absolutePath: '/workspace/src/app.ts',
        originalContent: 'old\n',
        modifiedContent: 'new\n',
      }),
    ).toBe(false);
    expect(
      isFileReviewPayload({
        kind: 'file_review_payload',
        operation: 'edit',
        path: 'src/app.ts',
        absolutePath: '/workspace/src/app.ts',
        originalContent: undefined,
        modifiedContent: 'new\n',
      }),
    ).toBe(false);
  });
});

describe('computeReviewDiff', () => {
  it('computes line-level additions, deletions, replacements, and folded context', () => {
    const original = Array.from({ length: 10 }, (_, index) => `line-${index + 1}`).join('\n');
    const modified = original.replace('line-6', 'changed-6');

    const diff = computeReviewDiff(`${original}\n`, `${modified}\n`, {
      collapseContext: true,
      contextLines: 3,
    });

    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(1);
    expect(diff.firstChangedLine).toBe(6);
    expect(diff.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'fold',
          count: 2,
          oldStartLine: 1,
          newStartLine: 1,
        }),
        expect.objectContaining({
          type: 'fold',
          count: 1,
          oldStartLine: 10,
          newStartLine: 10,
        }),
      ]),
    );
  });

  it('handles new files and deleted lines', () => {
    expect(computeReviewDiff(null, 'one\ntwo\n')).toMatchObject({
      additions: 2,
      deletions: 0,
    });
    expect(computeReviewDiff('one\ntwo\n', 'one\n')).toMatchObject({
      additions: 0,
      deletions: 1,
    });
  });

  it('adds syntax tokens and intraline diff ranges when a file path is provided', () => {
    const diff = computeReviewDiff('const value = 1;\n', 'const value = 2;\n', {
      filePath: 'src/app.ts',
    });

    const removed = diff.rows.find((row) => row.type === 'removed');
    const added = diff.rows.find((row) => row.type === 'added');

    expect(removed?.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'const',
          syntaxScopes: expect.arrayContaining(['hljs-keyword']),
        }),
        expect.objectContaining({
          text: '1',
          diff: 'removed',
          syntaxScopes: expect.arrayContaining(['hljs-number']),
        }),
      ]),
    );
    expect(added?.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: '2',
          diff: 'added',
          syntaxScopes: expect.arrayContaining(['hljs-number']),
        }),
      ]),
    );
  });

  it('normalizes CRLF line endings before building display rows and tokens', () => {
    const diff = computeReviewDiff('const value = 1;\r\nkeep\r\n', 'const value = 2;\r\nkeep\r\n', {
      filePath: 'src/app.ts',
    });

    expect(diff.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'removed', text: 'const value = 1;' }),
        expect.objectContaining({ type: 'added', text: 'const value = 2;' }),
        expect.objectContaining({ type: 'context', text: 'keep' }),
      ]),
    );
    expect(JSON.stringify(diff.rows)).not.toContain('\\r');
  });

  it('returns no display rows when the normalized contents did not change', () => {
    const diff = computeReviewDiff('same\r\ntext\r\n', 'same\ntext\n');

    expect(diff.rows).toEqual([]);
    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(0);
    expect(diff.firstChangedLine).toBeUndefined();
  });

  it('returns no display rows for large exact no-op contents before applying diff limits', () => {
    const large = `${'x'.repeat(MAX_REVIEW_TEXT_BYTES + 1)}\n`;
    const diff = computeReviewDiff(large, large, {
      filePath: 'src/app.ts',
    });

    expect(diff).toMatchObject({
      rows: [],
      additions: 0,
      deletions: 0,
    });
    expect(diff.unavailableReason).toBeUndefined();
  });

  it('marks large normalized-only no-op contents unavailable before normalized comparison', () => {
    const large = `${'x'.repeat(MAX_REVIEW_TEXT_BYTES + 1)}\r\n`;

    expect(computeReviewDiff(large, large.replace(/\r\n/g, '\n'))).toMatchObject({
      rows: [],
      additions: 1,
      deletions: 1,
      unavailableReason: 'Diff too large to review',
    });
  });

  it('marks large text diffs unavailable without rendering rows', () => {
    const large = `${'x'.repeat(MAX_REVIEW_TEXT_BYTES + 1)}\n`;

    expect(computeReviewDiff('', large)).toMatchObject({
      rows: [],
      additions: 1,
      deletions: 0,
      unavailableReason: 'Diff too large to review',
    });
  });
});

describe('createReviewLineTokens', () => {
  it('normalizes CRLF line endings before tokenizing rows', () => {
    const tokens = createReviewLineTokens('alpha\r\nbeta\r\n');

    expect(tokens).toEqual([[{ text: 'alpha' }], [{ text: 'beta' }]]);
    expect(JSON.stringify(tokens)).not.toContain('\\r');
  });
});

describe('decodeReviewContent', () => {
  it('rejects binary and unsupported UTF-8 content', () => {
    expect(decodeReviewContent(Buffer.from([0x00]))).toMatchObject({
      content: null,
      unavailableReason: 'Binary or unsupported encoding',
    });
    expect(decodeReviewContent(Buffer.from([0xff]))).toMatchObject({
      content: null,
      unavailableReason: 'Binary or unsupported encoding',
    });
  });
});
