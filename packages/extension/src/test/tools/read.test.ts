// ============================================================
// Read 工具测试
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { createReadTool, type ReadOperations } from '../../tools/read.ts';

function makeReadOps(overrides: Partial<ReadOperations> = {}): ReadOperations {
  return {
    readFile: vi.fn(async () => Buffer.from('hello world\nline 2\nline 3')),
    access: vi.fn(async () => {}),
    detectImageMimeType: vi.fn(async () => null),
    ...overrides,
  };
}

describe('createReadTool', () => {
  it('returns tool with name "read"', () => {
    const tool = createReadTool('/test', { operations: makeReadOps() });
    expect(tool.name).toBe('read');
    expect(tool.label).toBe('read');
  });

  it('reads a text file', async () => {
    const ops = makeReadOps();
    const tool = createReadTool('/test', { operations: ops });
    const result = await tool.execute('tc1', { path: 'file.txt' });
    expect(result.content[0]).toEqual({
      type: 'text',
      text: expect.stringContaining('hello world'),
    });
  });

  it('does not guess image MIME from extension when custom detector is absent', async () => {
    const ops = makeReadOps({
      readFile: vi.fn(async () => Buffer.from('fake-image-data')),
      detectImageMimeType: undefined,
    });
    const tool = createReadTool('/test', { operations: ops });
    const result = await tool.execute('tc1', { path: 'photo.png' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: 'text', text: 'fake-image-data' });
  });

  it('respects custom detectImageMimeType', async () => {
    const ops = makeReadOps({
      detectImageMimeType: vi.fn(async () => 'image/custom'),
      readFile: vi.fn(async () => Buffer.from('custom-image')),
    });
    const tool = createReadTool('/test', { operations: ops });
    const result = await tool.execute('tc1', { path: 'file.xyz' });
    expect(result.content[0]).toEqual({
      type: 'text',
      text: expect.stringContaining('image/custom'),
    });
  });

  it('applies offset and limit', async () => {
    const ops = makeReadOps({
      readFile: vi.fn(async () => Buffer.from('line1\nline2\nline3\nline4\nline5')),
    });
    const tool = createReadTool('/test', { operations: ops });
    const result = await tool.execute('tc1', { path: 'file.txt', offset: 2, limit: 2 });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('line2');
    expect(text).toContain('line3');
    expect(text).not.toContain('line1');
  });

  it('throws on offset beyond file', async () => {
    const ops = makeReadOps({
      readFile: vi.fn(async () => Buffer.from('short file')),
    });
    const tool = createReadTool('/test', { operations: ops });
    await expect(tool.execute('tc1', { path: 'file.txt', offset: 999 })).rejects.toThrow(
      /beyond end of file/,
    );
  });

  it('throws on access failure', async () => {
    const ops = makeReadOps({
      access: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
    });
    const tool = createReadTool('/test', { operations: ops });
    await expect(tool.execute('tc1', { path: 'missing.txt' })).rejects.toThrow();
  });

  it('handles abort signal', async () => {
    const ops = makeReadOps();
    const tool = createReadTool('/test', { operations: ops });
    const controller = new AbortController();
    controller.abort();
    await expect(tool.execute('tc1', { path: 'file.txt' }, controller.signal)).rejects.toThrow(
      /aborted/i,
    );
  });
});
