import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScoutSessionTreeNode } from '@scout-agent/shared';
import { TreeRow } from '@/surfaces/tree/TreeRow';
import type { VisibleTreeNode } from '@/surfaces/tree/tree-types';

function makeVisibleNode(
  preview: string,
  overrides: Partial<Omit<VisibleTreeNode, 'node'>> = {},
): VisibleTreeNode {
  const node: ScoutSessionTreeNode = {
    id: 'assistant-long',
    parentId: null,
    timestamp: '2026-06-26T10:20:30.000Z',
    type: 'message',
    kind: 'assistant',
    role: 'assistant',
    preview,
    children: [],
  };
  return {
    node,
    parentId: overrides.parentId ?? null,
    searchableText: preview.toLowerCase(),
    foldable: overrides.foldable ?? false,
    graph: {
      activeLanes: overrides.graph?.activeLanes ?? [],
      hasVisibleChildren: overrides.graph?.hasVisibleChildren ?? false,
      isBranchPoint: overrides.graph?.isBranchPoint ?? false,
      parentIndent: overrides.graph?.parentIndent ?? null,
    },
    indent: overrides.indent ?? 0,
    isLast: overrides.isLast ?? true,
  };
}

describe('TreeRow', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps leading icon columns fixed when the node text is long', () => {
    render(
      <TreeRow
        current={false}
        entry={makeVisibleNode(
          '403 The free tier of the model has been exhausted. If you wish to continue access the model or route to a different provider, configure billing first.',
        )}
        folded={false}
        foldable={false}
        selected={false}
        onFoldAnchorHighlightEnd={() => undefined}
        onSelectNode={() => undefined}
        onToggleFoldNode={() => undefined}
      />,
    );

    const row = screen.getByRole('treeitem');
    const leading = row.firstElementChild;

    expect(row).not.toHaveAttribute('aria-expanded');
    expect(leading).toHaveClass('grid-cols-[auto_0.875rem_minmax(0,1fr)]');
    expect(leading?.firstElementChild).toHaveStyle({ width: '18px' });
    expect(screen.queryByRole('button', { name: '折叠分支' })).not.toBeInTheDocument();
    expect(screen.getByText(/403 The free tier/)).toHaveClass('min-w-0', 'truncate');
  });

  it('overlays the fold affordance on the graph node dot', () => {
    render(
      <TreeRow
        current={false}
        entry={makeVisibleNode('branch root', {
          foldable: true,
          graph: {
            activeLanes: [],
            hasVisibleChildren: true,
            isBranchPoint: true,
            parentIndent: null,
          },
        })}
        folded={false}
        foldable={true}
        selected={false}
        onFoldAnchorHighlightEnd={() => undefined}
        onSelectNode={() => undefined}
        onToggleFoldNode={() => undefined}
      />,
    );

    const foldButton = screen.getByRole('button', { name: '折叠分支' });

    expect(screen.getByRole('treeitem')).toHaveAttribute('aria-expanded', 'true');
    expect(foldButton).toHaveClass(
      'absolute',
      'top-1/2',
      'size-5',
      'opacity-0',
      'group-hover/tree-row:opacity-100',
      'focus-visible:opacity-100',
    );
    expect(foldButton).not.toHaveClass('group-focus-within/tree-row:opacity-100');
    expect(foldButton).not.toHaveClass('bg-background/80');
    expect(foldButton).toHaveStyle({ left: '9px' });
  });

  it('replaces the graph node dot with a visible collapsed arrow when folded', () => {
    render(
      <TreeRow
        current={false}
        entry={makeVisibleNode('folded branch', {
          foldable: true,
          graph: {
            activeLanes: [],
            hasVisibleChildren: false,
            isBranchPoint: true,
            parentIndent: null,
          },
        })}
        folded={true}
        foldable={true}
        selected={false}
        onFoldAnchorHighlightEnd={() => undefined}
        onSelectNode={() => undefined}
        onToggleFoldNode={() => undefined}
      />,
    );

    const foldButton = screen.getByRole('button', { name: '展开分支' });

    expect(screen.getByRole('treeitem')).toHaveAttribute('aria-expanded', 'false');
    expect(foldButton).toHaveClass('opacity-100');
    expect(foldButton).not.toHaveClass('opacity-0');
  });

  it('lets a residual folded node clear its fold state even when it is no longer foldable', () => {
    const onSelect = vi.fn();
    const onToggleFold = vi.fn();

    render(
      <TreeRow
        current={false}
        entry={makeVisibleNode('filtered folded branch')}
        folded={true}
        foldable={false}
        selected={false}
        onFoldAnchorHighlightEnd={() => undefined}
        onSelectNode={onSelect}
        onToggleFoldNode={onToggleFold}
      />,
    );

    const foldButton = screen.getByRole('button', { name: '展开分支' });

    expect(screen.getByRole('treeitem')).toHaveAttribute('aria-expanded', 'false');
    expect(foldButton).toHaveClass('opacity-100');
    expect(foldButton).toHaveProperty('tabIndex', 0);

    fireEvent.click(foldButton);

    expect(onToggleFold).toHaveBeenCalledTimes(1);
    expect(onToggleFold).toHaveBeenCalledWith('assistant-long', true);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
