import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALL_TOOL_NAMES,
  createAllToolDefinitions,
  createBuiltinToolDefinitionEntries,
  createDefaultTools,
  createToolDefinition,
  createTools,
  DEFAULT_ACTIVE_TOOL_NAMES,
} from '../../src/core/tools/index.ts';

describe('builtin tools', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-tools-test-'));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('creates definition entries for requested built-in tools with builtin source info', () => {
    const entries = createBuiltinToolDefinitionEntries(cwd, ['read', 'write']);

    expect(entries.map((entry) => entry.definition.name)).toEqual(['read', 'write']);
    expect(entries.every((entry) => entry.sourceInfo.source === 'builtin')).toBe(true);
    expect(entries.every((entry) => typeof entry.definition.execute === 'function')).toBe(true);
  });

  it('creates built-in tool definitions before wrapping them as AgentTools', () => {
    const definition = createToolDefinition('edit', cwd);
    const [tool] = createTools(cwd, ['edit']);

    expect(definition.name).toBe('edit');
    expect(definition.promptSnippet).toBe('Edit files with exact text replacement');
    expect(definition.prepareArguments).toBeTypeOf('function');
    expect(tool?.name).toBe(definition.name);
    expect(tool?.promptSnippet).toBe(definition.promptSnippet);
    expect(tool?.prepareArguments).toBe(definition.prepareArguments);
  });

  it('uses the Pi-style default active tool set', () => {
    expect(DEFAULT_ACTIVE_TOOL_NAMES).toEqual(['read', 'bash', 'edit', 'write']);
    expect(createDefaultTools(cwd).map((tool) => tool.name)).toEqual(DEFAULT_ACTIVE_TOOL_NAMES);
  });

  it('creates all registered tool names without changing the registry order contract', () => {
    const names = Array.from(ALL_TOOL_NAMES);
    const tools = createTools(cwd, names);

    expect(tools.map((tool) => tool.name)).toEqual(names);
  });

  it('creates all built-in tool definitions without wrapping metadata loss', () => {
    const definitions = createAllToolDefinitions(cwd);

    expect(Object.keys(definitions)).toEqual(Array.from(ALL_TOOL_NAMES));
    expect(definitions.read.promptGuidelines).toEqual([
      'Use read to examine files instead of cat or sed.',
    ]);
    expect(definitions.write.promptGuidelines).toEqual([
      'Use write only for new files or complete rewrites.',
    ]);
  });
});
