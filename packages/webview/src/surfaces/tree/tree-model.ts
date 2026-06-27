// ============================================================
// Tree Model — 会话树过滤与可见节点计算
// ============================================================

import type { ScoutSessionTreeNode } from '@scout-agent/shared';
import { formatNodeLine } from './tree-node-format';
import type { FilterMode, FlatTreeNode, VisibleTreeNode } from './tree-types';

interface VisibleTreeIndex {
  parentById: Map<string, string | null>;
  childrenByParentId: Map<string | null, FlatTreeNode[]>;
}

export function flattenTree(
  nodes: ScoutSessionTreeNode[],
  parentId: string | null = null,
): FlatTreeNode[] {
  const result: FlatTreeNode[] = [];
  for (const node of nodes) {
    result.push({ node, parentId });
    result.push(...flattenTree(node.children, node.id));
  }
  return result;
}

export function indexNodes(nodes: FlatTreeNode[]): Map<string, FlatTreeNode> {
  return new Map(nodes.map((entry) => [entry.node.id, entry]));
}

export function getEffectiveSelectedId(
  selectedId: string | null,
  leafId: string | null,
  visibleNodes: VisibleTreeNode[],
): string | null {
  if (selectedId && visibleNodes.some((entry) => entry.node.id === selectedId)) return selectedId;
  if (leafId && visibleNodes.some((entry) => entry.node.id === leafId)) return leafId;
  return visibleNodes[0]?.node.id ?? null;
}

export function buildVisibleNodes(
  flatNodes: FlatTreeNode[],
  foldedIds: Set<string>,
  filterMode: FilterMode,
  query: string,
): VisibleTreeNode[] {
  const nodeById = indexNodes(flatNodes);
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const baseFiltered = flatNodes.filter((entry) => {
    if (!passesFilter(entry.node, filterMode)) return false;
    if (tokens.length === 0) return true;
    const text = getSearchableText(entry.node);
    return tokens.every((token) => text.includes(token));
  });
  const baseVisibleIndex = buildVisibleIndex(baseFiltered, nodeById);
  const foldableIds = new Set(
    Array.from(baseVisibleIndex.childrenByParentId.entries())
      .filter(([parentId, children]) => parentId !== null && children.length > 0)
      .map(([parentId]) => parentId!),
  );
  const filtered = baseFiltered.filter(
    (entry) => !hasFoldedVisibleAncestor(entry.node.id, baseVisibleIndex.parentById, foldedIds),
  );

  const visibleIndex = buildVisibleIndex(filtered, nodeById);

  const result: VisibleTreeNode[] = [];
  const visit = (entries: FlatTreeNode[], indent: number) => {
    entries.forEach((entry, index) => {
      const children = visibleIndex.childrenByParentId.get(entry.node.id) ?? [];
      const hasMultipleChildren = children.length > 1;
      const visibleEntry: VisibleTreeNode = {
        ...entry,
        foldable: foldableIds.has(entry.node.id),
        parentId: visibleIndex.parentById.get(entry.node.id) ?? null,
        indent,
        isLast: index === entries.length - 1,
      };
      result.push(visibleEntry);
      const childIndent = hasMultipleChildren ? indent + 1 : indent;
      visit(children, childIndent);
    });
  };

  visit(visibleIndex.childrenByParentId.get(null) ?? [], 0);
  return result;
}

export function isVisibleDescendant(
  nodeId: string,
  ancestorId: string,
  visibleNodes: VisibleTreeNode[],
): boolean {
  const parentById = new Map(visibleNodes.map((entry) => [entry.node.id, entry.parentId]));
  let currentId = parentById.get(nodeId) ?? null;
  while (currentId) {
    if (currentId === ancestorId) return true;
    currentId = parentById.get(currentId) ?? null;
  }
  return false;
}

function findVisibleParentId(
  entry: FlatTreeNode,
  nodeById: Map<string, FlatTreeNode>,
  visibleIds: Set<string>,
): string | null {
  let currentId = entry.parentId;
  while (currentId) {
    if (visibleIds.has(currentId)) return currentId;
    currentId = nodeById.get(currentId)?.parentId ?? null;
  }
  return null;
}

function buildVisibleIndex(
  entries: FlatTreeNode[],
  nodeById: Map<string, FlatTreeNode>,
): VisibleTreeIndex {
  const ids = new Set(entries.map((entry) => entry.node.id));
  const parentById = new Map<string, string | null>();
  const childrenByParentId = new Map<string | null, FlatTreeNode[]>();
  for (const entry of entries) {
    const visibleParentId = findVisibleParentId(entry, nodeById, ids);
    parentById.set(entry.node.id, visibleParentId);
    const children = childrenByParentId.get(visibleParentId) ?? [];
    children.push(entry);
    childrenByParentId.set(visibleParentId, children);
  }
  return { parentById, childrenByParentId };
}

function hasFoldedVisibleAncestor(
  nodeId: string,
  visibleParentById: Map<string, string | null>,
  foldedIds: Set<string>,
): boolean {
  let currentId = visibleParentById.get(nodeId) ?? null;
  while (currentId) {
    if (foldedIds.has(currentId)) return true;
    currentId = visibleParentById.get(currentId) ?? null;
  }
  return false;
}

function passesFilter(node: ScoutSessionTreeNode, filterMode: FilterMode): boolean {
  if (filterMode === 'no-tools') return node.kind !== 'toolResult';
  if (filterMode === 'user-only') return node.kind === 'user';
  if (filterMode === 'labeled-only') return Boolean(node.label);
  return true;
}

function getSearchableText(node: ScoutSessionTreeNode): string {
  return [
    node.kind,
    node.role,
    node.type,
    node.label,
    node.preview,
    formatNodeLine(node),
    node.toolCall?.id,
    node.toolCall?.name,
    formatToolCallArguments(node),
    node.stopReason,
    node.errorMessage,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function formatToolCallArguments(node: ScoutSessionTreeNode): string | undefined {
  if (!node.toolCall) return undefined;
  return JSON.stringify(node.toolCall.arguments);
}
