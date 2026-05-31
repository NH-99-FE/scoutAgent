// ============================================================
// Write 工具测试
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { createWriteTool, type WriteOperations } from '../../tools/write.ts';

function makeWriteOps(overrides: Partial<WriteOperations> = {}): WriteOperations {
  return {
    writeFile: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('createWriteTool', () => {
  it('returns tool with name "write"', () => {
    const tool = createWriteTool('/test', { operations: makeWriteOps() });
    expect(tool.name).toBe('write');
    expect(tool.label).toBe('write');
  });

  it('writes content to file', async () => {
    const ops = makeWriteOps();
    const tool = createWriteTool('/test', { operations: ops });
    const result = await tool.execute('tc1', { path: 'file.txt', content: 'hello' });
    expect(ops.writeFile).toHaveBeenCalledWith(expect.stringContaining('file.txt'), 'hello');
    expect(ops.mkdir).toHaveBeenCalled();
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Successfully wrote');
    expect(text).toContain('5 bytes');
  });

  it('creates parent directories', async () => {
    const ops = makeWriteOps();
    const tool = createWriteTool('/test', { operations: ops });
    await tool.execute('tc1', { path: 'sub/dir/file.txt', content: 'test' });
    expect(ops.mkdir).toHaveBeenCalledWith(expect.stringContaining('sub'));
  });

  it('handles abort signal', async () => {
    const ops = makeWriteOps();
    const tool = createWriteTool('/test', { operations: ops });
    const controller = new AbortController();
    controller.abort();
    await expect(
      tool.execute('tc1', { path: 'file.txt', content: 'test' }, controller.signal),
    ).rejects.toThrow(/aborted/i);
  });

  it('handles write error', async () => {
    const ops = makeWriteOps({
      writeFile: vi.fn(async () => {
        throw new Error('disk full');
      }),
    });
    const tool = createWriteTool('/test', { operations: ops });
    await expect(tool.execute('tc1', { path: 'file.txt', content: 'test' })).rejects.toThrow(
      'disk full',
    );
  });
});
