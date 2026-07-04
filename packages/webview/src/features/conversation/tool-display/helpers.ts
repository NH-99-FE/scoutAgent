// ============================================================
// Tool Display Helpers — 通用展示构造与格式化
// ============================================================

import type { ToolCallPreviewState } from '@/store/conversation-store';
import type { ScoutChangesReviewRow, ScoutFileChangeDetails } from '@scout-agent/shared';
import type {
  FileEditToolDisplayResult,
  GenericToolDisplayResult,
  ToolDisplayContext,
  ToolDisplayIcon,
  ToolDisplayMetric,
  ToolDisplayResult,
  ToolDisplayStatus,
} from './types';

const FILE_CHANGE_DIFF_PREVIEW_TRUNCATED_LINE = '… 预览已截断，请打开审查查看完整变更';

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

export function createPathOnlyToolDisplay({
  status,
  toolName,
  args,
}: {
  status: ToolDisplayStatus;
  toolName: string;
  args: Record<string, unknown> | undefined;
}): ToolDisplayResult | undefined {
  return {
    kind: 'generic',
    status,
    toolName,
    summaryTitle: formatToolExecutionSummary(status, toolName, args),
    icon: getToolDisplayIcon(toolName),
    metricsPlacement: 'inline',
  };
}

export function createFileChangeDisplayFromDetails({
  status,
  toolName,
  details,
}: {
  status: ToolDisplayStatus;
  toolName: string;
  details: unknown;
}): ToolDisplayResult | undefined {
  if (!isFileChangeDetails(details)) return undefined;
  const detail = status === 'error' ? undefined : createFileChangeDiffDetail(details);
  const displayPath = details.displayPath ?? details.path;
  const summaryArgs = { path: displayPath };
  return {
    kind: 'file_change',
    status,
    toolName,
    icon: 'edit',
    detail,
    metrics: createChangeMetrics(details.additions, details.deletions),
    metricsPlacement: 'end',
    detailLabel: '文件变更',
    detailTarget: displayPath,
    summaryTitle: formatToolExecutionSummary(status, toolName, summaryArgs),
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
  const displayPath = fileEdit.displayPath ?? fileEdit.path;
  const actionLabel = getToolActionLabel(toolName, { path: displayPath });

  return {
    kind: 'file_edit',
    status,
    toolName,
    icon: 'edit',
    path: displayPath,
    additions: fileEdit.additions,
    deletions: fileEdit.deletions,
    metrics: previewError ? undefined : createChangeMetrics(fileEdit.additions, fileEdit.deletions),
    metricsPlacement: 'end',
    detailLabel: toolName === 'write' ? '写入差异' : '编辑差异',
    detailTarget: displayPath,
    summaryTitle: previewError
      ? `预览失败 ${actionLabel ?? `${toolName} ${fileEdit.path}`}`
      : formatToolExecutionSummary(status, toolName, { path: displayPath }),
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
  if (kind === 'read') return `已阅读 ${count} 个文件`;
  if (kind === 'search') return `已搜索 ${count} 次`;
  if (kind === 'list') return `已列出 ${count} 次`;
  return `处理了 ${count} 项`;
}

export function formatMixedToolActivitySummaryLabel(count: number): string {
  return `已完成 ${count} 项`;
}

function isFileChangeDetails(value: unknown): value is ScoutFileChangeDetails {
  if (!value || typeof value !== 'object') return false;
  const details = value as Partial<ScoutFileChangeDetails>;
  return (
    details.kind === 'file_change' &&
    typeof details.path === 'string' &&
    typeof details.additions === 'number' &&
    typeof details.deletions === 'number'
  );
}

function createChangeMetrics(
  additions: number,
  deletions: number,
): ToolDisplayMetric[] | undefined {
  const metrics: ToolDisplayMetric[] = [];
  if (additions > 0) {
    metrics.push({ key: 'additions', value: additions, prefix: '+', tone: 'added' });
  }
  if (deletions > 0) {
    metrics.push({ key: 'deletions', value: deletions, prefix: '-', tone: 'deleted' });
  }
  return metrics.length > 0 ? metrics : undefined;
}

function createFileChangeDiffDetail(
  details: ScoutFileChangeDetails,
): ToolDisplayResult['detail'] | undefined {
  const preview = details.diffPreview;
  if (!preview) return undefined;
  const diffLines = preview.rows.map(formatFileChangeDiffPreviewRow);
  const unavailableReason = preview.unavailableReason?.trim();
  if (preview.truncated) {
    diffLines.push(FILE_CHANGE_DIFF_PREVIEW_TRUNCATED_LINE);
  }
  if (unavailableReason && diffLines.length > 0) {
    diffLines.push(`… ${unavailableReason}`);
  }
  if (diffLines.length === 0 && !unavailableReason) return undefined;
  const displayPath = details.displayPath ?? details.path;
  return {
    kind: 'diff',
    path: displayPath,
    diffText: diffLines.join('\n'),
    additions: details.additions,
    deletions: details.deletions,
    previewError: diffLines.length === 0 ? unavailableReason : undefined,
  };
}

function formatFileChangeDiffPreviewRow(row: ScoutChangesReviewRow): string {
  if (row.type === 'fold') {
    return `… ${row.count ?? 0} unmodified ${(row.count ?? 0) === 1 ? 'line' : 'lines'}`;
  }
  const marker = row.type === 'added' ? '+' : row.type === 'removed' ? '-' : ' ';
  const lineNumber = row.type === 'removed' ? row.oldLineNumber : row.newLineNumber;
  return `${marker}${lineNumber ?? ''} ${row.text ?? ''}`;
}

export function formatToolExecutionSummary(
  status: ToolDisplayStatus,
  toolName: string,
  args: Record<string, unknown> | undefined,
): string {
  if (toolName === 'bash') {
    const command = getFirstArgText(args, ['command', 'cmd', 'script']) || '命令';
    return `${getCommandStatusPrefix(status)} ${command}`;
  }

  const actionLabel = getToolActionLabel(toolName, args);
  if (!actionLabel) return `${getCommandStatusPrefix(status)} ${toolName}`;
  return formatActionStatusSummary(status, actionLabel);
}

function getToolActionLabel(
  toolName: string,
  args: Record<string, unknown> | undefined,
): string | undefined {
  const target = getFirstArgText(args, ['path', 'filePath', 'file', 'target', 'cwd', 'directory']);
  const pattern = getFirstArgText(args, ['pattern', 'query', 'regex', 'term']);

  if (toolName === 'read') return target ? `阅读 ${target}` : '阅读文件';
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
  return undefined;
}

function formatActionStatusSummary(status: ToolDisplayStatus, actionLabel: string): string {
  if (status === 'running' || status === 'pending') return `正在${actionLabel}`;
  if (status === 'done') return `已${actionLabel}`;

  const { target, verb } = splitActionLabel(actionLabel);
  if (status === 'error') return target ? `${verb}失败 ${target}` : `${actionLabel}失败`;
  if (status === 'stopped') return target ? `已停止${verb} ${target}` : `已停止${actionLabel}`;
  return `正在${actionLabel}`;
}

function splitActionLabel(actionLabel: string): { target: string; verb: string } {
  const trimmed = actionLabel.trim();
  const firstSpaceIndex = trimmed.indexOf(' ');
  if (firstSpaceIndex < 0) return { target: '', verb: trimmed };
  return {
    target: trimmed.slice(firstSpaceIndex + 1).trim(),
    verb: trimmed.slice(0, firstSpaceIndex).trim(),
  };
}

function getCommandStatusPrefix(status: ToolDisplayStatus): string {
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
