// ============================================================
// Tool Display Helpers — 通用展示构造与格式化
// ============================================================

import type { ToolCallPreviewState } from '@/store/conversation-store';
import type {
  FileEditToolDisplayResult,
  GenericToolDisplayResult,
  ToolDisplayContext,
  ToolDisplayIcon,
  ToolDisplayResult,
  ToolDisplayStatus,
} from './types';

export function createGenericDisplay(
  context: ToolDisplayContext,
  options: { detailTitle: string; detailText: string; summaryTitle?: string },
): GenericToolDisplayResult {
  return {
    kind: 'generic',
    status: context.status,
    toolName: context.toolName,
    summaryTitle:
      options.summaryTitle ??
      formatToolExecutionSummary(context.status, context.toolName, context.args),
    icon: getToolDisplayIcon(context.toolName),
    detail: options.detailText.trim()
      ? {
          kind: 'text',
          title: options.detailTitle,
          text: options.detailText,
          completionLabel: context.completionLabel,
        }
      : undefined,
    detailLabel: '工具输出',
    detailTarget: context.toolName,
  };
}

export function createFileEditDisplayFromDetails({
  status,
  toolName,
  args,
  details,
}: {
  status: ToolDisplayStatus;
  toolName: string;
  args: Record<string, unknown> | undefined;
  details: unknown;
}): FileEditToolDisplayResult | undefined {
  const diffText = getFileEditDetailsDiff(details);
  if (!diffText) return undefined;

  const path = getFirstArgText(args, ['path', 'filePath', 'file', 'target']) || '文件';
  const stats = countEditDiffStats(diffText);
  return {
    kind: 'file_edit',
    status,
    toolName,
    icon: 'edit',
    path,
    detail: {
      kind: 'diff',
      diffText,
    },
    additions: stats.additions,
    deletions: stats.deletions,
    metrics: [
      { key: 'additions', value: stats.additions, prefix: '+', tone: 'added' },
      { key: 'deletions', value: stats.deletions, prefix: '-', tone: 'deleted' },
    ],
    metricsPlacement: 'end',
    detailLabel: '编辑差异',
    detailTarget: path,
    summaryTitle: formatToolExecutionSummary(status, toolName, args),
  };
}

export function createFileEditDisplayFromPreview({
  status,
  toolName,
  preview,
}: {
  status: ToolDisplayStatus;
  toolName: string;
  preview: ToolCallPreviewState;
}): FileEditToolDisplayResult {
  const fileEdit = preview.preview;
  const previewError = fileEdit.error;

  return {
    kind: 'file_edit',
    status,
    toolName,
    icon: 'edit',
    path: fileEdit.path,
    detail: {
      kind: 'diff',
      diffText: fileEdit.diff ?? '',
      previewError,
    },
    additions: fileEdit.additions,
    deletions: fileEdit.deletions,
    metrics: previewError
      ? undefined
      : [
          { key: 'additions', value: fileEdit.additions, prefix: '+', tone: 'added' },
          { key: 'deletions', value: fileEdit.deletions, prefix: '-', tone: 'deleted' },
        ],
    metricsPlacement: 'end',
    detailLabel: '编辑差异',
    detailTarget: fileEdit.path,
    summaryTitle: previewError
      ? `预览失败 编辑 ${fileEdit.path}`
      : `${getToolStatusPrefix(status)} 编辑 ${fileEdit.path}`,
  };
}

export function formatDefaultDetailText(context: ToolDisplayContext): string {
  const parts: string[] = [];
  if (context.argsText) {
    parts.push(`参数\n${context.argsText}`);
  }
  if (context.bodyText.trim()) {
    parts.push(`${context.isError ? '错误' : '输出'}\n${context.bodyText}`);
  }
  return parts.join('\n\n');
}

export function formatBashDetailText(context: ToolDisplayContext): string {
  const command = getFirstArgText(context.args, ['command', 'cmd', 'script']);
  if (!command) return formatDefaultDetailText(context);
  return [`$ ${command}`, context.bodyText].filter((part) => part.trim().length > 0).join('\n');
}

export function formatArgs(args: Record<string, unknown> | undefined): string {
  if (!args || Object.keys(args).length === 0) return '';
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return '';
  }
}

export function getToolDisplayIcon(toolName: string): ToolDisplayIcon {
  if (toolName === 'bash') return 'terminal';
  if (toolName === 'grep' || toolName === 'find') return 'search';
  if (toolName === 'read') return 'file';
  if (toolName === 'edit' || toolName === 'write') return 'edit';
  if (toolName === 'ls') return 'folder';
  return 'tool';
}

export function resolveToolActivitySummary(display: ToolDisplayResult): {
  key: string;
  icon: ToolDisplayIcon;
} {
  const toolName = display.toolName;
  if (toolName === 'bash') return { key: 'command', icon: 'terminal' };
  if (toolName === 'edit' || toolName === 'write') return { key: 'edit', icon: 'edit' };
  if (toolName === 'read') return { key: 'read', icon: 'file' };
  if (toolName === 'grep' || toolName === 'find') return { key: 'search', icon: 'search' };
  if (toolName === 'ls') return { key: 'list', icon: 'folder' };
  return { key: 'generic', icon: display.icon };
}

export function formatToolActivitySummaryLabel(kind: string, count: number): string {
  if (kind === 'command') return `已运行 ${count} 条命令`;
  if (kind === 'edit') return `已编辑 ${count} 个文件`;
  if (kind === 'read') return `已读取 ${count} 个文件`;
  if (kind === 'search') return `已搜索 ${count} 次`;
  if (kind === 'list') return `已列出 ${count} 次`;
  return `处理了 ${count} 项`;
}

export function formatMixedToolActivitySummaryLabel(count: number): string {
  return `已处理 ${count} 项`;
}

function getFileEditDetailsDiff(details: unknown): string {
  if (!details || typeof details !== 'object') return '';
  if ((details as { kind?: unknown }).kind !== 'file_edit') return '';
  const diff = (details as { diff?: unknown }).diff;
  return typeof diff === 'string' ? diff : '';
}

function countEditDiffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }

  return { additions, deletions };
}

export function formatToolExecutionSummary(
  status: ToolDisplayStatus,
  toolName: string,
  args: Record<string, unknown> | undefined,
): string {
  return `${getToolStatusPrefix(status)} ${getToolActionLabel(toolName, args)}`;
}

function getToolActionLabel(toolName: string, args: Record<string, unknown> | undefined): string {
  const target = getFirstArgText(args, ['path', 'filePath', 'file', 'target', 'cwd', 'directory']);
  const command = getFirstArgText(args, ['command', 'cmd', 'script']);
  const pattern = getFirstArgText(args, ['pattern', 'query', 'regex', 'term']);

  if (toolName === 'bash') return command || '命令';
  if (toolName === 'read') return target ? `读取 ${target}` : '读取文件';
  if (toolName === 'grep') {
    if (pattern && target) return `搜索 ${pattern} in ${target}`;
    if (pattern) return `搜索 ${pattern}`;
    return '搜索文本';
  }
  if (toolName === 'find') {
    return pattern ? `查找 ${pattern}` : target ? `查找 ${target}` : '查找文件';
  }
  if (toolName === 'ls') return target ? `列出 ${target}` : '列出目录';
  if (toolName === 'edit') return target ? `编辑 ${target}` : '编辑文件';
  if (toolName === 'write') return target ? `写入 ${target}` : '写入文件';
  return toolName;
}

function getToolStatusPrefix(status: ToolDisplayStatus): string {
  if (status === 'running') return '正在运行';
  if (status === 'done') return '已运行';
  if (status === 'error') return '运行失败';
  if (status === 'stopped') return '已停止';
  return '正在运行';
}

function getFirstArgText(args: Record<string, unknown> | undefined, keys: string[]): string {
  if (!args) return '';
  for (const key of keys) {
    const text = formatArgText(args[key]);
    if (text) return text;
  }
  return '';
}

function formatArgText(value: unknown): string {
  if (typeof value === 'string') return truncateInline(value.trim());
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function truncateInline(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 96) return normalized;
  return `${normalized.slice(0, 93)}...`;
}
