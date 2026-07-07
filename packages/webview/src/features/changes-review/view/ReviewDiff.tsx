// ============================================================
// Changes Review Feature — Diff 行渲染
// ============================================================

import { useLayoutEffect, useMemo, useState } from 'react';
import type { CSSProperties, UIEvent, WheelEvent } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type {
  ScoutChangesReviewFile,
  ScoutChangesReviewRow,
  ScoutChangesReviewToken,
  ScoutChangesReviewViewMode,
} from '@scout-agent/shared';
import { cn } from '@/lib/utils';
import {
  createSplitDiffModel,
  type SplitDiffCell,
  type SplitDiffColumn,
  type SplitDiffLineType,
  type SplitDiffSide,
  type SplitDiffSourceRow,
} from '../model/split-diff-model';

const UNIFIED_GRID_COLUMNS = 'grid-cols-[var(--changes-review-line-gutter)_minmax(0,1fr)]';
const SPLIT_COLUMN_GRID = 'grid-cols-[var(--changes-review-line-gutter)_minmax(0,1fr)]';
const SPLIT_EMPTY_SIDE_CLASS = 'scout-review-empty-split col-span-2';
const GUTTER_GAP_CLASS = 'border-r-[2px] border-r-tree-background';
const SPLIT_LINE_HEIGHT_CLASS =
  'min-h-[var(--changes-review-line-height)] leading-[var(--changes-review-line-height)]';

export function ReviewDiff({
  file,
  fileKey,
  foldRevealCounts,
  onExpandFold,
  viewMode,
}: {
  file: ScoutChangesReviewFile;
  fileKey: string;
  foldRevealCounts: Record<string, number>;
  onExpandFold: (id: string, total: number) => void;
  viewMode: ScoutChangesReviewViewMode;
}) {
  if (file.unavailableReason) {
    return (
      <div className="border-l-status-warning text-muted-foreground bg-status-warning-muted mx-2 mt-2 mb-2.5 border-l-[3px] px-2.5 py-2">
        {file.unavailableReason}
      </div>
    );
  }

  return (
    <>
      {file.statusNote ? (
        <div className="border-l-status-warning text-muted-foreground bg-status-warning-muted mx-2 mt-2 mb-2.5 border-l-[3px] px-2.5 py-2">
          {file.statusNote}
        </div>
      ) : null}
      <div
        className={cn(
          'scout-review-diff-scroll m-0 px-0 pt-0 pb-1 font-mono text-[length:var(--vscode-editor-font-size,14px)] leading-[1.42]',
          viewMode === 'split' ? 'overflow-x-hidden' : 'overflow-x-auto',
        )}
        data-review-diff-scroll={viewMode}
        onWheel={viewMode === 'split' ? undefined : handleReviewDiffWheel}
      >
        {file.rows.length ? (
          <ReviewRows
            foldRevealCounts={foldRevealCounts}
            onExpandFold={onExpandFold}
            rowScopeId={fileKey}
            rows={file.rows}
            viewMode={viewMode}
          />
        ) : (
          <div className="text-muted-foreground px-[22px] py-2.5">No changes</div>
        )}
      </div>
    </>
  );
}

function ReviewRows({
  foldRevealCounts,
  onExpandFold,
  rowScopeId,
  rows,
  viewMode,
}: {
  foldRevealCounts: Record<string, number>;
  onExpandFold: (id: string, total: number) => void;
  rowScopeId: string;
  rows: ScoutChangesReviewRow[];
  viewMode: ScoutChangesReviewViewMode;
}) {
  if (viewMode === 'split') {
    return (
      <ReviewSplitRows
        foldRevealCounts={foldRevealCounts}
        onExpandFold={onExpandFold}
        rowScopeId={rowScopeId}
        rows={rows}
      />
    );
  }

  return (
    <>
      {rows.map((row, index) => (
        <ReviewRow
          foldRevealCounts={foldRevealCounts}
          index={index}
          key={`${rowScopeId}:row:${index}`}
          onExpandFold={onExpandFold}
          row={row}
          rowScopeId={rowScopeId}
          viewMode={viewMode}
        />
      ))}
    </>
  );
}

function ReviewRow({
  foldRevealCounts,
  index,
  onExpandFold,
  row,
  rowScopeId,
  viewMode,
}: {
  foldRevealCounts: Record<string, number>;
  index: number;
  onExpandFold: (id: string, total: number) => void;
  row: ScoutChangesReviewRow;
  rowScopeId: string;
  viewMode: ScoutChangesReviewViewMode;
}) {
  if (row.type === 'fold') {
    return (
      <ReviewFold
        foldRevealCounts={foldRevealCounts}
        index={index}
        onExpandFold={onExpandFold}
        row={row}
        rowScopeId={rowScopeId}
        viewMode={viewMode}
      />
    );
  }
  return <ReviewDataRow row={row} />;
}

function ReviewFold({
  foldRevealCounts,
  index,
  onExpandFold,
  row,
  rowScopeId,
  viewMode,
}: {
  foldRevealCounts: Record<string, number>;
  index: number;
  onExpandFold: (id: string, total: number) => void;
  row: ScoutChangesReviewRow;
  rowScopeId: string;
  viewMode: ScoutChangesReviewViewMode;
}) {
  const hiddenRows = Array.isArray(row.hiddenRows) ? row.hiddenRows : [];
  const staticCount = Number(row.count || 0);
  if (!hiddenRows.length) {
    return <ReviewFoldBar label={renderFoldLabel(staticCount)} />;
  }

  const foldId = `${rowScopeId}:fold:${index}`;
  const total = hiddenRows.length;
  const revealed = Math.min(Number(foldRevealCounts[foldId] || 0), total);
  if (revealed >= total) {
    return (
      <ReviewRows
        foldRevealCounts={foldRevealCounts}
        onExpandFold={onExpandFold}
        rowScopeId={`${foldId}:all`}
        rows={hiddenRows}
        viewMode={viewMode}
      />
    );
  }

  const topCount = Math.ceil(revealed / 2);
  const bottomCount = revealed - topCount;
  const remaining = total - revealed;
  const beforeRows = hiddenRows.slice(0, topCount);
  const afterRows = bottomCount > 0 ? hiddenRows.slice(total - bottomCount) : [];

  return (
    <>
      <ReviewRows
        foldRevealCounts={foldRevealCounts}
        onExpandFold={onExpandFold}
        rowScopeId={`${foldId}:before`}
        rows={beforeRows}
        viewMode={viewMode}
      />
      <ReviewFoldBar
        label={renderFoldLabel(remaining)}
        onClick={() => onExpandFold(foldId, total)}
      />
      <ReviewRows
        foldRevealCounts={foldRevealCounts}
        onExpandFold={onExpandFold}
        rowScopeId={`${foldId}:after`}
        rows={afterRows}
        viewMode={viewMode}
      />
    </>
  );
}

function ReviewFoldBar({ label, onClick }: { label: string; onClick?: () => void }) {
  const className = cn(
    'bg-muted text-muted-foreground grid min-h-[30px] w-full items-center rounded-[7px] border-0 p-0 text-left font-mono text-[13px] font-normal',
    UNIFIED_GRID_COLUMNS,
    'min-w-max',
    onClick && 'hover:text-foreground cursor-pointer',
  );
  const children = (
    <>
      <span
        className={cn(
          'grid min-h-[30px] place-items-center text-[13px] leading-none',
          GUTTER_GAP_CLASS,
          onClick && 'grid-rows-2',
        )}
      >
        {onClick ? (
          <>
            <ChevronDown className="size-3" />
            <ChevronUp className="size-3" />
          </>
        ) : null}
      </span>
      <span className="inline-block px-3">{label}</span>
    </>
  );

  return (
    <div className="min-w-max">
      {onClick ? (
        <button className={className} onClick={onClick} type="button">
          {children}
        </button>
      ) : (
        <div className={className}>{children}</div>
      )}
    </div>
  );
}

function renderFoldLabel(count: number): string {
  return `${count} unmodified ${count === 1 ? 'line' : 'lines'}`;
}

function ReviewSplitRows({
  foldRevealCounts,
  onExpandFold,
  rowScopeId,
  rows,
}: {
  foldRevealCounts: Record<string, number>;
  onExpandFold: (id: string, total: number) => void;
  rowScopeId: string;
  rows: ScoutChangesReviewRow[];
}) {
  const model = useMemo(
    () => createSplitDiffModel(rows, { foldRevealCounts, rowScopeId }),
    [foldRevealCounts, rowScopeId, rows],
  );
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [splitCodeScrollLeft, setSplitCodeScrollLeft] = useState(0);
  const [splitCodeScrollMax, setSplitCodeScrollMax] = useState(0);

  useLayoutEffect(() => {
    if (!root) return;
    return scheduleReviewDiffSync(() => {
      const maxScrollLeft = getMaxSplitCodeScrollLeft(root);
      setSplitCodeScrollMax(maxScrollLeft);
      setSplitCodeScrollLeft((current) => clampScrollLeft(current, maxScrollLeft));
    });
  }, [root, model]);

  useLayoutEffect(() => {
    if (!root) return;
    syncReviewSplitCodeScroll(root, splitCodeScrollLeft);
  }, [root, splitCodeScrollLeft]);

  const handleSplitCodeWheel = (event: WheelEvent<HTMLDivElement>) => {
    const delta = getSplitCodeWheelDelta(event);
    if (delta === 0) return;
    const maxScrollLeft = getMaxSplitCodeScrollLeft(event.currentTarget);
    const currentScrollLeft = getReviewSplitCodeScrollLeft(
      event.currentTarget,
      splitCodeScrollLeft,
    );
    const nextScrollLeft = clampScrollLeft(currentScrollLeft + delta, maxScrollLeft);
    setSplitCodeScrollMax(maxScrollLeft);
    if (nextScrollLeft !== currentScrollLeft) {
      syncReviewSplitCodeScroll(event.currentTarget, nextScrollLeft);
      setSplitCodeScrollLeft(nextScrollLeft);
    }
    if (maxScrollLeft > 0) {
      event.preventDefault();
    }
  };

  const handleSplitCodeScrollbarScroll = (event: UIEvent<HTMLDivElement>) => {
    const nextScrollLeft = clampScrollLeft(event.currentTarget.scrollLeft, splitCodeScrollMax);
    const rootElement = event.currentTarget.closest<HTMLElement>('[data-split-diff="true"]');
    if (rootElement) {
      syncReviewSplitCodeScroll(rootElement, nextScrollLeft);
    }
    if (nextScrollLeft !== splitCodeScrollLeft) {
      setSplitCodeScrollLeft(nextScrollLeft);
    }
  };

  return (
    <div
      className="scout-review-split-diff bg-tree-background grid min-w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-[2px] [--changes-review-split-code-scroll-left:0px]"
      data-split-diff="true"
      onWheel={handleSplitCodeWheel}
      ref={setRoot}
      style={
        {
          '--changes-review-split-code-scroll-left': `${splitCodeScrollLeft}px`,
        } as CSSProperties
      }
    >
      <ReviewSplitColumn column={model.removed} onExpandFold={onExpandFold} />
      <ReviewSplitColumn column={model.added} onExpandFold={onExpandFold} />
      {splitCodeScrollMax > 0 ? (
        <>
          <ReviewSplitCodeScrollbar
            onScroll={handleSplitCodeScrollbarScroll}
            scrollMax={splitCodeScrollMax}
            side="removed"
          />
          <ReviewSplitCodeScrollbar
            onScroll={handleSplitCodeScrollbarScroll}
            scrollMax={splitCodeScrollMax}
            side="added"
          />
        </>
      ) : null}
    </div>
  );
}

function ReviewSplitCodeScrollbar({
  onScroll,
  scrollMax,
  side,
}: {
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  scrollMax: number;
  side: SplitDiffSide;
}) {
  return (
    <div
      className="scout-review-split-code-scrollbar"
      data-split-code-scrollbar={side}
      onScroll={onScroll}
    >
      <div
        className="scout-review-split-code-scrollbar-spacer"
        style={{ width: `calc(100% + ${scrollMax}px)` }}
      />
    </div>
  );
}

function ReviewSplitColumn({
  column,
  onExpandFold,
}: {
  column: SplitDiffColumn;
  onExpandFold: (id: string, total: number) => void;
}) {
  return (
    <div
      className={cn('grid min-w-0 content-start whitespace-pre', SPLIT_COLUMN_GRID)}
      data-split-column={column.side}
    >
      {column.cells.map((cell) => (
        <ReviewSplitCell
          cell={cell}
          key={`${column.side}:${cell.key}`}
          onExpandFold={onExpandFold}
          side={column.side}
        />
      ))}
    </div>
  );
}

function ReviewSplitCell({
  cell,
  onExpandFold,
  side,
}: {
  cell: SplitDiffCell;
  onExpandFold: (id: string, total: number) => void;
  side: SplitDiffSide;
}) {
  if (cell.kind === 'buffer') {
    return <ReviewSplitBuffer cell={cell} side={side} />;
  }

  if (cell.kind === 'fold') {
    return <ReviewSplitFoldCell cell={cell} onExpandFold={onExpandFold} side={side} />;
  }

  return <ReviewSplitLineCell cell={cell} side={side} />;
}

function ReviewSplitLineCell({
  cell,
  side,
}: {
  cell: Extract<SplitDiffCell, { kind: 'line' }>;
  side: SplitDiffSide;
}) {
  return (
    <>
      <span
        className={getSplitLineGutterClass(cell.lineType)}
        data-line-type={cell.lineType}
        data-split-line-number-side={side}
      >
        {getSplitLineNumber(cell.row, side) ?? ''}
      </span>
      <span
        className={getSplitLineContentClass(cell.lineType)}
        data-line-type={cell.lineType}
        data-split-code-pane="true"
        data-split-line-content-side={side}
      >
        <span className="scout-review-split-code">
          <ReviewLineText row={cell.row} />
        </span>
      </span>
    </>
  );
}

function ReviewSplitBuffer({
  cell,
  side,
}: {
  cell: Extract<SplitDiffCell, { kind: 'buffer' }>;
  side: SplitDiffSide;
}) {
  return (
    <span
      className={SPLIT_EMPTY_SIDE_CLASS}
      data-split-buffer-side={side}
      data-split-buffer-size={cell.rowCount}
      style={{
        gridRow: `span ${cell.rowCount}`,
        minHeight: `calc(${cell.rowCount} * var(--changes-review-line-height))`,
      }}
    />
  );
}

function ReviewSplitFoldCell({
  cell,
  onExpandFold,
  side,
}: {
  cell: Extract<SplitDiffCell, { kind: 'fold' }>;
  onExpandFold: (id: string, total: number) => void;
  side: SplitDiffSide;
}) {
  const showLabel = side === 'removed';
  const label = showLabel ? renderFoldLabel(Number(cell.row.count || 0)) : '';
  const canExpand = showLabel && Boolean(cell.row.foldId && cell.row.foldTotal);
  const contentClass = cn(
    'bg-muted text-muted-foreground flex min-h-[30px] min-w-0 items-center px-3 text-[13px]',
    side === 'added' && 'rounded-r-[7px]',
    canExpand && 'hover:text-foreground cursor-pointer border-0 text-left font-[inherit]',
  );
  const content = <span className="truncate">{label}</span>;

  return (
    <>
      <span
        className={cn(
          'bg-muted text-muted-foreground grid min-h-[30px] place-items-center text-[13px] leading-none',
          side === 'removed' && GUTTER_GAP_CLASS,
          side === 'removed' && 'rounded-l-[7px]',
          canExpand && 'grid-rows-2',
        )}
        data-split-fold-gutter-side={side}
      >
        {canExpand ? (
          <>
            <ChevronDown className="size-3" />
            <ChevronUp className="size-3" />
          </>
        ) : null}
      </span>
      {canExpand ? (
        <button
          className={contentClass}
          data-split-fold-content-side={side}
          onClick={() => onExpandFold(cell.row.foldId!, cell.row.foldTotal!)}
          type="button"
        >
          {content}
        </button>
      ) : (
        <div className={contentClass} data-split-fold-content-side={side}>
          {content}
        </div>
      )}
    </>
  );
}

function ReviewDataRow({ row }: { row: ScoutChangesReviewRow }) {
  const lineNumber = row.type === 'added' ? row.newLineNumber : row.oldLineNumber;
  return (
    <div
      className={cn(
        'grid min-h-[20px] min-w-max whitespace-pre',
        UNIFIED_GRID_COLUMNS,
        row.type === 'added' && 'bg-diff-added-muted shadow-diff-added',
        row.type === 'removed' && 'bg-diff-removed-muted shadow-diff-removed',
      )}
    >
      <span
        className={cn(
          'pr-3 text-right select-none',
          GUTTER_GAP_CLASS,
          row.type === 'added' && 'text-diff-added',
          row.type === 'removed' && 'text-diff-removed',
          row.type === 'context' && 'text-muted-foreground',
        )}
      >
        {lineNumber ?? ''}
      </span>
      <span
        className={cn(
          'text-foreground/90 min-w-0 py-0 pr-[18px] pl-2.5',
          row.type === 'removed' && 'text-diff-removed',
        )}
      >
        <ReviewLineText row={row} />
      </span>
    </div>
  );
}

function ReviewLineText({ row }: { row: ScoutChangesReviewRow }) {
  const tokens = row.tokens?.filter((token) => token.text.length > 0) ?? [];
  if (tokens.length === 0) return row.text ?? '';
  return (
    <>
      {tokens.map((token, index) => (
        <span className={getReviewTokenClassName(token)} key={`${index}:${token.text}`}>
          {token.text}
        </span>
      ))}
    </>
  );
}

function getSplitLineNumber(row: SplitDiffSourceRow, side: SplitDiffSide): number | undefined {
  return side === 'removed' ? row.oldLineNumber : row.newLineNumber;
}

function getSplitLineGutterClass(lineType: SplitDiffLineType): string {
  return cn(
    SPLIT_LINE_HEIGHT_CLASS,
    'pr-3 text-right select-none',
    GUTTER_GAP_CLASS,
    lineType === 'context' && 'text-muted-foreground',
    lineType === 'removed' && 'bg-diff-removed-muted text-diff-removed shadow-diff-removed',
    lineType === 'added' && 'bg-diff-added-muted text-diff-added shadow-diff-added',
  );
}

function getSplitLineContentClass(lineType: SplitDiffLineType): string {
  return cn(
    SPLIT_LINE_HEIGHT_CLASS,
    'text-foreground/90 overflow-hidden py-0 pr-[18px] pl-2.5',
    lineType === 'removed' && 'bg-diff-removed-muted text-diff-removed',
    lineType === 'added' && 'bg-diff-added-muted',
  );
}

function handleReviewDiffWheel(event: WheelEvent<HTMLDivElement>): void {
  if (!event.shiftKey || event.deltaY === 0) return;
  const target = event.currentTarget;
  const previousScrollLeft = target.scrollLeft;
  target.scrollLeft += getReviewDiffWheelDelta(event, target);
  if (target.scrollLeft !== previousScrollLeft) {
    event.preventDefault();
  }
}

function getReviewDiffWheelDelta(event: WheelEvent, target: HTMLElement): number {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * target.clientWidth;
  return event.deltaY;
}

function getSplitCodeWheelDelta(event: WheelEvent<HTMLDivElement>): number {
  const rawDelta = event.shiftKey ? event.deltaY || event.deltaX : event.deltaX;
  if (rawDelta === 0) return 0;
  if (event.deltaMode === 1) return rawDelta * 16;
  if (event.deltaMode === 2) return rawDelta * event.currentTarget.clientWidth;
  return rawDelta;
}

function getMaxSplitCodeScrollLeft(root: HTMLElement): number {
  const panes = root.querySelectorAll<HTMLElement>('[data-split-code-pane="true"]');
  let maxScrollLeft = 0;
  panes.forEach((pane) => {
    maxScrollLeft = Math.max(maxScrollLeft, pane.scrollWidth - pane.clientWidth);
  });
  return Math.max(0, Math.ceil(maxScrollLeft));
}

function clampScrollLeft(value: number, maxScrollLeft: number): number {
  return Math.min(Math.max(0, value), maxScrollLeft);
}

function syncReviewSplitCodeScrollbars(root: HTMLElement, scrollLeft: number): void {
  const scrollbars = root.querySelectorAll<HTMLElement>('[data-split-code-scrollbar]');
  scrollbars.forEach((scrollbar) => {
    if (scrollbar.scrollLeft !== scrollLeft) {
      scrollbar.scrollLeft = scrollLeft;
    }
  });
}

function syncReviewSplitCodeScroll(root: HTMLElement, scrollLeft: number): void {
  root.style.setProperty('--changes-review-split-code-scroll-left', `${scrollLeft}px`);
  syncReviewSplitCodeScrollbars(root, scrollLeft);
}

function getReviewSplitCodeScrollLeft(root: HTMLElement, fallback: number): number {
  const value = Number.parseFloat(
    root.style.getPropertyValue('--changes-review-split-code-scroll-left'),
  );
  return Number.isFinite(value) ? value : fallback;
}

function scheduleReviewDiffSync(callback: () => void): () => void {
  if (typeof window.requestAnimationFrame === 'function') {
    const frameId = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(frameId);
  }
  const timeoutId = window.setTimeout(callback, 0);
  return () => window.clearTimeout(timeoutId);
}

function getReviewTokenClassName(token: ScoutChangesReviewToken): string {
  return cn(
    getReviewSyntaxScopeClassName(token.syntaxScopes),
    token.diff === 'added' && 'scout-review-token-diff-added',
    token.diff === 'removed' && 'scout-review-token-diff-removed',
  );
}

function getReviewSyntaxScopeClassName(scopes: readonly string[] | undefined): string | undefined {
  if (!scopes?.length) return undefined;
  const scopeSet = new Set(scopes);
  if (hasReviewScope(scopeSet, 'hljs-comment', 'hljs-quote')) return 'scout-review-token-comment';
  if (
    hasReviewScope(
      scopeSet,
      'hljs-keyword',
      'hljs-selector-tag',
      'hljs-template-tag',
      'hljs-doctag',
    )
  ) {
    return 'scout-review-token-keyword';
  }
  if (hasReviewScope(scopeSet, 'hljs-string', 'hljs-regexp')) return 'scout-review-token-string';
  if (hasReviewScope(scopeSet, 'hljs-number', 'hljs-literal')) return 'scout-review-token-number';
  if (hasReviewScope(scopeSet, 'hljs-title') && hasReviewScope(scopeSet, 'function_')) {
    return 'scout-review-token-function';
  }
  if (hasReviewScope(scopeSet, 'hljs-title', 'hljs-title.function_')) {
    return 'scout-review-token-title';
  }
  if (hasReviewScope(scopeSet, 'hljs-attr', 'hljs-attribute', 'hljs-property')) {
    return 'scout-review-token-property';
  }
  if (hasReviewScope(scopeSet, 'hljs-variable', 'hljs-template-variable')) {
    return 'scout-review-token-variable';
  }
  if (hasReviewScope(scopeSet, 'hljs-meta')) return 'scout-review-token-meta';
  if (hasReviewScope(scopeSet, 'hljs-built_in', 'hljs-symbol')) return 'scout-review-token-symbol';
  if (hasReviewScope(scopeSet, 'hljs-name', 'hljs-section', 'hljs-selector-pseudo')) {
    return 'scout-review-token-name';
  }
  return undefined;
}

function hasReviewScope(scopeSet: ReadonlySet<string>, ...scopes: string[]): boolean {
  return scopes.some((scope) => scopeSet.has(scope));
}
