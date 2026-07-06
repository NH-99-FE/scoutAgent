// ============================================================
// Tool Display Presenters — 各工具展示策略
// ============================================================

import {
  createFileChangeDisplayFromDetails,
  createFileEditDisplayFromPreview,
  createToolExecutionSummary,
  createGenericDisplay,
  createPathOnlyToolDisplay,
  formatBashDetailText,
  formatDefaultDetailText,
  getToolDisplayIcon,
} from './helpers';
import type { ToolDisplayContext, ToolDisplayPresenter, ToolDisplayResult } from './types';

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
  const fileChangeDisplay = createFileChangeDisplayFromDetails({
    status: context.status,
    toolName: context.toolName,
    details: context.details,
  });
  if (fileChangeDisplay) return fileChangeDisplay;

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

  if (
    context.status === 'pending' ||
    context.status === 'running' ||
    context.status === 'stopped'
  ) {
    return createPathOnlyToolDisplay({
      status: context.status,
      toolName: context.toolName,
      args: context.args,
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

function presentWriteTool(context: ToolDisplayContext): ToolDisplayResult {
  const fileChangeDisplay = createFileChangeDisplayFromDetails({
    status: context.status,
    toolName: context.toolName,
    details: context.details,
  });
  if (fileChangeDisplay) return fileChangeDisplay;

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

  const path = getStringArg(context.args, ['path', 'filePath', 'file', 'target']) || '文件';
  const errorText = context.isError && context.bodyText.trim() ? context.bodyText : undefined;
  return {
    kind: 'generic',
    status: context.status,
    toolName: context.toolName,
    icon: getToolDisplayIcon(context.toolName),
    metricsPlacement: 'inline',
    detail: errorText
      ? {
          kind: 'text',
          title: '错误',
          text: `错误\n${errorText}`,
          completionLabel: context.completionLabel,
        }
      : undefined,
    detailLabel: '工具输出',
    detailTarget: path,
    summary: createToolExecutionSummary(context.status, context.toolName, context.args),
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
