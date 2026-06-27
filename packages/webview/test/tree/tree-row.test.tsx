import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ScoutSessionTreeNode } from '@scout-agent/shared';
import { TreeRow } from '@/surfaces/tree/TreeRow';
import type { VisibleTreeNode } from '@/surfaces/tree/tree-types';

function makeVisibleNode(preview: string): VisibleTreeNode {
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
    parentId: null,
    foldable: false,
    indent: 0,
    isLast: true,
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
        onSelect={() => undefined}
        onToggleFold={() => undefined}
      />,
    );

    const row = screen.getByRole('treeitem');
    const leading = row.firstElementChild;
    const foldButton = screen.getByRole('button', { name: '折叠分支' });

    expect(leading).toHaveClass('grid-cols-[1.25rem_0.875rem_minmax(0,1fr)]');
    expect(foldButton).toHaveClass('size-5', 'shrink-0');
    expect(screen.getByText(/403 The free tier/)).toHaveClass('min-w-0', 'truncate');
  });
});
