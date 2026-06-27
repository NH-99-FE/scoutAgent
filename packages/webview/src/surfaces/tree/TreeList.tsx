// ============================================================
// Tree List — 会话树行列表渲染边界
// ============================================================

import { memo } from 'react';
import { TreeRow } from './TreeRow';
import type { VisibleTreeNode } from './tree-types';

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
  return (
    <div className="space-y-0.5" role="tree">
      {visibleNodes.map((entry) => {
        const folded = foldedIds.has(entry.node.id);
        return (
          <TreeRow
            key={entry.node.id}
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
        );
      })}
    </div>
  );
});
