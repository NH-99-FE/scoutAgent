import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  useLazySettingsLoad,
  useSettingsRequestLifecycle,
} from '@/features/settings/hooks/use-settings-request-lifecycle';

describe('settings request lifecycle', () => {
  it('accepts only the latest request while mounted', () => {
    const { result, unmount } = renderHook(() => useSettingsRequestLifecycle<'settings'>());

    const first = result.current.beginRequest('load');
    const second = result.current.beginRequest('load');
    const save = result.current.beginRequest('save');

    expect(result.current.isCurrentRequest('load', first)).toBe(false);
    expect(result.current.isCurrentRequest('load', second)).toBe(true);
    expect(result.current.isCurrentRequest('save', save)).toBe(true);
    expect(result.current.isMounted()).toBe(true);

    unmount();
    expect(result.current.isCurrentRequest('load', second)).toBe(false);
    expect(result.current.isMounted()).toBe(false);
  });

  it('loads once when enabled and exposes an explicit reload', () => {
    const request = vi.fn();
    const { result, rerender } = renderHook(
      ({ enabled }) => useLazySettingsLoad(enabled, request),
      { initialProps: { enabled: false } },
    );

    expect(request).not.toHaveBeenCalled();
    rerender({ enabled: true });
    expect(request).toHaveBeenCalledTimes(1);
    rerender({ enabled: false });
    rerender({ enabled: true });
    expect(request).toHaveBeenCalledTimes(1);

    act(() => result.current());
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('keeps saved feedback scoped and centralizes operation transitions', () => {
    const { result } = renderHook(() => useSettingsRequestLifecycle<'global' | 'project'>());

    act(() => result.current.finishLoad('load warning'));
    expect(result.current).toMatchObject({
      isLoading: false,
      error: 'load warning',
      savedScope: null,
    });

    act(() => result.current.beginSave('global'));
    expect(result.current).toMatchObject({ isSaving: true, error: '' });

    act(() => result.current.finishSave('global', { saved: true }));
    expect(result.current).toMatchObject({ isSaving: false, savedScope: 'global' });

    act(() => result.current.clearFeedback('project'));
    expect(result.current.savedScope).toBe('global');
    act(() => result.current.clearFeedback('global'));
    expect(result.current.savedScope).toBeNull();
  });
});
