// ============================================================
// Pi write parity — 锁定权威 write 顺序、错误与返回契约
// 对应 Pi: packages/coding-agent/src/core/tools/write.ts
// 同步日期: 2026-07-26
// ============================================================

import { dirname, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createWriteToolDefinition, type WriteOperations } from '../../../src/core/tools/write.ts';

function makeOperations(overrides: Partial<WriteOperations> = {}): WriteOperations {
  return {
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('Pi write parity', () => {
  it('runs mkdir then writeFile and returns the exact Pi result', async () => {
    const operations = makeOperations();
    const cwd = resolve('workspace');
    const target = resolve(cwd, 'nested/file.ts');
    const definition = createWriteToolDefinition(cwd, { operations });

    const result = await definition.execute('tool-1', {
      path: 'nested/file.ts',
      content: 'hello\n',
    });

    expect(operations.mkdir).toHaveBeenCalledWith(dirname(target));
    expect(operations.writeFile).toHaveBeenCalledWith(target, 'hello\n');
    expect(vi.mocked(operations.mkdir).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(operations.writeFile).mock.invocationCallOrder[0]!,
    );
    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: 'Successfully wrote 6 bytes to nested/file.ts',
        },
      ],
      details: undefined,
    });
  });

  it.each(['mkdir', 'writeFile'] as const)('preserves the original %s error', async (method) => {
    const failure = new Error(`${method} failed`);
    const operations = makeOperations({
      [method]: vi.fn(async () => {
        throw failure;
      }),
    });
    const definition = createWriteToolDefinition(resolve('workspace'), { operations });

    await expect(definition.execute('tool-1', { path: 'file.ts', content: 'hello' })).rejects.toBe(
      failure,
    );
  });

  it.each(['mkdir', 'writeFile'] as const)(
    'observes abort immediately after the %s await',
    async (method) => {
      const controller = new AbortController();
      const operations = makeOperations({
        [method]: vi.fn(async () => {
          controller.abort();
        }),
      });
      const definition = createWriteToolDefinition(resolve('workspace'), { operations });

      await expect(
        definition.execute('tool-1', { path: 'file.ts', content: 'hello' }, controller.signal),
      ).rejects.toThrow('Operation aborted');
    },
  );
});
