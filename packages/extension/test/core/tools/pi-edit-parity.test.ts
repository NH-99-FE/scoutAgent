// ============================================================
// Pi edit parity — 锁定权威 edit 执行、错误与返回契约
// 对应 Pi: packages/coding-agent/src/core/tools/{edit,edit-diff}.ts
// 同步日期: 2026-07-26
// ============================================================

import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createEditToolDefinition, type EditOperations } from '../../../src/core/tools/edit.ts';
import { generateUnifiedPatch } from '../../../src/core/tools/shared/edit-diff.ts';

function makeOperations(content: string, overrides: Partial<EditOperations> = {}) {
  let stored = content;
  const operations: EditOperations = {
    access: vi.fn(async () => undefined),
    readFile: vi.fn(async () => Buffer.from(stored, 'utf8')),
    writeFile: vi.fn(async (_path, next) => {
      stored = next;
    }),
    ...overrides,
  };
  return { operations, readStored: () => stored };
}

describe('Pi edit parity', () => {
  it('preserves BOM and CRLF while returning the exact Pi text, diff, patch, and line', async () => {
    const { operations, readStored } = makeOperations('\ufeffalpha\r\nbeta\r\ngamma\r\n');
    const definition = createEditToolDefinition(resolve('workspace'), { operations });

    const result = await definition.execute('tool-1', {
      path: 'file.ts',
      edits: [{ oldText: 'beta', newText: 'changed' }],
    });

    expect(readStored()).toBe('\ufeffalpha\r\nchanged\r\ngamma\r\n');
    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: 'Successfully replaced 1 block(s) in file.ts.',
        },
      ],
      details: {
        diff: ' 1 alpha\n-2 beta\n+2 changed\n 3 gamma',
        patch: '--- file.ts\n+++ file.ts\n@@ -1,3 +1,3 @@\n alpha\n-beta\n+changed\n gamma\n',
        firstChangedLine: 2,
      },
    });
  });

  it('applies multiple non-overlapping edits against the original content', async () => {
    const { operations, readStored } = makeOperations('alpha\nbeta\ngamma\ndelta\n');
    const definition = createEditToolDefinition(resolve('workspace'), { operations });

    const result = await definition.execute('tool-1', {
      path: 'file.ts',
      edits: [
        { oldText: 'alpha', newText: 'ALPHA' },
        { oldText: 'gamma', newText: 'GAMMA' },
      ],
    });

    expect(readStored()).toBe('ALPHA\nbeta\nGAMMA\ndelta\n');
    expect(result.content).toEqual([
      { type: 'text', text: 'Successfully replaced 2 block(s) in file.ts.' },
    ]);
  });

  it.each([
    {
      name: 'single-line replacement',
      path: 'file.ts',
      before: 'a\nb\nc\n',
      after: 'a\nx\nc\n',
      patch: '--- file.ts\n+++ file.ts\n@@ -1,3 +1,3 @@\n a\n-b\n+x\n c\n',
    },
    {
      name: 'file start with a spaced filename',
      path: 'space name.ts',
      before: 'a\nb\n',
      after: 'x\nb\n',
      patch: '--- space name.ts\n+++ space name.ts\n@@ -1,2 +1,2 @@\n-a\n+x\n b\n',
    },
    {
      name: 'file end without a trailing newline',
      path: 'file.ts',
      before: 'a\nb',
      after: 'a\nx',
      patch:
        '--- file.ts\n+++ file.ts\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+x\n\\ No newline at end of file\n',
    },
    {
      name: 'empty file',
      path: 'file.ts',
      before: '',
      after: 'x',
      patch:
        '--- file.ts\n+++ file.ts\n@@ -0,0 +1,1 @@\n+x\n\\ No newline at end of file\n',
    },
    {
      name: 'multiple hunks',
      path: 'file.ts',
      before: `${Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n')}\n`,
      after: `${[
        'changed 1',
        ...Array.from({ length: 18 }, (_, index) => `line ${index + 2}`),
        'changed 20',
      ].join('\n')}\n`,
      patch:
        '--- file.ts\n+++ file.ts\n@@ -1,5 +1,5 @@\n-line 1\n+changed 1\n line 2\n line 3\n line 4\n line 5\n@@ -16,5 +16,5 @@\n line 16\n line 17\n line 18\n line 19\n-line 20\n+changed 20\n',
    },
  ])('matches the exact Pi patch for $name', ({ path, before, after, patch }) => {
    expect(generateUnifiedPatch(path, before, after)).toBe(patch);
  });

  it.each([
    {
      name: 'missing content',
      content: 'alpha\n',
      edits: [{ oldText: 'missing', newText: 'next' }],
      message:
        'Could not find the exact text in file.ts. The old text must match exactly including all whitespace and newlines.',
    },
    {
      name: 'duplicate content',
      content: 'same\nsame\n',
      edits: [{ oldText: 'same', newText: 'next' }],
      message:
        'Found 2 occurrences of the text in file.ts. The text must be unique. Please provide more context to make it unique.',
    },
    {
      name: 'overlapping content',
      content: 'alpha beta gamma\n',
      edits: [
        { oldText: 'alpha beta', newText: 'first' },
        { oldText: 'beta gamma', newText: 'second' },
      ],
      message:
        'edits[0] and edits[1] overlap in file.ts. Merge them into one edit or target disjoint regions.',
    },
  ])('returns the exact Pi error for $name', async ({ content, edits, message }) => {
    const { operations } = makeOperations(content);
    const definition = createEditToolDefinition(resolve('workspace'), { operations });

    await expect(definition.execute('tool-1', { path: 'file.ts', edits })).rejects.toThrow(message);
  });

  it('preserves access, read, and write errors without changing operation order', async () => {
    const accessFailure = Object.assign(new Error('denied'), { code: 'EACCES' });
    const access = makeOperations('alpha', {
      access: vi.fn(async () => {
        throw accessFailure;
      }),
    });
    await expect(
      createEditToolDefinition(resolve('workspace'), {
        operations: access.operations,
      }).execute('tool-1', {
        path: 'file.ts',
        edits: [{ oldText: 'alpha', newText: 'beta' }],
      }),
    ).rejects.toThrow('Could not edit file: file.ts. Error code: EACCES.');
    expect(access.operations.readFile).not.toHaveBeenCalled();

    for (const method of ['readFile', 'writeFile'] as const) {
      const failure = new Error(`${method} failed`);
      const fixture = makeOperations('alpha', {
        [method]: vi.fn(async () => {
          throw failure;
        }),
      });
      await expect(
        createEditToolDefinition(resolve('workspace'), {
          operations: fixture.operations,
        }).execute('tool-1', {
          path: 'file.ts',
          edits: [{ oldText: 'alpha', newText: 'beta' }],
        }),
      ).rejects.toBe(failure);
    }
  });

  it.each(['access', 'readFile', 'writeFile'] as const)(
    'observes abort immediately after the %s await',
    async (method) => {
      const controller = new AbortController();
      const fixture = makeOperations('alpha', {
        [method]: vi.fn(async (...args: unknown[]) => {
          controller.abort();
          if (method === 'readFile') return Buffer.from('alpha');
          if (method === 'writeFile') return undefined;
          void args;
          return undefined;
        }) as EditOperations[typeof method],
      });

      await expect(
        createEditToolDefinition(resolve('workspace'), {
          operations: fixture.operations,
        }).execute(
          'tool-1',
          {
            path: 'file.ts',
            edits: [{ oldText: 'alpha', newText: 'beta' }],
          },
          controller.signal,
        ),
      ).rejects.toThrow('Operation aborted');
    },
  );
});
