// ============================================================
// 工具工厂 — Pi-style ToolDefinition-first registry
// ============================================================

import type { AgentTool } from '@scout-agent/agent';
import type { ToolDefinition } from '../extensions/types.ts';
import { type ReadToolOptions, createReadToolDefinition } from './read.ts';
import { type BashToolOptions, createBashToolDefinition } from './bash.ts';
import { type EditToolOptions, createEditToolDefinition } from './edit.ts';
import { type WriteToolOptions, createWriteToolDefinition } from './write.ts';
import { type GrepToolOptions, createGrepToolDefinition } from './grep.ts';
import { type FindToolOptions, createFindToolDefinition } from './find.ts';
import { type LsToolOptions, createLsToolDefinition } from './ls.ts';
import { wrapToolDefinition } from './tool-definition-wrapper.ts';
import { createSyntheticSourceInfo, type SourceInfo } from '../source-info.ts';
import {
  BUILTIN_TOOL_NAMES,
  BUILTIN_TOOL_PROFILES,
  type BuiltinToolName,
} from './tool-profiles.ts';

export type ToolName = BuiltinToolName;

export const ALL_TOOL_NAMES: Set<ToolName> = new Set(BUILTIN_TOOL_NAMES);

/** 默认活跃工具集 */
export const DEFAULT_ACTIVE_TOOL_NAMES: ToolName[] = [
  ...(BUILTIN_TOOL_PROFILES[0].tools as readonly ToolName[]),
];

export interface ToolsOptions {
  read?: ReadToolOptions;
  bash?: BashToolOptions;
  write?: WriteToolOptions;
  edit?: EditToolOptions;
  grep?: GrepToolOptions;
  find?: FindToolOptions;
  ls?: LsToolOptions;
}

export type ToolDef = ToolDefinition;

export interface ToolDefinitionEntry {
  definition: ToolDefinition;
  sourceInfo: SourceInfo;
}

export function createToolDefinition(name: ToolName, cwd: string, options?: ToolsOptions): ToolDef {
  switch (name) {
    case 'read':
      return createReadToolDefinition(cwd, options?.read);
    case 'bash':
      return createBashToolDefinition(cwd, options?.bash);
    case 'edit':
      return createEditToolDefinition(cwd, options?.edit);
    case 'write':
      return createWriteToolDefinition(cwd, options?.write);
    case 'grep':
      return createGrepToolDefinition(cwd, options?.grep);
    case 'find':
      return createFindToolDefinition(cwd, options?.find);
    case 'ls':
      return createLsToolDefinition(cwd, options?.ls);
    default:
      throw new Error(`Unknown tool name: ${name}`);
  }
}

export function createTool(name: ToolName, cwd: string, options?: ToolsOptions): AgentTool {
  return wrapToolDefinition(createToolDefinition(name, cwd, options));
}

export function createBuiltinToolDefinitionEntries(
  cwd: string,
  toolNames: ToolName[],
  options?: ToolsOptions,
): ToolDefinitionEntry[] {
  return toolNames.map((name) => {
    return {
      definition: createToolDefinition(name, cwd, options),
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

export function createTools(
  cwd: string,
  toolNames: ToolName[],
  options?: ToolsOptions,
): AgentTool[] {
  return toolNames.map((name) => createTool(name, cwd, options));
}

export function createAllToolDefinitions(
  cwd: string,
  options?: ToolsOptions,
): Record<ToolName, ToolDef> {
  return {
    read: createReadToolDefinition(cwd, options?.read),
    bash: createBashToolDefinition(cwd, options?.bash),
    edit: createEditToolDefinition(cwd, options?.edit),
    write: createWriteToolDefinition(cwd, options?.write),
    grep: createGrepToolDefinition(cwd, options?.grep),
    find: createFindToolDefinition(cwd, options?.find),
    ls: createLsToolDefinition(cwd, options?.ls),
  };
}

/** 创建默认活跃工具集 */
export function createDefaultTools(cwd: string, options?: ToolsOptions): AgentTool[] {
  return createTools(cwd, DEFAULT_ACTIVE_TOOL_NAMES, options);
}
