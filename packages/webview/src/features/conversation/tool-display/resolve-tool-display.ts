// ============================================================
// Tool Display Resolver — 工具事件到展示模型投影
// ============================================================

import { resultToText, contentToText } from './content';
import { formatArgs } from './helpers';
import { presentGenericTool, TOOL_DISPLAY_PRESENTERS } from './presenters';
import type {
  CreateToolDisplayContextOptions,
  ResolveToolDisplayOptions,
  ToolDisplayContext,
  ToolDisplayResult,
} from './types';

export function resolveToolDisplayResult({
  toolCall,
  runtime,
  toolResult,
  assistantErrorMessage,
  assistantStopReason,
}: ResolveToolDisplayOptions): ToolDisplayResult {
  const toolName = toolResult?.toolName ?? runtime?.toolName ?? toolCall.name;
  const args =
    runtime?.displayArgs ?? toolCall.displayArguments ?? runtime?.args ?? toolCall.arguments;
  const context = createToolDisplayContext({
    toolName,
    args,
    runtime,
    toolResult,
    assistantErrorMessage,
    assistantStopReason,
  });
  const presenter = TOOL_DISPLAY_PRESENTERS[toolName] ?? presentGenericTool;
  return presenter(context) ?? presentGenericTool(context);
}

function createToolDisplayContext({
  toolName,
  args,
  runtime,
  toolResult,
  assistantErrorMessage,
  assistantStopReason,
}: CreateToolDisplayContextOptions): ToolDisplayContext {
  const argsText = formatArgs(args);

  if (toolResult) {
    return {
      toolName,
      args,
      argsText,
      status: toolResult.isError ? 'error' : 'done',
      bodyText: contentToText(toolResult.content),
      isError: toolResult.isError,
      completionLabel: toolResult.isError ? '失败' : '成功',
      details: toolResult.details,
    };
  }

  if (runtime?.result) {
    return {
      toolName,
      args,
      argsText,
      status: runtime.isError ? 'error' : 'done',
      bodyText: resultToText(runtime.result),
      isError: runtime.isError,
      completionLabel: runtime.isError ? '失败' : '成功',
      details: runtime.result.details,
    };
  }

  if (assistantStopReason === 'aborted') {
    return {
      toolName,
      args,
      argsText,
      status: 'stopped',
      bodyText: '',
      isError: false,
      completionLabel: '已停止',
    };
  }

  if (assistantStopReason === 'error') {
    return {
      toolName,
      args,
      argsText,
      status: 'error',
      bodyText: assistantErrorMessage ?? '',
      isError: true,
      completionLabel: '失败',
    };
  }

  if (runtime?.partialResult) {
    return {
      toolName,
      args,
      argsText,
      status: 'running',
      bodyText: resultToText(runtime.partialResult),
      isError: false,
      completionLabel: '',
      details: runtime.partialResult.details,
    };
  }

  return {
    toolName,
    args,
    argsText,
    status: runtime ? 'running' : 'pending',
    bodyText: '',
    isError: false,
    completionLabel: '',
  };
}
