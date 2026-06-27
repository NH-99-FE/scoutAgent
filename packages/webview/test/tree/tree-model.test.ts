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
});
