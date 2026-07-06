import { describe, expect, it } from 'vitest';
import {
  reuseListByIndex,
  reuseListByKey,
} from '@/features/conversation/render-model/structural-sharing';

describe('structural sharing helpers', () => {
  it('treats undefined as a reusable keyed value', () => {
    const previous: Array<string | undefined> = [undefined];
    const next: Array<string | undefined> = ['fallback'];

    const rows = reuseListByKey({
      previous,
      next,
      getKey: () => 'same-key',
      canReuse: (previousValue, nextValue) =>
        previousValue === undefined && nextValue === 'fallback',
    });

    expect(rows).toBe(previous);
    expect(rows[0]).toBeUndefined();
  });

  it('treats undefined as a reusable indexed value', () => {
    const previous: Array<string | undefined> = [undefined];
    const next: Array<string | undefined> = ['fallback'];

    const rows = reuseListByIndex({
      previous,
      next,
      canReuse: (previousValue, nextValue) =>
        previousValue === undefined && nextValue === 'fallback',
    });

    expect(rows).toBe(previous);
    expect(rows[0]).toBeUndefined();
  });
});
