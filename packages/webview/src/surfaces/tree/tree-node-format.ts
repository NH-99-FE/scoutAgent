// ============================================================
// Tree Node Format — 会话树节点文案格式化
// ============================================================

import type { ScoutSessionTreeNode, ScoutSessionTreeToolCall } from '@scout-agent/shared';

export function formatNodeKind(node: ScoutSessionTreeNode): string {
  switch (node.kind) {
    case 'user':
      return '用户消息';
    case 'assistant':
      return '助手消息';
    case 'bashExecution':
      return '命令执行';
    case 'toolResult':
      return '工具结果';
    case 'compaction':
      return '压缩';
    case 'branchSummary':
      return '分支摘要';
    case 'custom':
      return '自定义消息';
    default:
      return node.type;
  }
}

export function formatNodeLine(node: ScoutSessionTreeNode): string {
  const preview = normalizePreview(node.preview);
  switch (node.kind) {
    case 'user':
      return `用户：${preview || '空消息'}`;
    case 'assistant':
      return `助手：${preview || formatAssistantFallback(node)}`;
    case 'bashExecution':
      return preview ? `[bash] ${preview}` : '[bash]';
    case 'toolResult':
      return preview || formatToolCallLine(node.toolCall);
    case 'compaction':
      return preview ? `[压缩] ${preview}` : '[压缩]';
    case 'branchSummary':
      return preview ? `[分支摘要]：${preview}` : '[分支摘要]';
    case 'custom':
      return preview || '[custom]';
    default:
      return preview || node.type;
  }
}

export function normalizePreview(preview: string | undefined): string {
  return (preview ?? '').replace(/[\n\t]/g, ' ').trim();
}

function formatToolCallLine(toolCall: ScoutSessionTreeToolCall | undefined): string {
  if (!toolCall) return '[tool]';
  const args = toolCall.arguments;
  switch (toolCall.name) {
    case 'read': {
      const path = getArgText(args, ['path', 'file_path']);
      const offset = getArgNumber(args, 'offset');
      const limit = getArgNumber(args, 'limit');
      let display = path;
      if (offset !== undefined || limit !== undefined) {
        const start = offset ?? 1;
        const end = limit !== undefined ? start + limit - 1 : '';
        display += `:${start}${end ? `-${end}` : ''}`;
      }
      return `[read: ${display}]`;
    }
    case 'write':
      return `[write: ${getArgText(args, ['path', 'file_path'])}]`;
    case 'edit':
      return `[edit: ${getArgText(args, ['path', 'file_path'])}]`;
    case 'bash': {
      const rawCommand = getArgText(args, ['command']);
      const command = rawCommand
        .replace(/[\n\t]/g, ' ')
        .trim()
        .slice(0, 50);
      return `[bash: ${command}${rawCommand.length > 50 ? '...' : ''}]`;
    }
    case 'grep': {
      const pattern = getArgText(args, ['pattern']);
      const path = getArgText(args, ['path']) || '.';
      return `[grep: /${pattern}/ in ${path}]`;
    }
    case 'find': {
      const pattern = getArgText(args, ['pattern']);
      const path = getArgText(args, ['path']) || '.';
      return `[find: ${pattern} in ${path}]`;
    }
    case 'ls': {
      const path = getArgText(args, ['path']) || '.';
      return `[ls: ${path}]`;
    }
    default: {
      const argsJson = JSON.stringify(args) ?? '{}';
      return `[${toolCall.name}: ${argsJson.slice(0, 40)}${argsJson.length > 40 ? '...' : ''}]`;
    }
  }
}

function formatAssistantFallback(node: ScoutSessionTreeNode): string {
  const errorPreview = normalizePreview(node.errorMessage);
  if (node.stopReason === 'aborted') return '(aborted)';
  if (errorPreview) return errorPreview;
  if (node.stopReason && node.stopReason !== 'stop' && node.stopReason !== 'toolUse') {
    return `(${node.stopReason})`;
  }
  return '无内容';
}

function getArgText(args: ScoutSessionTreeToolCall['arguments'], keys: string[]): string {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return '';
}

function getArgNumber(
  args: ScoutSessionTreeToolCall['arguments'],
  key: string,
): number | undefined {
  const value = args[key];
  return typeof value === 'number' ? value : undefined;
}
