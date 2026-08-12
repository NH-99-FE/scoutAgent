import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalReviewSnapshotProvider,
  type ReviewFileHandle,
} from '../../src/core/review/index.ts';

let tempDir = '';

afterEach(() => {
  if (!tempDir) return;
  rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

function createTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'scout-review-baseline-'));
  return tempDir;
}

function makeHandle(overrides: Partial<ReviewFileHandle> = {}): ReviewFileHandle {
  return {
    stat: vi.fn(async () => ({ size: 0, isFile: () => true })),
    read: vi.fn(async () => ({ bytesRead: 0 })),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('local review snapshot provider', () => {
  it('captures an opened regular file and classifies ENOENT as missing', async () => {
    const cwd = createTempDir();
    const target = join(cwd, 'before.txt');
    writeFileSync(target, '\ufeffbefore\r\n', 'utf8');
    const provider = createLocalReviewSnapshotProvider();

    await expect(provider.readBefore(target)).resolves.toEqual({
      kind: 'captured',
      snapshot: {
        content: 'before\r\n',
        byteLength: Buffer.byteLength('before\r\n'),
      },
    });
    await expect(provider.readBefore(join(cwd, 'missing.txt'))).resolves.toEqual({
      kind: 'missing',
    });
  });

  it('does not read non-regular or stat-known oversized files and always closes', async () => {
    for (const fixture of [
      {
        handle: makeHandle({
          stat: vi.fn(async () => ({ size: 1, isFile: () => false })),
        }),
        reason: 'original_unavailable',
      },
      {
        handle: makeHandle({
          stat: vi.fn(async () => ({ size: 5, isFile: () => true })),
        }),
        reason: 'content_too_large',
      },
    ]) {
      const provider = createLocalReviewSnapshotProvider({
        maxBytes: 4,
        open: vi.fn(async () => fixture.handle),
      });

      await expect(provider.readBefore('file.ts')).resolves.toEqual({
        kind: 'unavailable',
        reason: fixture.reason,
      });
      expect(fixture.handle.read).not.toHaveBeenCalled();
      expect(fixture.handle.close).toHaveBeenCalledTimes(1);
    }
  });

  it('reads at most maxBytes + 1 and catches growth after fstat', async () => {
    const read = vi.fn(
      async (buffer: Buffer, offset: number, length: number, _position: number) => {
        buffer.fill(0x61, offset, offset + length);
        return { bytesRead: length };
      },
    );
    const handle = makeHandle({
      stat: vi.fn(async () => ({ size: 4, isFile: () => true })),
      read,
    });
    const provider = createLocalReviewSnapshotProvider({
      maxBytes: 4,
      open: vi.fn(async () => handle),
    });

    await expect(provider.readBefore('growing.ts')).resolves.toEqual({
      kind: 'unavailable',
      reason: 'content_too_large',
    });
    expect(read).toHaveBeenCalledWith(expect.any(Buffer), 0, 5, 0);
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it('degrades fstat/read failures and diagnostic failures without throwing', async () => {
    const failure = new Error('fstat failed');
    const handle = makeHandle({
      stat: vi.fn(async () => {
        throw failure;
      }),
    });
    const onError = vi.fn(() => {
      throw new Error('diagnostic failed');
    });
    const provider = createLocalReviewSnapshotProvider({
      open: vi.fn(async () => handle),
      onError,
    });

    await expect(provider.readBefore('failed.ts')).resolves.toEqual({
      kind: 'unavailable',
      reason: 'original_unavailable',
    });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: '读取 review baseline 失败: failed.ts' }),
    );
    expect(handle.close).toHaveBeenCalledTimes(1);
  });
});
