// ============================================================
// 工具包装 — RegisteredTool → AgentTool
// 在 execute 中注入 ScoutExtensionContext
// ============================================================

import type { TSchema } from '@sinclair/typebox';
import type { AgentTool } from '@scout-agent/agent';
import type { ScoutExtensionContext, RegisteredTool, ScoutToolDefinition } from './types.ts';
import type { ScoutExtensionRunner } from './runner.ts';

/**
 * 将 ScoutToolDefinition 包装为 AgentTool。
 * execute 内注入 ScoutExtensionContext（通过 runner.createContext()）。
 */
export function wrapRegisteredTool(
  registeredTool: RegisteredTool,
  runner: ScoutExtensionRunner,
): AgentTool {
  return wrapToolDefinition(registeredTool.definition, () => runner.createContext());
}

/**
 * 将多个 RegisteredTool 批量包装为 AgentTool[]。
 */
export function wrapRegisteredTools(
  registeredTools: RegisteredTool[],
  runner: ScoutExtensionRunner,
): AgentTool[] {
  return registeredTools.map((tool) => wrapRegisteredTool(tool, runner));
}

/**
 * 将 ScoutToolDefinition 包装为 AgentTool。
 * ctxFactory 在 execute 调用时惰性求值，确保上下文是最新的。
 */
function wrapToolDefinition<TDetails = unknown>(
  definition: ScoutToolDefinition<TSchema, TDetails>,
  ctxFactory?: () => ScoutExtensionContext,
): AgentTool<any, TDetails> {
  return {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: definition.parameters,
    prepareArguments: definition.prepareArguments,
    executionMode: definition.executionMode,
    execute: (toolCallId, params, signal, onUpdate) =>
      definition.execute(toolCallId, params, signal, onUpdate, ctxFactory?.()),
  };
}
