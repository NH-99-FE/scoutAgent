// ============================================================
// 工具工厂 — 从工具名列表创建 AgentTool[]
// ============================================================

import type { AgentTool } from '@scout-agent/agent';
import { createReadTool, type ReadToolOptions } from './read.ts';
import { createBashTool, type BashToolOptions } from './bash.ts';
import { createEditTool, type EditToolOptions } from './edit.ts';
import { createWriteTool, type WriteToolOptions } from './write.ts';
import { createGrepTool, type GrepToolOptions } from './grep.ts';
import { createFindTool, type FindToolOptions } from './find.ts';
import { createLsTool, type LsToolOptions } from './ls.ts';

export type ToolName = 'read' | 'bash' | 'edit' | 'write' | 'grep' | 'find' | 'ls';

export const ALL_TOOL_NAMES: Set<ToolName> = new Set([
  'read',
  'bash',
  'edit',
  'write',
  'grep',
  'find',
  'ls',
]);

/** 默认活跃工具集 */
export const DEFAULT_ACTIVE_TOOL_NAMES: ToolName[] = ['read', 'bash', 'edit', 'write'];

export interface ToolsOptions {
  read?: ReadToolOptions;
  bash?: BashToolOptions;
  write?: WriteToolOptions;
  edit?: EditToolOptions;
  grep?: GrepToolOptions;
  find?: FindToolOptions;
  ls?: LsToolOptions;
}

/** 从工具名列表创建 AgentTool[] */
export function createTools(
  cwd: string,
  toolNames: ToolName[],
  options?: ToolsOptions,
): AgentTool[] {
  const tools: AgentTool[] = [];
  for (const name of toolNames) {
    switch (name) {
      case 'read':
        tools.push(createReadTool(cwd, options?.read));
        break;
      case 'bash':
        tools.push(createBashTool(cwd, options?.bash));
        break;
      case 'edit':
        tools.push(createEditTool(cwd, options?.edit));
        break;
      case 'write':
        tools.push(createWriteTool(cwd, options?.write));
        break;
      case 'grep':
        tools.push(createGrepTool(cwd, options?.grep));
        break;
      case 'find':
        tools.push(createFindTool(cwd, options?.find));
        break;
      case 'ls':
        tools.push(createLsTool(cwd, options?.ls));
        break;
      default:
        throw new Error(`Unknown tool name: ${name}`);
    }
  }
  return tools;
}

/** 创建默认活跃工具集 */
export function createDefaultTools(cwd: string, options?: ToolsOptions): AgentTool[] {
  return createTools(cwd, DEFAULT_ACTIVE_TOOL_NAMES, options);
}
