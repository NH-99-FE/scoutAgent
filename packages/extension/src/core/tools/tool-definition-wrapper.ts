// ============================================================
// 工具定义包装 — ToolDefinition → AgentTool
// ============================================================

import type { AgentTool } from '@scout-agent/agent';
import type { TSchema } from '@sinclair/typebox';
import type { ScoutExtensionContext, ToolDefinition } from '../extensions/types.ts';

/** 将 ToolDefinition 包装为 Agent runtime 可执行的 AgentTool。 */
export function wrapToolDefinition<TParams extends TSchema, TDetails = unknown>(
  definition: ToolDefinition<TParams, TDetails>,
  ctxFactory?: () => ScoutExtensionContext | undefined,
): AgentTool<TParams, TDetails> {
  const prepareArguments = definition.prepareArguments as AgentTool<
    TParams,
    TDetails
  >['prepareArguments'];

  return {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: definition.parameters,
    promptSnippet: definition.promptSnippet,
    promptGuidelines: definition.promptGuidelines,
    prepareArguments,
    executionMode: definition.executionMode,
    execute: (toolCallId, params, signal, onUpdate) =>
      definition.execute(toolCallId, params, signal, onUpdate, ctxFactory?.()),
  };
}

/** 批量包装 ToolDefinition。 */
export function wrapToolDefinitions(
  definitions: ToolDefinition[],
  ctxFactory?: () => ScoutExtensionContext | undefined,
): AgentTool[] {
  return definitions.map((definition) => wrapToolDefinition(definition, ctxFactory));
}

/**
 * 从 plain AgentTool 合成最小 ToolDefinition。
 * 仅用于兼容调用方直接提供 AgentTool 的场景；内建工具应优先暴露 create*ToolDefinition。
 */
export function createToolDefinitionFromAgentTool(
  tool: AgentTool<TSchema>,
): ToolDefinition<TSchema, unknown> {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    promptSnippet: tool.promptSnippet,
    promptGuidelines: tool.promptGuidelines,
    prepareArguments: tool.prepareArguments,
    executionMode: tool.executionMode,
    execute: async (toolCallId, params, signal, onUpdate) =>
      tool.execute(toolCallId, params, signal, onUpdate),
  };
}
