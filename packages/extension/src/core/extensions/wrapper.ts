// ============================================================
// 工具包装 — RegisteredTool → AgentTool
// 在 execute 中注入 ScoutExtensionContext
// ============================================================

import type { AgentTool } from '@scout-agent/agent';
import { wrapToolDefinition, wrapToolDefinitions } from '../tools/tool-definition-wrapper.ts';
import type { RegisteredTool } from './types.ts';
import type { ScoutExtensionRunner } from './runner.ts';

/**
 * 将扩展注册的 ToolDefinition 包装为 AgentTool。
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
  return wrapToolDefinitions(
    registeredTools.map((tool) => tool.definition),
    () => runner.createContext(),
  );
}
