import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFileMentionMenu } from '@/features/composer/hooks/use-file-mention-menu';

describe('useFileMentionMenu', () => {
  it('reopens the same trigger after dismissal and a document change', () => {
    const options = {
      addImageFiles: vi.fn(async () => 0),
      insertReferencesAt: vi.fn(),
      linearText: '@',
      replaceRange: vi.fn(),
      replaceRangeWithReferences: vi.fn(),
      selectionStart: 1,
    };
    const { result, rerender } = renderHook((props: typeof options) => useFileMentionMenu(props), {
      initialProps: options,
    });

    expect(result.current.open).toBe(true);
    act(() => result.current.dismiss());
    expect(result.current.open).toBe(false);

    act(() => result.current.handleDocumentChange());
    rerender({ ...options, linearText: '', selectionStart: 0 });
    rerender(options);

    expect(result.current.open).toBe(true);
    expect(result.current.activeIndex).toBe(0);
  });
});
