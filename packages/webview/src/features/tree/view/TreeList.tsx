// ============================================================
// Tree List — 会话树行列表渲染边界
// ============================================================

import { memo, useLayoutEffect, useMemo, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TreeRow } from './TreeRow';
import { TREE_LIST_PADDING_PX, TREE_ROW_SLOT_HEIGHT_PX } from './tree-layout';
import { useTreeVirtualRows } from '../hooks/use-tree-virtual-rows';
import type { VisibleTreeNode } from '../model/tree-types';

const TREE_VIRTUAL_OVERSCAN = 8;
const TREE_FALLBACK_VIEWPORT_ROWS = 24;

interface TreeListProps {
  effectiveSelectedId: string | null;
  foldedIds: Set<string>;
  highlightedFoldAnchorId: string | null;
  leafId: string | null;
  visibleNodes: VisibleTreeNode[];
  onFoldAnchorHighlightEnd: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onToggleFoldNode: (nodeId: string, folded: boolean) => void;
}

export const TreeList = memo(function TreeList({
  effectiveSelectedId,
  foldedIds,
  highlightedFoldAnchorId,
  leafId,
  visibleNodes,
  onFoldAnchorHighlightEnd,
  onSelectNode,
  onToggleFoldNode,
}: TreeListProps) {
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null);
  const selectedIndex = useMemo(() => {
    if (!effectiveSelectedId) return null;
    const index = visibleNodes.findIndex((entry) => entry.node.id === effectiveSelectedId);
    return index < 0 ? null : index;
  }, [effectiveSelectedId, visibleNodes]);
  const { rows, scrollToIndex, totalHeight } = useTreeVirtualRows({
    fallbackRowCount: TREE_FALLBACK_VIEWPORT_ROWS,
    itemCount: visibleNodes.length,
    overscan: TREE_VIRTUAL_OVERSCAN,
    paddingEnd: TREE_LIST_PADDING_PX,
    paddingStart: TREE_LIST_PADDING_PX,
    rowHeight: TREE_ROW_SLOT_HEIGHT_PX,
    scrollElement: viewportElement,
  });

  useLayoutEffect(() => {
    if (selectedIndex === null) return;
    scrollToIndex(selectedIndex);
  }, [scrollToIndex, selectedIndex]);

  return (
    <ScrollArea
      className="border-border bg-card h-full min-h-0 rounded-md border shadow-sm"
      type="always"
      viewportRef={setViewportElement}
    >
      {visibleNodes.length === 0 ? (
        <div className="text-muted-foreground px-2 py-8 text-center text-sm">暂无会话树节点</div>
      ) : (
        <div className="relative min-w-0" role="tree" style={{ height: `${totalHeight}px` }}>
          {rows.map(({ index, offsetTop }) => {
            const entry = visibleNodes[index];
            if (!entry) return null;
            const folded = foldedIds.has(entry.node.id);

            return (
              <div
                key={entry.node.id}
                className="absolute pb-0.5"
                role="presentation"
                style={{
                  height: `${TREE_ROW_SLOT_HEIGHT_PX}px`,
                  left: `${TREE_LIST_PADDING_PX}px`,
                  right: `${TREE_LIST_PADDING_PX}px`,
                  transform: `translateY(${offsetTop}px)`,
                }}
              >
                <TreeRow
                  current={entry.node.id === leafId}
                  entry={entry}
                  folded={folded}
                  foldable={entry.foldable}
                  highlighted={entry.node.id === highlightedFoldAnchorId}
                  selected={entry.node.id === effectiveSelectedId}
                  onFoldAnchorHighlightEnd={onFoldAnchorHighlightEnd}
                  onSelectNode={onSelectNode}
                  onToggleFoldNode={onToggleFoldNode}
                />
              </div>
            );
          })}
        </div>
      )}
    </ScrollArea>
  );
});
