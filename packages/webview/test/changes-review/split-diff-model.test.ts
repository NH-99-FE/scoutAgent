import { describe, expect, it } from 'vitest';
import {
  createSplitDiffModel,
  projectSplitDiffRows,
} from '@/surfaces/changes-review/split-diff-model';
import type { ScoutChangesReviewRow } from '@scout-agent/shared';

describe('split-diff-model', () => {
  it('projects paired changed rows into opposite columns', () => {
    const model = projectSplitDiffRows([
      { type: 'removed', oldLineNumber: 10, text: 'const value = 1;' },
      { type: 'added', newLineNumber: 10, text: 'const value = 2;' },
    ]);

    expect(model.removed.cells).toMatchObject([
      { kind: 'line', lineType: 'removed', row: { oldLineNumber: 10 } },
    ]);
    expect(model.added.cells).toMatchObject([
      { kind: 'line', lineType: 'added', row: { newLineNumber: 10 } },
    ]);
  });

  it('uses a removed-column buffer for added-only runs', () => {
    const model = projectSplitDiffRows([
      { type: 'added', newLineNumber: 3, text: 'one' },
      { type: 'added', newLineNumber: 4, text: 'two' },
    ]);

    expect(model.removed.cells).toMatchObject([{ kind: 'buffer', rowCount: 2 }]);
    expect(model.added.cells).toMatchObject([
      { kind: 'line', lineType: 'added', row: { newLineNumber: 3 } },
      { kind: 'line', lineType: 'added', row: { newLineNumber: 4 } },
    ]);
  });

  it('uses a trailing buffer when a changed run has more rows on one side', () => {
    const rows: ScoutChangesReviewRow[] = [
      { type: 'removed', oldLineNumber: 8, text: 'old' },
      { type: 'added', newLineNumber: 8, text: 'new one' },
      { type: 'added', newLineNumber: 9, text: 'new two' },
      { type: 'added', newLineNumber: 10, text: 'new three' },
    ];

    const model = projectSplitDiffRows(rows);

    expect(model.removed.cells).toMatchObject([
      { kind: 'line', lineType: 'removed', row: { oldLineNumber: 8 } },
      { kind: 'buffer', rowCount: 2 },
    ]);
    expect(model.added.cells).toHaveLength(3);
  });

  it('mirrors fold separators into both split columns', () => {
    const model = projectSplitDiffRows([{ type: 'fold', count: 42 }]);

    expect(model.removed.cells).toMatchObject([{ kind: 'fold', row: { count: 42 } }]);
    expect(model.added.cells).toMatchObject([{ kind: 'fold', row: { count: 42 } }]);
  });

  it('expands fold context symmetrically before projecting split columns', () => {
    const rows: ScoutChangesReviewRow[] = [
      {
        type: 'fold',
        count: 4,
        hiddenRows: [
          { type: 'context', oldLineNumber: 1, newLineNumber: 1, text: 'one' },
          { type: 'context', oldLineNumber: 2, newLineNumber: 2, text: 'two' },
          { type: 'context', oldLineNumber: 3, newLineNumber: 3, text: 'three' },
          { type: 'context', oldLineNumber: 4, newLineNumber: 4, text: 'four' },
        ],
      },
    ];

    const model = createSplitDiffModel(rows, {
      foldRevealCounts: { 'file-1:fold:0': 2 },
      rowScopeId: 'file-1',
    });

    expect(model.removed.cells).toMatchObject([
      { kind: 'line', lineType: 'context', row: { text: 'one' } },
      { kind: 'fold', row: { count: 2, foldId: 'file-1:fold:0', foldTotal: 4 } },
      { kind: 'line', lineType: 'context', row: { text: 'four' } },
    ]);
    expect(model.added.cells).toMatchObject([
      { kind: 'line', lineType: 'context', row: { text: 'one' } },
      { kind: 'fold', row: { count: 2, foldId: 'file-1:fold:0', foldTotal: 4 } },
      { kind: 'line', lineType: 'context', row: { text: 'four' } },
    ]);
  });
});
