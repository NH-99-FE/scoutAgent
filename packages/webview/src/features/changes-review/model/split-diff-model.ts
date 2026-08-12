// ============================================================
// Changes Review Feature — Split diff 投影模型
// ============================================================

import type { ScoutChangesReviewRow } from '@scout-agent/shared';

export type SplitDiffSide = 'removed' | 'added';
export type SplitDiffLineType = 'context' | 'removed' | 'added';

export type SplitDiffSourceRow = ScoutChangesReviewRow & {
  foldId?: string;
  foldTotal?: number;
};

export interface SplitDiffLineCell {
  kind: 'line';
  key: string;
  lineType: SplitDiffLineType;
  row: SplitDiffSourceRow;
  rowCount: 1;
}

export interface SplitDiffBufferCell {
  kind: 'buffer';
  key: string;
  rowCount: number;
}

export interface SplitDiffFoldCell {
  kind: 'fold';
  key: string;
  row: SplitDiffSourceRow;
  rowCount: 1;
}

export type SplitDiffCell = SplitDiffLineCell | SplitDiffBufferCell | SplitDiffFoldCell;

export interface SplitDiffColumn {
  cells: SplitDiffCell[];
  side: SplitDiffSide;
}

export interface SplitDiffModel {
  added: SplitDiffColumn;
  removed: SplitDiffColumn;
}

export function createSplitDiffModel(rows: readonly ScoutChangesReviewRow[]): SplitDiffModel {
  return projectSplitDiffRows(rows);
}

export function projectSplitDiffRows(rows: readonly SplitDiffSourceRow[]): SplitDiffModel {
  const removed: SplitDiffCell[] = [];
  const added: SplitDiffCell[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];

    if (isChangedRow(row)) {
      const runStart = index;
      const removedRows: SplitDiffSourceRow[] = [];
      const addedRows: SplitDiffSourceRow[] = [];

      while (index < rows.length && isChangedRow(rows[index])) {
        const changedRow = rows[index];
        if (changedRow.type === 'removed') removedRows.push(changedRow);
        else addedRows.push(changedRow);
        index += 1;
      }
      index -= 1;

      appendChangedRun(removed, added, runStart, removedRows, addedRows);
      continue;
    }

    if (row.type === 'fold') {
      removed.push(createFoldCell(row, `fold:${index}:removed`));
      added.push(createFoldCell(row, `fold:${index}:added`));
      continue;
    }

    removed.push(createLineCell(row, 'context', `context:${index}:removed`));
    added.push(createLineCell(row, 'context', `context:${index}:added`));
  }

  return {
    added: { cells: added, side: 'added' },
    removed: { cells: removed, side: 'removed' },
  };
}

function appendChangedRun(
  removedCells: SplitDiffCell[],
  addedCells: SplitDiffCell[],
  runStart: number,
  removedRows: readonly SplitDiffSourceRow[],
  addedRows: readonly SplitDiffSourceRow[],
): void {
  removedRows.forEach((row, index) => {
    removedCells.push(createLineCell(row, 'removed', `change:${runStart}:removed:${index}`));
  });
  if (addedRows.length > removedRows.length) {
    removedCells.push(
      createBufferCell(addedRows.length - removedRows.length, `change:${runStart}:removed-buffer`),
    );
  }

  addedRows.forEach((row, index) => {
    addedCells.push(createLineCell(row, 'added', `change:${runStart}:added:${index}`));
  });
  if (removedRows.length > addedRows.length) {
    addedCells.push(
      createBufferCell(removedRows.length - addedRows.length, `change:${runStart}:added-buffer`),
    );
  }
}

function createLineCell(
  row: SplitDiffSourceRow,
  lineType: SplitDiffLineType,
  key: string,
): SplitDiffLineCell {
  return { kind: 'line', key, lineType, row, rowCount: 1 };
}

function createBufferCell(rowCount: number, key: string): SplitDiffBufferCell {
  return { kind: 'buffer', key, rowCount };
}

function createFoldCell(row: SplitDiffSourceRow, key: string): SplitDiffFoldCell {
  return { kind: 'fold', key, row, rowCount: 1 };
}

function isChangedRow(row: SplitDiffSourceRow): boolean {
  return row.type === 'added' || row.type === 'removed';
}
