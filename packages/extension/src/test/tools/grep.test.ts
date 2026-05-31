/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================
// Grep 工具测试
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { createGrepTool, type GrepOperations } from '../../tools/grep.ts';

// 注意：grep 工具依赖外部 ripgrep (rg) 命令。
// 这些测试验证工具的基本结构，rg 相关测试需要系统安装 rg。

function makeGrepOps(overrides: Partial<GrepOperations> = {}): GrepOperations {
  return {
    isDirectory: vi.fn(async () => true),
    readFile: vi.fn(async () => 'line content'),
    ...overrides,
  };
}

describe('createGrepTool', () => {
  it('returns tool with name "grep"', () => {
    const tool = createGrepTool('/test', { operations: makeGrepOps() });
    expect(tool.name).toBe('grep');
    expect(tool.label).toBe('grep');
  });

  it('has description mentioning ripgrep', () => {
    const tool = createGrepTool('/test');
    expect(tool.description).toContain('Search file contents');
  });

  it('has correct parameter schema', () => {
    const tool = createGrepTool('/test');
    const schema = tool.parameters as any;
    expect(schema.properties).toBeDefined();
    expect(schema.properties.pattern).toBeDefined();
    expect(schema.properties.glob).toBeDefined();
    expect(schema.properties.ignoreCase).toBeDefined();
    expect(schema.properties.literal).toBeDefined();
    expect(schema.properties.context).toBeDefined();
    expect(schema.properties.limit).toBeDefined();
  });

  it('rejects on abort signal', async () => {
    const tool = createGrepTool('/test', { operations: makeGrepOps() });
    const controller = new AbortController();
    controller.abort();
    await expect(tool.execute('tc1', { pattern: 'test' }, controller.signal)).rejects.toThrow(
      /aborted/i,
    );
  });

  it('rejects when path not found', async () => {
    const ops = makeGrepOps({
      isDirectory: vi.fn(async () => {
        throw new Error('not found');
      }),
    });
    const tool = createGrepTool('/test', { operations: ops });
    await expect(tool.execute('tc1', { pattern: 'test', path: '/missing' })).rejects.toThrow(
      /not found/i,
    );
  });
});
