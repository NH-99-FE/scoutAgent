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
import { createSyntheticSourceInfo, type SourceInfo } from '../source-info.ts';

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

export interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: AgentTool['parameters'];
  promptSnippet?: AgentTool['promptSnippet'];
  promptGuidelines?: AgentTool['promptGuidelines'];
  prepareArguments?: AgentTool['prepareArguments'];
  executionMode?: AgentTool['executionMode'];
}

export interface ToolDefinitionEntry {
  definition: ToolDefinition;
  sourceInfo: SourceInfo;
}

function createToolByName(name: ToolName, cwd: string, options?: ToolsOptions): AgentTool {
  switch (name) {
    case 'read':
      return createReadTool(cwd, options?.read);
    case 'bash':
      return createBashTool(cwd, options?.bash);
    case 'edit':
      return createEditTool(cwd, options?.edit);
    case 'write':
      return createWriteTool(cwd, options?.write);
    case 'grep':
      return createGrepTool(cwd, options?.grep);
    case 'find':
      return createFindTool(cwd, options?.find);
    case 'ls':
      return createLsTool(cwd, options?.ls);
    default:
      throw new Error(`Unknown tool name: ${name}`);
  }
}

function extractToolDefinition(tool: AgentTool): ToolDefinition {
  return {
    name: tool.name as ToolName,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    promptSnippet: tool.promptSnippet,
    promptGuidelines: tool.promptGuidelines,
    prepareArguments: tool.prepareArguments,
    executionMode: tool.executionMode,
  };
}

export function createBuiltinToolDefinitionEntries(
  cwd: string,
  toolNames: ToolName[],
  options?: ToolsOptions,
): ToolDefinitionEntry[] {
  return toolNames.map((name) => {
    const tool = createToolByName(name, cwd, options);
    return {
      definition: extractToolDefinition(tool),
      sourceInfo: createSyntheticSourceInfo(`<builtin:${name}>`, { source: 'builtin' }),
    };
  });
}

export const BUILTIN_TOOL_DEFINITION_ENTRIES: ReadonlyMap<ToolName, ToolDefinitionEntry> = new Map(
  createBuiltinToolDefinitionEntries('', Array.from(ALL_TOOL_NAMES)).map((entry) => [
    entry.definition.name as ToolName,
    entry,
  ]),
);

/** 从工具名列表创建 AgentTool[] */
export function createTools(
  cwd: string,
  toolNames: ToolName[],
  options?: ToolsOptions,
): AgentTool[] {
  return toolNames.map((name) => createToolByName(name, cwd, options));
}

/** 创建默认活跃工具集 */
export function createDefaultTools(cwd: string, options?: ToolsOptions): AgentTool[] {
  return createTools(cwd, DEFAULT_ACTIVE_TOOL_NAMES, options);
}
