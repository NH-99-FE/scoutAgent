// ============================================================
// Changes Review Surface — 面板布局
// ============================================================

import type { ScoutChangesReviewModel, ScoutChangesReviewViewMode } from '@scout-agent/shared';
import { ReviewFileSection } from '@/surfaces/changes-review/ReviewFileSection';
import { ReviewTopbar } from '@/surfaces/changes-review/ReviewTopbar';
import type { ChangesReviewActions } from '@/surfaces/changes-review/changes-review-types';

export function ChangesReviewPanel({
  actions,
  expandedFileIds,
  foldRevealCounts,
  model,
  viewMode,
}: {
  actions: ChangesReviewActions;
  expandedFileIds: ReadonlySet<string>;
  foldRevealCounts: Record<string, number>;
  model?: ScoutChangesReviewModel;
  viewMode: ScoutChangesReviewViewMode;
}) {
  if (!model) {
    return (
      <main className="bg-tree-background text-foreground box-border h-screen min-h-0 overflow-x-hidden overflow-y-auto pb-[18px] [--changes-review-line-gutter:54px] max-[640px]:[--changes-review-line-gutter:44px]">
        <div className="border-l-chart-3 text-muted-foreground bg-chart-3/10 mx-2 mt-2 mb-2.5 border-l-[3px] px-2.5 py-2">
          Changes review data is unavailable.
        </div>
      </main>
    );
  }

  return (
    <main className="bg-tree-background text-foreground box-border h-screen min-h-0 overflow-x-hidden overflow-y-auto pb-[18px] [--changes-review-line-gutter:54px] max-[640px]:[--changes-review-line-gutter:44px]">
      <ReviewTopbar model={model} onSetViewMode={actions.setViewMode} viewMode={viewMode} />
      <section className="block px-2.5">
        {model.files.map((file) => (
          <ReviewFileSection
            expanded={expandedFileIds.has(file.id)}
            file={file}
            foldRevealCounts={foldRevealCounts}
            key={file.id}
            onExpandFold={actions.expandFold}
            onOpenFile={actions.openFile}
            onToggleFile={actions.toggleFile}
            viewMode={viewMode}
          />
        ))}
      </section>
    </main>
  );
}
