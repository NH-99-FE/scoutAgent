// ============================================================
// Changes Review Surface — 面板布局
// ============================================================

import type { ScoutChangesReviewModel, ScoutChangesReviewViewMode } from '@scout-agent/shared';
import { LoaderCircle } from 'lucide-react';
import { ReviewFileSection } from '@/surfaces/changes-review/ReviewFileSection';
import { ReviewTopbar } from '@/surfaces/changes-review/ReviewTopbar';
import { getChangesReviewFileKey } from '@/surfaces/changes-review/changes-review-file-key';
import type { ChangesReviewActions } from '@/surfaces/changes-review/changes-review-types';

const CHANGES_REVIEW_PANEL_CLASS =
  'bg-tree-background text-foreground box-border h-screen min-h-0 overflow-x-hidden overflow-y-auto pb-[18px] [--changes-review-line-gutter:54px] max-[640px]:[--changes-review-line-gutter:44px]';

export function ChangesReviewPanel({
  actions,
  expandedFileKeys,
  foldRevealCounts,
  model,
  viewMode,
}: {
  actions: ChangesReviewActions;
  expandedFileKeys: ReadonlySet<string>;
  foldRevealCounts: Record<string, number>;
  model?: ScoutChangesReviewModel;
  viewMode: ScoutChangesReviewViewMode;
}) {
  if (!model) {
    return (
      <main className={CHANGES_REVIEW_PANEL_CLASS}>
        <div className="border-l-status-warning text-muted-foreground bg-status-warning-muted mx-2 mt-2 mb-2.5 border-l-[3px] px-2.5 py-2">
          <span className="inline-flex items-center gap-2">
            <LoaderCircle className="size-3.5 animate-spin" />
            正在生成文件变更
          </span>
        </div>
      </main>
    );
  }

  return (
    <main className={CHANGES_REVIEW_PANEL_CLASS}>
      <ReviewTopbar model={model} onSetViewMode={actions.setViewMode} viewMode={viewMode} />
      <section className="block px-2.5">
        {model.files.map((file) => {
          const fileKey = getChangesReviewFileKey(file);
          return (
            <ReviewFileSection
              expanded={expandedFileKeys.has(fileKey)}
              file={file}
              fileKey={fileKey}
              foldRevealCounts={foldRevealCounts}
              key={fileKey}
              onExpandFold={actions.expandFold}
              onOpenFile={actions.openFile}
              onToggleFile={actions.toggleFile}
              viewMode={viewMode}
            />
          );
        })}
      </section>
    </main>
  );
}
