// ============================================================
// Tree App — 独立会话树导航面板
// ============================================================

import { useCallback, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  FILTERS,
  NodeInspector,
  TreeActionsMenu,
  TreeList,
  useTreePanelController,
} from '@/features/tree';

export function TreeApp() {
  const controller = useTreePanelController();
  const [highlightedFoldAnchorId, setHighlightedFoldAnchorId] = useState<string | null>(null);
  const { setSelectedId, toggleFold } = controller;

  const handleSelectNode = useCallback(
    (nodeId: string) => {
      setSelectedId(nodeId);
    },
    [setSelectedId],
  );

  const handleToggleFoldNode = useCallback(
    (nodeId: string, folded: boolean) => {
      if (!folded) {
        setHighlightedFoldAnchorId(nodeId);
      } else {
        setHighlightedFoldAnchorId((current) => (current === nodeId ? null : current));
      }
      toggleFold(nodeId);
    },
    [toggleFold],
  );

  const handleFoldAnchorHighlightEnd = useCallback((nodeId: string) => {
    setHighlightedFoldAnchorId((current) => (current === nodeId ? null : current));
  }, []);

  return (
    <main className="bg-tree-background text-foreground flex h-screen min-h-0 flex-col overflow-hidden">
      <section className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2">
        <div className="relative min-w-56 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            aria-label="搜索会话节点"
            className="h-7 rounded-full pl-8 text-xs"
            placeholder="搜索会话节点"
            value={controller.query}
            onChange={(event) => controller.setQuery(event.target.value)}
          />
        </div>
        <div className="border-border flex overflow-hidden rounded-full border">
          {FILTERS.map((filter) => (
            <button
              key={filter.mode}
              className={cn(
                'border-border h-7 border-r px-2.5 text-xs first:rounded-l-full last:rounded-r-full last:border-r-0',
                controller.filterMode === filter.mode
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted text-muted-foreground',
              )}
              type="button"
              onClick={() => controller.setFilterMode(filter.mode)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <TreeActionsMenu
          onRefresh={controller.refreshTree}
          onRevealCurrentLeaf={controller.revealCurrentLeaf}
        />
      </section>

      <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div className="bg-tree-background min-h-0 p-3">
          <ScrollArea
            className="border-border bg-card h-full min-h-0 rounded-md border shadow-sm"
            viewportClassName="p-2"
          >
            {controller.visibleNodes.length === 0 ? (
              <div className="text-muted-foreground px-2 py-8 text-center text-sm">
                暂无会话树节点
              </div>
            ) : (
              <TreeList
                effectiveSelectedId={controller.effectiveSelectedId}
                foldedIds={controller.foldedIds}
                highlightedFoldAnchorId={highlightedFoldAnchorId}
                leafId={controller.leafId}
                visibleNodes={controller.visibleNodes}
                onFoldAnchorHighlightEnd={handleFoldAnchorHighlightEnd}
                onSelectNode={handleSelectNode}
                onToggleFoldNode={handleToggleFoldNode}
              />
            )}
          </ScrollArea>
        </div>

        <aside className="bg-tree-background min-h-0 p-3">
          <NodeInspector
            customInstructions={controller.effectiveSummaryDraft.customInstructions}
            labelSaved={controller.selectedNode?.id === controller.labelSavedNodeId}
            labelDraft={controller.effectiveLabelDraft}
            node={controller.selectedNode}
            summaryMode={controller.effectiveSummaryDraft.mode}
            onCustomInstructionsChange={controller.updateCustomInstructions}
            onLabelDraftChange={controller.updateLabelDraft}
            onNavigate={controller.navigateToSelectedNode}
            onSaveLabel={controller.saveLabel}
            onSummaryModeChange={controller.updateSummaryMode}
          />
        </aside>
      </section>
    </main>
  );
}
