import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ScoutSessionTreeNode } from '@scout-agent/shared';
import type { VisibleTreeNode } from '@/features/tree/model/tree-types';
import { TreeList } from '@/features/tree/view/TreeList';
import { TREE_LIST_PADDING_PX, TREE_ROW_SLOT_HEIGHT_PX } from '@/features/tree/view/tree-layout';

const ROW_SLOT_HEIGHT = TREE_ROW_SLOT_HEIGHT_PX;
const VIEWPORT_ROW_COUNT = 3;

let viewportHeight = ROW_SLOT_HEIGHT * VIEWPORT_ROW_COUNT;
let clientHeightDescriptor: PropertyDescriptor | undefined;
let scrollToDescriptor: PropertyDescriptor | undefined;

function makeVisibleNodes(count: number): VisibleTreeNode[] {
  return Array.from({ length: count }, (_, index) => {
    const node: ScoutSessionTreeNode = {
      id: `node-${index}`,
      parentId: index === 0 ? null : `node-${index - 1}`,
      timestamp: '2026-06-26T10:20:30.000Z',
      type: 'message',
      kind: 'user',
      role: 'user',
      preview: `node ${index}`,
      children: [],
    };
    return {
      node,
      parentId: node.parentId,
      searchableText: `node ${index}`,
      foldable: false,
      graph: {
        activeLanes: [],
        hasVisibleChildren: false,
        isBranchPoint: false,
        parentIndent: null,
      },
      indent: 0,
      isLast: index === count - 1,
    };
  });
}

function renderTreeList({
  effectiveSelectedId = null,
  visibleNodes = makeVisibleNodes(80),
}: {
  effectiveSelectedId?: string | null;
  visibleNodes?: VisibleTreeNode[];
} = {}) {
  render(
    <TreeList
      effectiveSelectedId={effectiveSelectedId}
      foldedIds={new Set()}
      highlightedFoldAnchorId={null}
      leafId={null}
      visibleNodes={visibleNodes}
      onFoldAnchorHighlightEnd={() => undefined}
      onSelectNode={() => undefined}
      onToggleFoldNode={() => undefined}
    />,
  );
  return getTreeViewport();
}

describe('TreeList', () => {
  beforeEach(() => {
    viewportHeight = ROW_SLOT_HEIGHT * VIEWPORT_ROW_COUNT;
    clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return this.getAttribute('data-slot') === 'scroll-area-viewport' ? viewportHeight : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value(options?: ScrollToOptions | number, y?: number) {
        this.scrollTop = typeof options === 'number' ? (y ?? 0) : (options?.top ?? 0);
      },
    });
  });

  afterEach(() => {
    cleanup();
    if (clientHeightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeightDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    }
    if (scrollToDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollToDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
    }
  });

  it('renders only the visible virtual window for large trees', () => {
    const viewport = renderTreeList();

    expect(screen.getByText('用户：node 0')).toBeInTheDocument();
    expect(screen.getByText('用户：node 10')).toBeInTheDocument();
    expect(screen.queryByText('用户：node 40')).not.toBeInTheDocument();

    act(() => {
      viewport.scrollTop = ROW_SLOT_HEIGHT * 40;
      fireEvent.scroll(viewport);
    });

    expect(screen.queryByText('用户：node 0')).not.toBeInTheDocument();
    expect(screen.getByText('用户：node 40')).toBeInTheDocument();
    expect(screen.queryByText('用户：node 79')).not.toBeInTheDocument();
  });

  it('scrolls the selected node into the virtual window', () => {
    const viewport = renderTreeList({ effectiveSelectedId: 'node-60' });

    expect(viewport.scrollTop).toBe(
      TREE_LIST_PADDING_PX + ROW_SLOT_HEIGHT * 61 - ROW_SLOT_HEIGHT * VIEWPORT_ROW_COUNT,
    );
    expect(screen.queryByText('用户：node 0')).not.toBeInTheDocument();
    expect(screen.getByText('用户：node 60')).toBeInTheDocument();
  });

  it('accounts for list padding when revealing the last selected node', () => {
    const viewport = renderTreeList({ effectiveSelectedId: 'node-79' });

    expect(viewport.scrollTop).toBe(
      TREE_LIST_PADDING_PX + ROW_SLOT_HEIGHT * 80 - ROW_SLOT_HEIGHT * VIEWPORT_ROW_COUNT,
    );
    expect(screen.getByText('用户：node 79')).toBeInTheDocument();
  });

  it('keeps rendering when the list shrinks below the current scroll position', () => {
    const { rerender } = render(
      <TreeList
        effectiveSelectedId={null}
        foldedIds={new Set()}
        highlightedFoldAnchorId={null}
        leafId={null}
        visibleNodes={makeVisibleNodes(80)}
        onFoldAnchorHighlightEnd={() => undefined}
        onSelectNode={() => undefined}
        onToggleFoldNode={() => undefined}
      />,
    );
    const viewport = getTreeViewport();

    act(() => {
      viewport.scrollTop = ROW_SLOT_HEIGHT * 70;
      fireEvent.scroll(viewport);
    });

    expect(screen.getByText('用户：node 70')).toBeInTheDocument();

    rerender(
      <TreeList
        effectiveSelectedId={null}
        foldedIds={new Set()}
        highlightedFoldAnchorId={null}
        leafId={null}
        visibleNodes={makeVisibleNodes(5)}
        onFoldAnchorHighlightEnd={() => undefined}
        onSelectNode={() => undefined}
        onToggleFoldNode={() => undefined}
      />,
    );

    expect(screen.getAllByRole('treeitem')).toHaveLength(5);
    expect(screen.getByText('用户：node 4')).toBeInTheDocument();
  });
});

function getTreeViewport(): HTMLDivElement {
  const viewport = document.querySelector('[data-slot="scroll-area-viewport"]');
  expect(viewport).toBeInstanceOf(HTMLDivElement);
  return viewport as HTMLDivElement;
}
