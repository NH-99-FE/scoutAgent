// ============================================================
// create-tools 测试
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  createTools,
  createDefaultTools,
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

describe('createDefaultTools', () => {
  it('creates default active tools', () => {
    const tools = createDefaultTools('/test');
    expect(tools).toHaveLength(4);
    const names = tools.map((t) => t.name);
    expect(names).toEqual(DEFAULT_ACTIVE_TOOL_NAMES);
  });
});
