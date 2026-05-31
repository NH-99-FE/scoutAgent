// ============================================================
// Ls 工具测试
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { createLsTool, type LsOperations } from '../../tools/ls.ts';

function makeLsOps(overrides: Partial<LsOperations> = {}): LsOperations {
  return {
    exists: vi.fn(async () => true),
    stat: vi.fn(async () => ({ isDirectory: () => true })),
    readdir: vi.fn(async () => ['file1.txt', 'file2.ts', 'subdir']),
    ...overrides,
  };
}

describe('createLsTool', () => {
  it('returns tool with name "ls"', () => {
    const tool = createLsTool('/test', { operations: makeLsOps() });
    expect(tool.name).toBe('ls');
    expect(tool.label).toBe('ls');
  });

  it('lists directory entries', async () => {
    const ops = makeLsOps({
      stat: vi.fn(async (p: string) => ({
        // 目录本身和 subdir 条目都是目录
        isDirectory: () => p.endsWith('subdir') || !p.includes('.'),
      })),
    });
    const tool = createLsTool('/test', { operations: ops });
    const result = await tool.execute('tc1', { path: '.' });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('file1.txt');
    expect(text).toContain('file2.ts');
    expect(text).toContain('subdir/');
  });

  it('throws on non-existent path', async () => {
    const ops = makeLsOps({ exists: vi.fn(async () => false) });
    const tool = createLsTool('/test', { operations: ops });
    await expect(tool.execute('tc1', { path: '/missing' })).rejects.toThrow(/not found/i);
  });

  it('throws on non-directory path', async () => {
    const ops = makeLsOps({ stat: vi.fn(async () => ({ isDirectory: () => false })) });
    const tool = createLsTool('/test', { operations: ops });
    await expect(tool.execute('tc1', { path: 'file.txt' })).rejects.toThrow(/not a directory/i);
  });

  it('respects entry limit', async () => {
    const ops = makeLsOps({
      readdir: vi.fn(async () => Array.from({ length: 100 }, (_, i) => `file${i}.txt`)),
      stat: vi.fn(async () => ({ isDirectory: () => false })),
    });
    // stat 需要对目录路径返回 isDirectory=true
    const origStat = ops.stat as ReturnType<typeof vi.fn>;
    origStat.mockImplementation(async (p: string) => ({
      isDirectory: () => !p.includes('file'),
    }));
    const tool = createLsTool('/test', { operations: ops });
    const result = await tool.execute('tc1', { path: '.', limit: 3 });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    // Should have 3 entries + limit notice
    expect(text).toContain('3 entries limit reached');
  });

  it('returns empty directory message', async () => {
    const ops = makeLsOps({ readdir: vi.fn(async () => []) });
    const tool = createLsTool('/test', { operations: ops });
    const result = await tool.execute('tc1', { path: '.' });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toBe('(empty directory)');
  });

  it('handles abort signal', async () => {
    const ops = makeLsOps();
    const tool = createLsTool('/test', { operations: ops });
    const controller = new AbortController();
    controller.abort();
    await expect(tool.execute('tc1', { path: '.' }, controller.signal)).rejects.toThrow(/aborted/i);
  });
});
