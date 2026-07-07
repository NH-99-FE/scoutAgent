// ============================================================
// Changes Review Surface — 文件区块
// ============================================================

import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ScoutChangesReviewFile, ScoutChangesReviewViewMode } from '@scout-agent/shared';
import { ReviewDiff } from '@/surfaces/changes-review/ReviewDiff';
import { ReviewPath } from '@/surfaces/changes-review/ReviewPath';

export function ReviewFileSection({
  expanded,
  file,
  fileKey,
  foldRevealCounts,
  onExpandFold,
  onOpenFile,
  onToggleFile,
  viewMode,
}: {
  expanded: boolean;
  file: ScoutChangesReviewFile;
  fileKey: string;
  foldRevealCounts: Record<string, number>;
  onExpandFold: (id: string, total: number) => void;
  onOpenFile: (path: string) => void;
  onToggleFile: (key: string) => void;
  viewMode: ScoutChangesReviewViewMode;
}) {
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;
  const displayPath = file.displayPath ?? file.path;

  return (
    <article
      className="overflow-visible bg-transparent [&+&]:mt-2"
      data-record-ids={file.recordIds.join(' ')}
      id={file.id}
    >
      <header className="bg-tree-background sticky top-10 z-20 w-full">
        <div className="group/file-row hover:bg-control-hover focus-within:bg-control-hover grid min-h-9 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2.5 rounded-md px-2 py-1 transition-colors sm:px-[22px]">
          <button
            className="flex min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden border-0 bg-transparent p-0 text-left font-[inherit] text-inherit focus-visible:outline-none"
            onClick={() => onToggleFile(fileKey)}
            onDoubleClick={() => onOpenFile(file.absolutePath)}
            title={displayPath}
            type="button"
          >
            <ReviewPath path={displayPath} />
            {file.external ? (
              <span className="border-border bg-muted text-muted-foreground rounded-[3px] border px-[5px] py-px text-[11px]">
                External
              </span>
            ) : null}
          </button>
          <span className="inline-flex items-center gap-[5px] text-sm font-normal">
            <span className="text-diff-added">+{file.additions}</span>
            <span className="text-diff-removed">-{file.deletions}</span>
          </span>
          <button
            aria-label="Toggle file diff"
            className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-[22px] cursor-pointer place-items-center rounded-md border-0 bg-transparent text-center font-[inherit]"
            onClick={() => onToggleFile(fileKey)}
            type="button"
          >
            <ChevronIcon className="size-4" />
          </button>
        </div>
      </header>
      {expanded ? (
        <ReviewDiff
          file={file}
          fileKey={fileKey}
          foldRevealCounts={foldRevealCounts}
          onExpandFold={onExpandFold}
          viewMode={viewMode}
        />
      ) : null}
    </article>
  );
}
