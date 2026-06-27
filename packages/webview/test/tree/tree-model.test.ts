import { describe, expect, it } from 'vitest';
import type { ScoutSessionTreeNode, ScoutSessionTreeNodeKind } from '@scout-agent/shared';
import { buildVisibleNodes, flattenTree } from '@/surfaces/tree/tree-model';

function makeNode(
  id: string,
  kind: ScoutSessionTreeNodeKind,
  children: ScoutSessionTreeNode[] = [],
  overrides: Partial<ScoutSessionTreeNode> = {},
): ScoutSessionTreeNode {
  return {
    id,
    parentId: overrides.parentId ?? null,
    timestamp: overrides.timestamp ?? '2026-06-26T10:20:30.000Z',
    type: overrides.type ?? 'message',
    kind,
    role: overrides.role,
    preview: overrides.preview,
    children,
  };
}

function linkChildren(node: ScoutSessionTreeNode): ScoutSessionTreeNode {
  for (const child of node.children) {
    child.parentId = node.id;
    linkChildren(child);
  }
  return node;
}

describe('tree-model', () => {
  it('keeps a new branch root aligned with its single-child continuation', () => {
    const oldAssistant = makeNode('old-assistant', 'assistant', [], { role: 'assistant' });
    const newTool = makeNode('new-tool', 'toolResult');
    const newAssistant = makeNode('new-assistant', 'assistant', [newTool], { role: 'assistant' });
    const newUser = makeNode('new-user', 'user', [newAssistant], { role: 'user' });
    const branchPoint = linkChildren(
      makeNode('branch-point', 'user', [oldAssistant, newUser], { role: 'user' }),
    );

    const visibleNodes = buildVisibleNodes(flattenTree([branchPoint]), new Set(), 'default', '');
    const indentById = new Map(visibleNodes.map((entry) => [entry.node.id, entry.indent]));

    expect(indentById.get('branch-point')).toBe(0);
    expect(indentById.get('old-assistant')).toBe(1);
    expect(indentById.get('new-user')).toBe(1);
    expect(indentById.get('new-assistant')).toBe(1);
    expect(indentById.get('new-tool')).toBe(1);
  });

  it('marks ancestor graph lanes while an earlier branch still has later siblings', () => {
    const firstBranchChild = makeNode('first-branch-child', 'assistant', [], { role: 'assistant' });
    const firstBranch = makeNode('first-branch', 'user', [firstBranchChild], { role: 'user' });
    const secondBranch = makeNode('second-branch', 'assistant', [], { role: 'assistant' });
    const branchPoint = linkChildren(
      makeNode('branch-point', 'user', [firstBranch, secondBranch], { role: 'user' }),
    );

    const visibleNodes = buildVisibleNodes(flattenTree([branchPoint]), new Set(), 'default', '');
    const graphById = new Map(visibleNodes.map((entry) => [entry.node.id, entry.graph]));

    expect(graphById.get('branch-point')?.isBranchPoint).toBe(true);
    expect(graphById.get('first-branch')?.parentIndent).toBe(0);
    expect(graphById.get('first-branch-child')?.activeLanes).toEqual([0]);
    expect(graphById.get('second-branch')?.activeLanes).toEqual([]);
  });

  it('does not treat folded nodes as foldable when filters hide their visible children', () => {
    const toolChild = makeNode('tool-child', 'toolResult');
    const root = linkChildren(makeNode('root', 'user', [toolChild], { role: 'user' }));

    const visibleNodes = buildVisibleNodes(flattenTree([root]), new Set(['root']), 'no-tools', '');

    expect(visibleNodes.map((entry) => entry.node.id)).toEqual(['root']);
    expect(visibleNodes[0]?.foldable).toBe(false);
    expect(visibleNodes[0]?.graph.hasVisibleChildren).toBe(false);
  });

  it('keeps graph lanes for nested branches independently', () => {
    const innerFirstLeaf = makeNode('inner-first-leaf', 'assistant', [], { role: 'assistant' });
    const innerFirst = makeNode('inner-first', 'user', [innerFirstLeaf], { role: 'user' });
    const innerSecond = makeNode('inner-second', 'assistant', [], { role: 'assistant' });
    const innerBranchPoint = makeNode('inner-branch-point', 'assistant', [innerFirst, innerSecond], {
      role: 'assistant',
    });
    const outerFirst = makeNode('outer-first', 'user', [innerBranchPoint], { role: 'user' });
    const outerSecond = makeNode('outer-second', 'assistant', [], { role: 'assistant' });
    const root = linkChildren(makeNode('root', 'user', [outerFirst, outerSecond], { role: 'user' }));

    const visibleNodes = buildVisibleNodes(flattenTree([root]), new Set(), 'default', '');
    const graphById = new Map(visibleNodes.map((entry) => [entry.node.id, entry.graph]));

    expect(graphById.get('outer-first')?.activeLanes).toEqual([]);
    expect(graphById.get('inner-branch-point')?.activeLanes).toEqual([0]);
    expect(graphById.get('inner-first')?.activeLanes).toEqual([0]);
    expect(graphById.get('inner-first-leaf')?.activeLanes).toEqual([0, 1]);
    expect(graphById.get('inner-second')?.activeLanes).toEqual([0]);
    expect(graphById.get('outer-second')?.activeLanes).toEqual([]);
  });
});
