// ============================================================
// Tree Row — 会话树节点行
// ============================================================

import { memo } from 'react';
import { ChevronDown, ChevronRight, Leaf, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TreeNodeIcon } from './TreeNodeIcon';
import { formatNodeLine } from '../model/tree-node-format';
import type { VisibleTreeNode } from '../model/tree-types';

const GRAPH_LANE_WIDTH = 18;

interface TreeRowProps {
  current: boolean;
  entry: VisibleTreeNode;
  folded: boolean;
  foldable: boolean;
  highlighted?: boolean;
  selected: boolean;
  onFoldAnchorHighlightEnd: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onToggleFoldNode: (nodeId: string, folded: boolean) => void;
}

export const TreeRow = memo(function TreeRow({
  current,
  entry,
  folded,
  foldable,
  highlighted = false,
  selected,
  onFoldAnchorHighlightEnd,
  onSelectNode,
  onToggleFoldNode,
}: TreeRowProps) {
  const node = entry.node;
  const selectNode = () => onSelectNode(node.id);
  const toggleFold = () => onToggleFoldNode(node.id, folded);
  const handleAnimationEnd = () => {
    if (!highlighted) return;
    onFoldAnchorHighlightEnd(node.id);
  };

  return (
    <div
      aria-current={current ? 'true' : undefined}
      aria-selected={selected}
      className={cn(
        'group/tree-row grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-transparent px-2 text-sm transition-[background-color,box-shadow,border-color] duration-200',
        selected ? 'bg-control-selected' : 'hover:bg-control-hover',
        highlighted && 'scout-fold-anchor-highlight bg-primary/10 ring-primary/25 ring-2',
      )}
      role="treeitem"
      aria-expanded={foldable || folded ? !folded : undefined}
      tabIndex={0}
      onAnimationEnd={handleAnimationEnd}
      onClick={selectNode}
      onKeyDown={(event) => {
        if (isInteractiveTarget(event.target)) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectNode();
        }
      }}
    >
      <div className="grid min-w-0 grid-cols-[auto_0.875rem_minmax(0,1fr)] items-center gap-1.5">
        <TreeGraphRail
          current={current}
          entry={entry}
          foldable={foldable}
          folded={folded}
          selected={selected}
          onToggleFold={toggleFold}
        />
        <TreeNodeIcon
          className={cn('size-3.5 shrink-0', current ? 'text-primary' : 'text-muted-foreground')}
          node={node}
        />
        <span className="min-w-0 truncate">{formatNodeLine(node)}</span>
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-1.5">
        {node.label ? (
          <span className="text-status-warning flex max-w-32 items-center gap-1 truncate text-[11px]">
            <Tag className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{node.label}</span>
          </span>
        ) : null}
        {current ? (
          <span className="text-status-success flex shrink-0 items-center gap-1 text-[11px]">
            <Leaf className="size-3 shrink-0" />
            <span>now</span>
          </span>
        ) : null}
      </div>
    </div>
  );
});

function TreeGraphRail({
  current,
  entry,
  foldable,
  folded,
  selected,
  onToggleFold,
}: {
  current: boolean;
  entry: VisibleTreeNode;
  foldable: boolean;
  folded: boolean;
  selected: boolean;
  onToggleFold: () => void;
}) {
  const nodeLane = Math.max(0, entry.indent);
  const laneCount = nodeLane + 1;
  const parentLane = entry.graph.parentIndent;
  const hasParentConnector = parentLane !== null;
  const parentConnectorLane = parentLane ?? nodeLane;
  const hasBranchConnector = hasParentConnector && nodeLane > parentConnectorLane;
  const dotSize = folded || entry.graph.isBranchPoint ? 'size-2' : 'size-1.5';
  const canToggleFold = foldable || folded;
  const dotLeft = `${laneCenter(nodeLane)}px`;

  return (
    <span
      className="relative block h-8 shrink-0"
      style={{ width: `${laneCount * GRAPH_LANE_WIDTH}px` }}
    >
      {entry.graph.activeLanes
        .filter((lane) => lane !== parentConnectorLane)
        .map((lane) => (
          <GraphVertical key={lane} lane={lane} />
        ))}
      {hasParentConnector ? <GraphVertical lane={parentConnectorLane} segment="top" /> : null}
      {hasBranchConnector && !entry.isLast ? (
        <GraphVertical lane={parentConnectorLane} segment="bottom" />
      ) : null}
      {hasBranchConnector ? (
        <GraphHorizontal fromLane={parentConnectorLane} toLane={nodeLane} />
      ) : null}
      {entry.graph.hasVisibleChildren ? <GraphVertical lane={nodeLane} segment="bottom" /> : null}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-colors',
          dotSize,
          current
            ? 'border-primary bg-primary'
            : selected
              ? 'border-primary/70 bg-primary/70'
              : entry.graph.isBranchPoint
                ? 'border-muted-foreground/55 bg-background'
                : 'border-border bg-muted-foreground/55',
          folded ? 'opacity-0' : canToggleFold && 'group-hover/tree-row:opacity-0',
        )}
        style={{ left: dotLeft }}
      />
      {canToggleFold ? (
        <button
          aria-label={folded ? '展开分支' : '折叠分支'}
          className={cn(
            'text-muted-foreground hover:text-foreground absolute top-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm transition-opacity',
            folded
              ? 'opacity-100'
              : 'opacity-0 group-hover/tree-row:opacity-100 focus-visible:opacity-100',
          )}
          style={{ left: dotLeft }}
          tabIndex={canToggleFold ? 0 : -1}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (canToggleFold) onToggleFold();
          }}
        >
          {folded ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      ) : null}
    </span>
  );
}

function GraphVertical({
  lane,
  segment = 'full',
}: {
  lane: number;
  segment?: 'full' | 'top' | 'bottom';
}) {
  const style =
    segment === 'top'
      ? { bottom: '50%', left: `${laneCenter(lane)}px`, top: 0 }
      : segment === 'bottom'
        ? { bottom: 0, left: `${laneCenter(lane)}px`, top: '50%' }
        : { bottom: 0, left: `${laneCenter(lane)}px`, top: 0 };

  return <span className="bg-border/80 absolute w-px rounded-full" style={style} />;
}

function GraphHorizontal({ fromLane, toLane }: { fromLane: number; toLane: number }) {
  const start = Math.min(fromLane, toLane);
  const end = Math.max(fromLane, toLane);

  return (
    <span
      className="bg-border/80 absolute top-1/2 h-px -translate-y-1/2 rounded-full"
      style={{
        left: `${laneCenter(start)}px`,
        width: `${(end - start) * GRAPH_LANE_WIDTH}px`,
      }}
    />
  );
}

function laneCenter(lane: number): number {
  return lane * GRAPH_LANE_WIDTH + GRAPH_LANE_WIDTH / 2;
}

function isInteractiveTarget(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement && Boolean(target.closest('button, input, textarea, select'))
  );
}
