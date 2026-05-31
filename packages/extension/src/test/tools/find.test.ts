// ============================================================
// Find 工具测试
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { createFindTool, type FindOperations } from '../../tools/find.ts';

// 注意：find 工具依赖外部 fd 命令。
// 这些测试验证工具的基本结构和自定义 glob 分支。

function makeFindOps(overrides: Partial<FindOperations> = {}): FindOperations {
  return {
    exists: vi.fn(async () => true),
    glob: vi.fn(async () => ['src/index.ts', 'src/util.ts']),
    ...overrides,
  };
}

describe('createFindTool', () => {
  it('returns tool with name "find"', () => {
    const tool = createFindTool('/test', { operations: makeFindOps() });
    expect(tool.name).toBe('find');
    expect(tool.label).toBe('find');
  });

  it('has description mentioning file search', () => {
    const tool = createFindTool('/test');
    expect(tool.description).toContain('Search for files');
  });

  it('uses custom glob when provided', async () => {
    const ops = makeFindOps();
    const tool = createFindTool('/test', { operations: ops });
    const result = await tool.execute('tc1', { pattern: '*.ts' });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('index.ts');
    expect(ops.glob).toHaveBeenCalledWith('*.ts', expect.any(String), expect.any(Object));
  });

  it('returns "No files found" for empty glob result', async () => {
    const ops = makeFindOps({ glob: vi.fn(async () => []) });
    const tool = createFindTool('/test', { operations: ops });
    const result = await tool.execute('tc1', { pattern: '*.xyz' });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('No files found');
  });

  it('rejects on abort signal', async () => {
    const tool = createFindTool('/test', { operations: makeFindOps() });
    const controller = new AbortController();
    controller.abort();
    await expect(tool.execute('tc1', { pattern: '*.ts' }, controller.signal)).rejects.toThrow(
      /aborted/i,
    );
  });

  it('rejects when path not found', async () => {
    const ops = makeFindOps({ exists: vi.fn(async () => false) });
    const tool = createFindTool('/test', { operations: ops });
    await expect(tool.execute('tc1', { pattern: '*.ts', path: '/missing' })).rejects.toThrow(
      /not found/i,
    );
  });

  it('reports result limit reached', async () => {
    const manyFiles = Array.from({ length: 1000 }, (_, i) => `file${i}.ts`);
    const ops = makeFindOps({ glob: vi.fn(async () => manyFiles) });
    const tool = createFindTool('/test', { operations: ops });
    const result = await tool.execute('tc1', { pattern: '*.ts', limit: 1000 });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('1000 results limit reached');
  });
});
