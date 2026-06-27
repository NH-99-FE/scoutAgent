// ============================================================
// Tree Row — 会话树节点行
// ============================================================

import { ChevronDown, ChevronRight, Leaf, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TreeNodeIcon } from './TreeNodeIcon';
import { formatNodeLine } from './tree-node-format';
import type { VisibleTreeNode } from './tree-types';

export function TreeRow({
  current,
  entry,
  folded,
  foldable,
  selected,
  onSelect,
  onToggleFold,
}: {
  current: boolean;
  entry: VisibleTreeNode;
  folded: boolean;
  foldable: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggleFold: () => void;
}) {
  const node = entry.node;
  const indent = Math.max(0, entry.indent) * 18;

  return (
    <div
      aria-current={current ? 'true' : undefined}
      aria-selected={selected}
      className={cn(
        'group/tree-row grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-transparent px-2 text-sm',
        selected ? 'bg-muted dark:bg-muted/50' : 'hover:bg-muted dark:hover:bg-muted/50',
      )}
      role="treeitem"
      style={{ paddingLeft: `${8 + indent}px` }}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (isInteractiveTarget(event.target)) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="grid min-w-0 grid-cols-[1.25rem_0.875rem_minmax(0,1fr)] items-center gap-1.5">
        <button
          aria-label={folded ? '展开分支' : '折叠分支'}
          className={cn(
            'text-muted-foreground hover:text-foreground flex size-5 shrink-0 items-center justify-center rounded-sm',
            !foldable && 'invisible',
          )}
          tabIndex={foldable ? 0 : -1}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (foldable) onToggleFold();
          }}
        >
          {folded ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
        <TreeNodeIcon
          className={cn('size-3.5 shrink-0', current ? 'text-primary' : 'text-muted-foreground')}
          node={node}
        />
        <span className="min-w-0 truncate">{formatNodeLine(node)}</span>
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-1.5">
        {node.label ? (
          <span className="flex max-w-32 items-center gap-1 truncate text-[11px] text-yellow-700/65 dark:text-yellow-200/60">
            <Tag className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{node.label}</span>
          </span>
        ) : null}
        {current ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-emerald-700/70 dark:text-emerald-300/60">
            <Leaf className="size-3 shrink-0" />
            <span>now</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function isInteractiveTarget(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement && Boolean(target.closest('button, input, textarea, select'))
  );
}
