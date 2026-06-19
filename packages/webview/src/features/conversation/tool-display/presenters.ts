// ============================================================
// Tool Display Presenters — 各工具展示策略
// ============================================================

import { countContentLines, splitContentLines } from './content';
import {
  createFileEditDisplayFromDetails,
  createFileEditDisplayFromPreview,
  createGenericDisplay,
  formatBashDetailText,
  formatDefaultDetailText,
  formatToolExecutionSummary,
  getToolDisplayIcon,
} from './helpers';
import type {
  FileWriteToolDisplayResult,
  ToolDisplayContext,
  ToolDisplayPresenter,
  ToolDisplayResult,
} from './types';

export const TOOL_DISPLAY_PRESENTERS: Record<string, ToolDisplayPresenter> = {
  bash: presentBashTool,
  edit: presentEditTool,
  find: presentFindTool,
  grep: presentGrepTool,
  ls: presentLsTool,
  read: presentReadTool,
  write: presentWriteTool,
};

export function presentGenericTool(context: ToolDisplayContext): ToolDisplayResult {
  return createGenericDisplay(context, {
    detailTitle: '详情',
    detailText: formatDefaultDetailText(context),
  });
}

function presentBashTool(context: ToolDisplayContext): ToolDisplayResult {
  return createGenericDisplay(context, {
    detailTitle: 'Shell',
    detailText: formatBashDetailText(context),
  });
}

function presentReadTool(context: ToolDisplayContext): ToolDisplayResult {
  return createGenericDisplay(context, {
    detailTitle: '错误',
    detailText: context.isError && context.bodyText.trim() ? `错误\n${context.bodyText}` : '',
  });
}

function presentEditTool(context: ToolDisplayContext): ToolDisplayResult | undefined {
  const detailsDisplay = createFileEditDisplayFromDetails({
    status: context.status,
    toolName: context.toolName,
    args: context.args,
    details: context.details,
  });
  if (detailsDisplay) return detailsDisplay;

  if (
    context.preview?.preview.kind === 'file_edit' &&
    context.status !== 'done' &&
    context.status !== 'error'
  ) {
    return createFileEditDisplayFromPreview({
      status: context.status,
      toolName: context.toolName,
      preview: context.preview,
    });
  }

  return undefined;
}

function presentGrepTool(context: ToolDisplayContext): ToolDisplayResult {
  return createGenericDisplay(context, {
    detailTitle: context.isError ? '错误' : '搜索结果',
    detailText: formatDefaultDetailText(context),
  });
}

function presentFindTool(context: ToolDisplayContext): ToolDisplayResult {
  return createGenericDisplay(context, {
    detailTitle: context.isError ? '错误' : '查找结果',
    detailText: formatDefaultDetailText(context),
  });
}

function presentLsTool(context: ToolDisplayContext): ToolDisplayResult {
  return createGenericDisplay(context, {
    detailTitle: context.isError ? '错误' : '目录内容',
    detailText: formatDefaultDetailText(context),
  });
}

function presentWriteTool(context: ToolDisplayContext): FileWriteToolDisplayResult {
  const path = getStringArg(context.args, ['path', 'filePath', 'file', 'target']) || '文件';
  const content = getRawStringArg(context.args, 'content');
  const lines = splitContentLines(content);
  const lineCount = countContentLines(content);
  const errorText = context.isError && context.bodyText.trim() ? context.bodyText : undefined;
  return {
    kind: 'file_write',
    status: context.status,
    toolName: context.toolName,
    icon: getToolDisplayIcon(context.toolName),
    path,
    lineCount,
    metrics: [{ key: 'line_count', value: lineCount, prefix: '+', tone: 'added' }],
    metricsPlacement: 'inline',
    detail:
      content.length > 0 || errorText
        ? {
            kind: 'write_content',
            contentText: content,
            lines,
            errorText,
          }
        : undefined,
    detailLabel: '写入内容',
    detailTarget: path,
    summaryTitle: formatToolExecutionSummary(context.status, context.toolName, context.args),
  };
}

function getStringArg(args: Record<string, unknown> | undefined, keys: string[]): string {
  if (!args) return '';
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function getRawStringArg(args: Record<string, unknown> | undefined, key: string): string {
  if (!args) return '';
  const value = args[key];
  return typeof value === 'string' ? value : '';
}
