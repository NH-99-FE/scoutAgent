// ============================================================
// Session tree mapper — Webview 会话树协议适配
// 负责：将 core session tree 映射为 shared webview 协议树，并解析可见 leaf。
// ============================================================

import type { ScoutSessionTreeNode, ScoutSessionTreeNodeKind } from '@scout-agent/shared';
import type { SessionTreeEntry, SessionTreeNode } from '../../core/session/index.ts';

export function mapSessionTreeToScout(nodes: SessionTreeNode[]): ScoutSessionTreeNode[] {
  const mapNode = (
    node: SessionTreeNode,
    visibleParentId: string | null,
  ): ScoutSessionTreeNode[] => {
    const entry = node.entry;
    if (!isVisibleSessionTreeEntry(entry)) {
      return node.children.flatMap((child) => mapNode(child, visibleParentId));
    }

    const mapped: ScoutSessionTreeNode = {
      id: entry.id,
      parentId: visibleParentId,
      timestamp: entry.timestamp,
      type: entry.type,
      kind: getNodeKind(entry),
      role: getNodeRole(entry),
      label: node.label,
      labelTimestamp: node.labelTimestamp,
      preview: extractPreview(entry),
      children: node.children.flatMap((child) => mapNode(child, entry.id)),
    };
    return [mapped];
  };

  return nodes.flatMap((node) => mapNode(node, null));
}

export function resolveVisibleSessionLeafId(
  nodes: SessionTreeNode[],
  leafId: string | null,
): string | null {
  if (leafId === null) return null;

  const nodeById = new Map<string, SessionTreeNode>();
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    nodeById.set(node.entry.id, node);
    stack.push(...node.children);
  }

  let currentId: string | null = leafId;
  while (currentId !== null) {
    const node = nodeById.get(currentId);
    if (!node) return null;
    if (isVisibleSessionTreeEntry(node.entry)) {
      return node.entry.id;
    }
    currentId = node.entry.parentId;
  }
  return null;
}

function getNodeKind(entry: SessionTreeEntry): ScoutSessionTreeNodeKind | undefined {
  if (entry.type === 'message') {
    if (entry.message.role === 'user') return 'user';
    if (entry.message.role === 'assistant') return 'assistant';
    if (entry.message.role === 'toolResult') return 'toolResult';
    return undefined;
  }
  if (entry.type === 'compaction') return 'compaction';
  if (entry.type === 'branch_summary') return 'branchSummary';
  if (entry.type === 'custom_message') return 'custom';
  return undefined;
}

function getNodeRole(entry: SessionTreeEntry): string | undefined {
  return entry.type === 'message' ? entry.message.role : undefined;
}

function isVisibleSessionTreeEntry(entry: SessionTreeEntry): boolean {
  return (
    entry.type === 'message' ||
    entry.type === 'compaction' ||
    entry.type === 'branch_summary' ||
    (entry.type === 'custom_message' && entry.display)
  );
}

/** 从 entry 中提取 webview 树预览文本（首行，截断到 80 字符）。 */
function extractPreview(entry: SessionTreeEntry): string | undefined {
  const MAX_PREVIEW = 80;

  if (entry.type === 'message') {
    const msg = entry.message as unknown as Record<string, unknown> | undefined;
    const content = msg?.['content'];
    if (typeof content === 'string') {
      return truncatePreview(content, MAX_PREVIEW);
    }
    if (Array.isArray(content)) {
      const textBlock = content.find((block: Record<string, unknown>) => block['type'] === 'text');
      if (textBlock && typeof textBlock['text'] === 'string') {
        return truncatePreview(textBlock['text'], MAX_PREVIEW);
      }
    }
    return undefined;
  }

  if (entry.type === 'branch_summary') {
    return truncatePreview(entry.summary, MAX_PREVIEW);
  }

  if (entry.type === 'compaction') {
    return truncatePreview(entry.summary, MAX_PREVIEW);
  }

  if (entry.type === 'custom_message') {
    const content = entry.content;
    if (typeof content === 'string') {
      return truncatePreview(content, MAX_PREVIEW);
    }
    const textBlock = content.find((block) => block.type === 'text');
    return textBlock ? truncatePreview(textBlock.text, MAX_PREVIEW) : undefined;
  }

  return undefined;
}

function truncatePreview(text: string, maxLength: number): string | undefined {
  const firstLine = text.split('\n')[0] ?? '';
  if (!firstLine) return undefined;
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength)}...` : firstLine;
}
