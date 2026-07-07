// ============================================================
// Tree Node Icon — 会话树节点图标
// ============================================================

import {
  Archive,
  Bot,
  ClipboardList,
  ClipboardPen,
  FileText,
  FolderOpen,
  GitBranch,
  Search,
  SquareTerminal,
  User,
  Wrench,
} from 'lucide-react';
import type { ScoutSessionTreeNode } from '@scout-agent/shared';
import { normalizePreview } from '../model/tree-node-format';

export function TreeNodeIcon({
  node,
  className,
}: {
  node: ScoutSessionTreeNode;
  className: string;
}) {
  switch (node.kind) {
    case 'user':
      return <User className={className} />;
    case 'assistant':
      return <Bot className={className} />;
    case 'bashExecution':
      return <SquareTerminal className={className} />;
    case 'toolResult':
      return renderToolIcon(getTreeToolName(node), className);
    case 'compaction':
      return <Archive className={className} />;
    case 'branchSummary':
      return <GitBranch className={className} />;
    case 'custom':
      return <FileText className={className} />;
    default:
      return <FileText className={className} />;
  }
}

function getTreeToolName(node: ScoutSessionTreeNode): string | undefined {
  if (node.toolCall?.name) return node.toolCall.name;
  const match = normalizePreview(node.preview).match(/^\[([^:\]\s]+)(?::|\])/);
  return match?.[1];
}

function renderToolIcon(toolName: string | undefined, className: string) {
  if (toolName === 'bash') return <SquareTerminal className={className} />;
  if (toolName === 'grep' || toolName === 'find') return <Search className={className} />;
  if (toolName === 'read') return <FileText className={className} />;
  if (toolName === 'edit' || toolName === 'write') return <ClipboardPen className={className} />;
  if (toolName === 'ls') return <FolderOpen className={className} />;
  if (toolName === 'todo' || toolName === 'task') return <ClipboardList className={className} />;
  return <Wrench className={className} />;
}
