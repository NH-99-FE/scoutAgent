/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================
// Edit 工具测试
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { createEditTool, type EditOperations } from '../../tools/edit.ts';

function makeEditOps(
  initialContent: string,
  overrides: Partial<EditOperations> = {},
): EditOperations & { writtenContent: string | null } {
  const content = initialContent;
  const result = {
    readFile: vi.fn(async () => Buffer.from(content)),
    writeFile: vi.fn(async (_path: string, newContent: string) => {
      result.writtenContent = newContent;
    }),
    access: vi.fn(async () => {}),
    writtenContent: null as string | null,
    ...overrides,
  };
  return result;
}

describe('createEditTool', () => {
  it('returns tool with name "edit"', () => {
    const ops = makeEditOps('');
    const tool = createEditTool('/test', { operations: ops });
    expect(tool.name).toBe('edit');
    expect(tool.label).toBe('edit');
  });

  it('applies a single edit', async () => {
    const ops = makeEditOps('hello world');
    const tool = createEditTool('/test', { operations: ops });
    const result = await tool.execute('tc1', {
      path: 'file.txt',
      edits: [{ oldText: 'world', newText: 'Scout' }],
    });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Successfully replaced 1 block(s)');
    expect(ops.writtenContent).toBe('hello Scout');
  });

  it('applies multiple non-overlapping edits', async () => {
    const ops = makeEditOps('aaa bbb ccc');
    const tool = createEditTool('/test', { operations: ops });
    const result = await tool.execute('tc1', {
      path: 'file.txt',
      edits: [
        { oldText: 'aaa', newText: 'AAA' },
        { oldText: 'ccc', newText: 'CCC' },
      ],
    });
    expect(ops.writtenContent).toBe('AAA bbb CCC');
    expect(result.details).toBeDefined();
    expect(result.details!.diff).toBeTruthy();
    expect(result.details!.patch).toBeTruthy();
  });

  it('throws on not found oldText', async () => {
    const ops = makeEditOps('hello world');
    const tool = createEditTool('/test', { operations: ops });
    await expect(
      tool.execute('tc1', { path: 'file.txt', edits: [{ oldText: 'xyz', newText: 'abc' }] }),
    ).rejects.toThrow(/Could not find/);
  });

  it('throws on empty edits', async () => {
    const ops = makeEditOps('hello world');
    const tool = createEditTool('/test', { operations: ops });
    await expect(tool.execute('tc1', { path: 'file.txt', edits: [] })).rejects.toThrow(
      /at least one replacement/,
    );
  });

  it('throws on duplicate match', async () => {
    const ops = makeEditOps('aaa aaa');
    const tool = createEditTool('/test', { operations: ops });
    await expect(
      tool.execute('tc1', { path: 'file.txt', edits: [{ oldText: 'aaa', newText: 'bbb' }] }),
    ).rejects.toThrow(/unique/);
  });

  it('throws on access failure', async () => {
    const ops = makeEditOps('hello', {
      access: vi.fn(async () => {
        throw Object.assign(new Error('no access'), { code: 'EACCES' });
      }),
    });
    const tool = createEditTool('/test', { operations: ops });
    await expect(
      tool.execute('tc1', { path: 'file.txt', edits: [{ oldText: 'hello', newText: 'world' }] }),
    ).rejects.toThrow(/Could not edit/);
  });

  it('handles legacy top-level oldText/newText via prepareArguments', async () => {
    const ops = makeEditOps('hello world');
    const tool = createEditTool('/test', { operations: ops });
    // Simulate model sending old-style parameters
    const input = { path: 'file.txt', oldText: 'world', newText: 'Scout', edits: [] };
    const prepared = (tool as any).prepareArguments?.(input) ?? input;
    await tool.execute('tc1', prepared);
    expect(ops.writtenContent).toBe('hello Scout');
  });

  it('preserves line endings (CRLF)', async () => {
    const ops = makeEditOps('hello\r\nworld');
    const tool = createEditTool('/test', { operations: ops });
    await tool.execute('tc1', { path: 'file.txt', edits: [{ oldText: 'hello', newText: 'hi' }] });
    expect(ops.writtenContent).toBe('hi\r\nworld');
  });

  it('handles abort signal', async () => {
    const ops = makeEditOps('hello world');
    const tool = createEditTool('/test', { operations: ops });
    const controller = new AbortController();
    controller.abort();
    await expect(
      tool.execute(
        'tc1',
        { path: 'file.txt', edits: [{ oldText: 'hello', newText: 'world' }] },
        controller.signal,
      ),
    ).rejects.toThrow(/aborted/i);
  });

  it('includes diff and patch in details', async () => {
    const ops = makeEditOps('line1\nline2\nline3');
    const tool = createEditTool('/test', { operations: ops });
    const result = await tool.execute('tc1', {
      path: 'file.txt',
      edits: [{ oldText: 'line2', newText: 'LINE2' }],
    });
    expect(result.details).toBeDefined();
    expect(result.details!.diff).toContain('LINE2');
    expect(result.details!.patch).toContain('file.txt');
    expect(result.details!.firstChangedLine).toBeDefined();
  });
});
