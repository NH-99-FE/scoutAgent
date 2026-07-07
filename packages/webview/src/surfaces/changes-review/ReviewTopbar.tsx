// ============================================================
// Changes Review Surface — 顶部摘要与视图切换
// ============================================================

import { Columns2, Rows2 } from 'lucide-react';
import type { ScoutChangesReviewModel, ScoutChangesReviewViewMode } from '@scout-agent/shared';
import { cn } from '@/lib/utils';

export function ReviewTopbar({
  model,
  onSetViewMode,
  viewMode,
}: {
  model: ScoutChangesReviewModel;
  onSetViewMode: (mode: ScoutChangesReviewViewMode) => void;
  viewMode: ScoutChangesReviewViewMode;
}) {
  return (
    <header className="bg-tree-background sticky top-0 z-30 flex min-h-10 items-center justify-between gap-4 px-2.5 py-1 sm:pr-3.5 sm:pl-[22px]">
      <div className="inline-flex min-w-0 items-center gap-2 text-[13px] whitespace-nowrap">
        <span className="max-[640px]:max-w-[42vw] max-[640px]:overflow-hidden max-[640px]:text-ellipsis">
          {model.totals.fileCount} 个文件已更改
        </span>
        <span className="inline-flex items-center gap-[5px]">
          <span className="text-diff-added">+{model.totals.additions}</span>
          <span className="text-diff-removed">-{model.totals.deletions}</span>
        </span>
      </div>
      <span
        aria-label="Diff view mode"
        className="inline-flex items-center gap-[3px]"
        role="tablist"
      >
        <button
          aria-label="Unified diff"
          className={getViewModeButtonClass(viewMode === 'unified')}
          onClick={() => onSetViewMode('unified')}
          title="Unified diff"
          type="button"
        >
          <Rows2 className="size-4" />
        </button>
        <button
          aria-label="Split diff"
          className={getViewModeButtonClass(viewMode === 'split')}
          onClick={() => onSetViewMode('split')}
          title="Split diff"
          type="button"
        >
          <Columns2 className="size-4" />
        </button>
      </span>
    </header>
  );
}

function getViewModeButtonClass(active: boolean): string {
  return cn(
    'text-muted-foreground hover:bg-muted hover:text-foreground grid size-7 cursor-pointer place-items-center rounded-lg border-0 bg-transparent font-[inherit]',
    active && 'bg-muted text-foreground',
  );
}
