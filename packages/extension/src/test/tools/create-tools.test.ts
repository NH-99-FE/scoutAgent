// ============================================================
// create-tools 测试
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  BUILTIN_TOOL_DEFINITION_ENTRIES,
  createTools,
  createDefaultTools,
  createBuiltinToolDefinitionEntries,
  DEFAULT_ACTIVE_TOOL_NAMES,
  ALL_TOOL_NAMES,
  type ToolName,
} from '../../tools/create-tools.ts';

describe('DEFAULT_ACTIVE_TOOL_NAMES', () => {
  it('includes read, bash, edit, write', () => {
    expect(DEFAULT_ACTIVE_TOOL_NAMES).toEqual(['read', 'bash', 'edit', 'write']);
  });
});

describe('ALL_TOOL_NAMES', () => {
  it('contains all 7 tool names', () => {
    expect(ALL_TOOL_NAMES.size).toBe(7);
    for (const name of ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as ToolName[]) {
      expect(ALL_TOOL_NAMES.has(name)).toBe(true);
    }
  });
});

describe('createTools', () => {
  it('creates specified tools', () => {
    const tools = createTools('/test', ['read', 'bash']);
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('read');
    expect(tools[1].name).toBe('bash');
  });

  it('creates all tools', () => {
    const tools = createTools('/test', ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']);
    expect(tools).toHaveLength(7);
    const names = tools.map((t) => t.name);
    expect(names).toEqual(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']);
  });

  it('throws on unknown tool name', () => {
    expect(() => createTools('/test', ['unknown' as ToolName])).toThrow('Unknown tool name');
  });

  it('creates tools with empty list', () => {
    const tools = createTools('/test', []);
    expect(tools).toHaveLength(0);
  });

  it('preserves tool order', () => {
    const tools = createTools('/test', ['write', 'read']);
    expect(tools[0].name).toBe('write');
    expect(tools[1].name).toBe('read');
  });
});

describe('BUILTIN_TOOL_DEFINITION_ENTRIES', () => {
  it('keeps sourceInfo outside tool definitions', () => {
    const entries = createBuiltinToolDefinitionEntries('/test', ['read', 'bash']);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      definition: { name: 'read', label: 'read' },
      sourceInfo: { path: '<builtin:read>', source: 'builtin' },
    });
    expect(entries[1]).toMatchObject({
      definition: { name: 'bash', label: 'bash' },
      sourceInfo: { path: '<builtin:bash>', source: 'builtin' },
    });
    expect(entries[0].definition.parameters).toBeDefined();
    expect(entries[0].definition).not.toHaveProperty('sourceInfo');
  });

  it('contains every builtin tool definition entry', () => {
    expect(BUILTIN_TOOL_DEFINITION_ENTRIES.size).toBe(ALL_TOOL_NAMES.size);
    for (const name of ALL_TOOL_NAMES) {
      expect(BUILTIN_TOOL_DEFINITION_ENTRIES.get(name)?.definition.name).toBe(name);
    }
  });
});

describe('createDefaultTools', () => {
  it('creates default active tools', () => {
    const tools = createDefaultTools('/test');
    expect(tools).toHaveLength(4);
    const names = tools.map((t) => t.name);
    expect(names).toEqual(DEFAULT_ACTIVE_TOOL_NAMES);
  });
});
