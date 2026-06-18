// ============================================================
// Tool Display Helpers — 通用展示构造与格式化
// ============================================================

import type { ToolCallPreviewState } from '@/store/conversation-store';
import type {
  FileEditToolDisplayResult,
  GenericToolDisplayResult,
  ToolDisplayContext,
  ToolDisplayIcon,
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
      formatToolSummaryTitle(context.status, context.toolName, context.args),
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
    summaryTitle: `${getToolStatusVerb(status, toolName)} ${path}`,
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
  const verb = previewError ? '编辑预览失败' : getPreviewEditVerb(status);

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
    summaryTitle: `${verb} ${fileEdit.path}`,
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

function getPreviewEditVerb(status: ToolDisplayStatus): string {
  if (status === 'running') return '正在编辑';
  return '将编辑';
}

function formatToolSummaryTitle(
  status: ToolDisplayStatus,
  toolName: string,
  args: Record<string, unknown> | undefined,
): string {
  const target = getFirstArgText(args, ['path', 'filePath', 'file', 'target', 'cwd', 'directory']);
  const command = getFirstArgText(args, ['command', 'cmd', 'script']);
  const pattern = getFirstArgText(args, ['pattern', 'query', 'regex', 'term']);
  const verb = getToolStatusVerb(status, toolName);

  if (toolName === 'bash') return command ? `${verb} ${command}` : `${verb}命令`;
  if (toolName === 'read') return target ? `${verb} ${target}` : `${verb}文件`;
  if (toolName === 'grep') {
    if (pattern && target) return `${verb} ${pattern} in ${target}`;
    if (pattern) return `${verb} ${pattern}`;
    return `${verb}文本`;
  }
  if (toolName === 'find') {
    return pattern ? `${verb} ${pattern}` : target ? `${verb} ${target}` : `${verb}文件`;
  }
  if (toolName === 'ls') return target ? `${verb} ${target}` : `${verb}目录`;
  if (toolName === 'edit') return target ? `${verb} ${target}` : `${verb}文件`;
  if (toolName === 'write') return target ? `${verb} ${target}` : `${verb}文件`;
  return `${verb} ${toolName}`;
}

function getToolStatusVerb(status: ToolDisplayStatus, toolName: string): string {
  const verbs = getToolVerbs(toolName);
  if (status === 'running') return verbs.running;
  if (status === 'done') return verbs.done;
  if (status === 'error') return verbs.error;
  return verbs.pending;
}

function getToolVerbs(toolName: string): {
  pending: string;
  running: string;
  done: string;
  error: string;
} {
  if (toolName === 'bash') {
    return { pending: '等待运行', running: '正在运行', done: '已运行', error: '运行失败' };
  }
  if (toolName === 'read') {
    return { pending: '等待读取', running: '正在读取', done: '已读取', error: '读取失败' };
  }
  if (toolName === 'grep') {
    return { pending: '等待搜索', running: '正在搜索', done: '已搜索', error: '搜索失败' };
  }
  if (toolName === 'find') {
    return { pending: '等待查找', running: '正在查找', done: '已查找', error: '查找失败' };
  }
  if (toolName === 'ls') {
    return { pending: '等待列出', running: '正在列出', done: '已列出', error: '列出失败' };
  }
  if (toolName === 'edit') {
    return { pending: '等待编辑', running: '正在编辑', done: '已编辑', error: '编辑失败' };
  }
  if (toolName === 'write') {
    return { pending: '等待写入', running: '正在写入', done: '已写入', error: '写入失败' };
  }
  return { pending: '等待调用', running: '正在调用', done: '已调用', error: '调用失败' };
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
