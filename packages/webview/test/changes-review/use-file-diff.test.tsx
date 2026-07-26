import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileDiffResultMessage } from '@scout-agent/shared';

const requestFileDiff = vi.hoisted(() => vi.fn((_options?: unknown) => ({ cancel: vi.fn() })));

vi.mock('@/bridge/protocol-client', () => ({
  protocolClient: { requestFileDiff },
}));

import {
  applyChangesReviewProjectionUpdated,
  clearFileDiffCache,
  useFileDiff,
} from '@/features/changes-review/model/use-file-diff';

const OPTIONS = {
  sessionId: 'session-1',
  turnId: 'turn-1',
  fileId: 'file-1',
  revision: 1,
  view: 'inline' as const,
  mode: 'unified' as const,
  includeTokens: false,
};

describe('useFileDiff', () => {
  beforeEach(() => {
    clearFileDiffCache();
    requestFileDiff.mockReset();
    requestFileDiff.mockReturnValue({ cancel: vi.fn() });
  });

  afterEach(() => {
    clearFileDiffCache();
  });

  it('deduplicates concurrent consumers by stable request identity', () => {
    const first = renderHook(() => useFileDiff(OPTIONS));
    const second = renderHook(() => useFileDiff(OPTIONS));

    expect(first.result.current.status).toBe('loading');
    expect(second.result.current.status).toBe('loading');
    expect(requestFileDiff).toHaveBeenCalledTimes(1);

    first.unmount();
    second.unmount();
  });

  it('retries a pending request only after the matching projection event', () => {
    const callbacks: Array<{
      onResult: (result: FileDiffResultMessage) => void;
    }> = [];
    requestFileDiff.mockImplementation((value?: unknown) => {
      callbacks.push(value as (typeof callbacks)[number]);
      return { cancel: vi.fn() };
    });
    const hook = renderHook(() => useFileDiff(OPTIONS));

    act(() => {
      callbacks[0]?.onResult({
        type: 'file_diff_result',
        turnId: 'turn-1',
        fileId: 'file-1',
        revision: 1,
        status: 'pending',
      });
    });
    expect(hook.result.current.status).toBe('pending');
    expect(requestFileDiff).toHaveBeenCalledTimes(1);

    act(() => {
      applyChangesReviewProjectionUpdated({
        type: 'changes_review_projection_updated',
        sessionId: 'session-1',
        turnId: 'turn-1',
        fileId: 'file-1',
        revision: 1,
        status: 'ready',
        additions: 1,
        deletions: 0,
      });
    });
    expect(requestFileDiff).toHaveBeenCalledTimes(2);

    act(() => {
      callbacks[1]?.onResult({
        type: 'file_diff_result',
        turnId: 'turn-1',
        fileId: 'file-1',
        revision: 1,
        status: 'ready',
        diff: {
          mode: 'unified',
          rows: [],
          additions: 1,
          deletions: 0,
          hunkOffset: 0,
          hunkCount: 1,
          totalHunks: 1,
        },
      });
    });
    expect(hook.result.current).toMatchObject({
      status: 'ready',
      diff: { additions: 1, deletions: 0 },
    });
  });

  it('rejects a response whose file identity does not match the request', () => {
    let onResult: ((result: FileDiffResultMessage) => void) | undefined;
    requestFileDiff.mockImplementation((value?: unknown) => {
      onResult = (value as { onResult: (result: FileDiffResultMessage) => void }).onResult;
      return { cancel: vi.fn() };
    });
    const hook = renderHook(() => useFileDiff(OPTIONS));

    act(() => {
      onResult?.({
        type: 'file_diff_result',
        turnId: 'turn-1',
        fileId: 'stale-file',
        revision: 1,
        status: 'pending',
      });
    });

    expect(hook.result.current).toEqual({
      status: 'error',
      message: 'File diff response identity is stale',
    });
  });

  it('cancels an in-flight request after the last consumer releases it', () => {
    const cancel = vi.fn();
    requestFileDiff.mockReturnValue({ cancel });
    const hook = renderHook(() => useFileDiff(OPTIONS));

    hook.unmount();

    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
