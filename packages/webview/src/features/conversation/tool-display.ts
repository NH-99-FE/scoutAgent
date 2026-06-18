// ============================================================
// Tool Display — 工具调用过程的展示模型
// ============================================================

import type {
  ScoutContent,
  ScoutToolCallContent,
  ScoutToolExecutionResult,
  ScoutToolResultMessage,
} from '@scout-agent/shared';
import type { ToolCallPreviewState, ToolExecutionState } from '@/store/conversation-store';

export type ToolDisplayStatus = 'pending' | 'running' | 'done' | 'error';

interface ToolDisplayBase {
  status: ToolDisplayStatus;
  toolName: string;
  summaryTitle: string;
}

export interface GenericToolDisplayResult extends ToolDisplayBase {
  kind: 'generic';
  detailTitle: string;
  detailText: string;
  completionLabel: string;
}

export interface FileEditToolDisplayResult extends ToolDisplayBase {
  kind: 'file_edit';
  path: string;
  diffText: string;
  additions: number;
  deletions: number;
  previewError?: string;
}

export type ToolDisplayResult = GenericToolDisplayResult | FileEditToolDisplayResult;

export interface ResolveToolDisplayOptions {
  toolCall: ScoutToolCallContent;
  runtime?: ToolExecutionState;
  preview?: ToolCallPreviewState;
  toolResult?: ScoutToolResultMessage;
  assistantErrorMessage?: string;
  assistantStopReason?: string;
}

export function resolveToolDisplayResult({
  toolCall,
  runtime,
  preview,
  toolResult,
  assistantErrorMessage,
  assistantStopReason,
}: ResolveToolDisplayOptions): ToolDisplayResult {
  const toolName = toolResult?.toolName ?? runtime?.toolName ?? toolCall.name;
  const args = runtime?.args ?? toolCall.arguments;
  const argsText = formatArgs(args);

  if (toolResult) {
    const status = toolResult.isError ? 'error' : 'done';
    const fileEditDisplay = createFileEditDisplayFromDetails({
      status,
      toolName,
      args,
      details: toolResult.details,
    });
    if (fileEditDisplay) return fileEditDisplay;

    const bodyText = contentToText(toolResult.content);
    return createToolDisplay({
      status,
      toolName,
      args,
      argsText,
      bodyText,
      isError: toolResult.isError,
      completionLabel: toolResult.isError ? '失败' : '成功',
    });
  }

  if (runtime?.result) {
    const status = runtime.isError ? 'error' : 'done';
    const fileEditDisplay = createFileEditDisplayFromDetails({
      status,
      toolName,
      args,
      details: runtime.result.details,
    });
    if (fileEditDisplay) return fileEditDisplay;

    const bodyText = resultToText(runtime.result);
    return createToolDisplay({
      status,
      toolName,
      args,
      argsText,
      bodyText,
      isError: runtime.isError,
      completionLabel: runtime.isError ? '失败' : '成功',
    });
  }

  if (
    assistantErrorMessage &&
    (assistantStopReason === 'error' || assistantStopReason === 'aborted')
  ) {
    return createToolDisplay({
      status: 'error',
      toolName,
      args,
      argsText,
      bodyText: assistantErrorMessage,
      isError: true,
      completionLabel: '失败',
    });
  }

  if (preview?.preview.kind === 'file_edit' && toolName === 'edit') {
    const status: ToolDisplayStatus = runtime ? 'running' : 'pending';
    return createFileEditDisplayFromPreview({
      status,
      toolName,
      preview,
    });
  }

  const partialBodyText = runtime?.partialResult ? resultToText(runtime.partialResult) : '';
  if (runtime?.partialResult) {
    return createToolDisplay({
      status: 'running',
      toolName,
      args,
      argsText,
      bodyText: partialBodyText,
      isError: false,
      completionLabel: '',
    });
  }

  if (runtime) {
    return createToolDisplay({
      status: 'running',
      toolName,
      args,
      argsText,
      bodyText: '',
      isError: false,
      completionLabel: '',
    });
  }

  return createToolDisplay({
    status: 'pending',
    toolName,
    args,
    argsText,
    bodyText: '',
    isError: false,
    completionLabel: '',
  });
}

export function contentToText(content: string | ScoutContent[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((item) => {
      if (item.type === 'text') return item.text;
      if (item.type === 'thinking') return item.redacted ? '思考内容已隐藏' : item.thinking;
      if (item.type === 'toolCall') return item.name;
      return '[image]';
    })
    .filter(Boolean)
    .join('\n');
}

function createToolDisplay({
  status,
  toolName,
  args,
  argsText,
  bodyText,
  isError,
  completionLabel,
}: {
  status: ToolDisplayStatus;
  toolName: string;
  args: Record<string, unknown> | undefined;
  argsText: string;
  bodyText: string;
  isError: boolean;
  completionLabel: string;
}): ToolDisplayResult {
  return {
    kind: 'generic',
    status,
    toolName,
    summaryTitle: formatToolSummaryTitle(status, toolName, args),
    detailTitle: getToolDetailTitle(toolName),
    detailText: formatToolDetailText(toolName, args, argsText, bodyText, isError),
    completionLabel,
  };
}

function createFileEditDisplayFromDetails({
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
    path,
    diffText,
    additions: stats.additions,
    deletions: stats.deletions,
    summaryTitle: `${getToolStatusVerb(status, toolName)} ${path}`,
  };
}

function createFileEditDisplayFromPreview({
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
    path: fileEdit.path,
    diffText: fileEdit.diff ?? '',
    additions: fileEdit.additions,
    deletions: fileEdit.deletions,
    previewError,
    summaryTitle: `${verb} ${fileEdit.path}`,
  };
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

function resultToText(result: ScoutToolExecutionResult): string {
  return contentToText(result.content);
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

function getToolDetailTitle(toolName: string): string {
  if (toolName === 'bash') return 'Shell';
  return '详情';
}

function formatToolDetailText(
  toolName: string,
  args: Record<string, unknown> | undefined,
  argsText: string,
  bodyText: string,
  isError: boolean,
): string {
  const command = getFirstArgText(args, ['command', 'cmd', 'script']);
  if (toolName === 'bash' && command) {
    return [`$ ${command}`, bodyText].filter((part) => part.trim().length > 0).join('\n');
  }

  const parts: string[] = [];
  if (argsText) {
    parts.push(`参数\n${argsText}`);
  }
  if (bodyText.trim()) {
    parts.push(`${isError ? '错误' : '输出'}\n${bodyText}`);
  }
  return parts.join('\n\n');
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

function formatArgs(args: Record<string, unknown> | undefined): string {
  if (!args || Object.keys(args).length === 0) return '';
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return '';
  }
}
