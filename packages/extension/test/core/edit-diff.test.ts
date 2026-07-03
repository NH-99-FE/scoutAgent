import { readFile, stat } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_REVIEW_TEXT_BYTES } from '../../src/core/text-size.ts';
import {
  captureWriteDiffBase,
  computeWriteDiffFromBase,
} from '../../src/core/tools/shared/edit-diff.ts';

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readFile: vi.fn(),
    stat: vi.fn(),
  };
});

describe('edit-diff write preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not read write preview bases larger than the review cap', async () => {
    vi.mocked(stat).mockResolvedValueOnce({
      size: MAX_REVIEW_TEXT_BYTES + 1,
    } as Awaited<ReturnType<typeof stat>>);

    const result = await captureWriteDiffBase('large.txt', '/workspace');

    expect(readFile).not.toHaveBeenCalled();
    expect(result).toEqual({
      error: 'Could not preview write to large.txt. Diff too large to review.',
    });
  });

  it('does not compute write preview diffs when either side exceeds the review cap', () => {
    const largeContent = 'x'.repeat(MAX_REVIEW_TEXT_BYTES + 1);

    expect(
      computeWriteDiffFromBase('large.txt', 'replacement\n', { oldContent: largeContent }),
    ).toEqual({
      error: 'Could not preview write to large.txt. Diff too large to review.',
    });
    expect(computeWriteDiffFromBase('large.txt', largeContent, { oldContent: 'old\n' })).toEqual({
      error: 'Could not preview write to large.txt. Diff too large to review.',
    });
  });
});
