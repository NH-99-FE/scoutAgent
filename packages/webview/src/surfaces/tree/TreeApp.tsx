// ============================================================
// Tree App — 独立会话树导航面板
// ============================================================

import { useCallback, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useSessionFile, useSessionId } from '@/store/session-store';
import {
  FILTERS,
  NodeInspector,
  TreeActionsMenu,
  TreeList,
  TreeNavigationBlockedDialog,
  TreeNavigationDialog,
  useTreePanelController,
} from '@/features/tree';

export function TreeApp() {
  const sessionId = useSessionId();
  const sessionFile = useSessionFile();
  return <TreeAppSession key={`${sessionId}:${sessionFile}`} />;
}

function TreeAppSession() {
  const controller = useTreePanelController();
  const [highlightedFoldAnchorId, setHighlightedFoldAnchorId] = useState<string | null>(null);
  const { setSelectedId, toggleFold } = controller;
  const selectedNodeIsNavigationNoop =
    controller.selectedNode?.id === controller.leafId &&
    controller.selectedNode.kind !== 'user' &&
    controller.selectedNode.kind !== 'custom';

  const handleSelectNode = useCallback(
    (nodeId: string) => {
      if (controller.interactionLocked) return;
      setSelectedId(nodeId);
    },
    [controller.interactionLocked, setSelectedId],
  );

  const handleToggleFoldNode = useCallback(
    (nodeId: string, folded: boolean) => {
      if (controller.interactionLocked) return;
      if (!folded) {
        setHighlightedFoldAnchorId(nodeId);
      } else {
        setHighlightedFoldAnchorId((current) => (current === nodeId ? null : current));
      }
      toggleFold(nodeId);
    },
    [controller.interactionLocked, toggleFold],
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
            disabled={controller.interactionLocked}
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
              disabled={controller.interactionLocked}
              onClick={() => controller.setFilterMode(filter.mode)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <TreeActionsMenu
          disabled={controller.interactionLocked}
          onRefresh={controller.refreshTree}
          onRevealCurrentLeaf={controller.revealCurrentLeaf}
        />
      </section>

      <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div className="bg-tree-background min-h-0 p-3">
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
        </div>

        <aside className="bg-tree-background min-h-0 p-3">
          <NodeInspector
            interactionLocked={controller.sessionMutationLocked}
            navigationActionDisabled={controller.navigationActionDisabled}
            isCurrentNode={selectedNodeIsNavigationNoop}
            navigationPending={controller.navigationPending}
            labelSaved={controller.selectedNode?.id === controller.labelSavedNodeId}
            labelDraft={controller.effectiveLabelDraft}
            node={controller.selectedNode}
            onAbortNavigation={controller.abortNavigation}
            onLabelDraftChange={controller.updateLabelDraft}
            onNavigate={controller.navigateToSelectedNode}
            onOpenSummaryOptions={controller.openSummaryOptions}
            onSaveLabel={controller.saveLabel}
          />
        </aside>
      </section>
      <TreeNavigationDialog
        customInstructions={controller.effectiveSummaryDraft.customInstructions}
        mode={controller.effectiveSummaryDraft.mode}
        open={controller.summaryDialogOpen}
        reopensComposer={controller.reopensComposer}
        showSummaryOptions={controller.summaryOptionsVisible}
        onConfirm={controller.confirmNavigation}
        onCustomInstructionsChange={controller.updateCustomInstructions}
        onModeChange={controller.updateSummaryMode}
        onOpenChange={controller.setSummaryDialogOpen}
      />
      <TreeNavigationBlockedDialog
        message={controller.navigationBlockedMessage}
        open={controller.navigationBlockedDialogOpen}
        onOpenChange={controller.setNavigationBlockedDialogOpen}
      />
    </main>
  );
}
