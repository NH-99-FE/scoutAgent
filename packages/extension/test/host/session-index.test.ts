import { describe, expect, it, vi } from 'vitest';
import type { JsonlSessionMetadata } from '../../src/core/session/index.ts';
import { SessionIndex } from '../../src/host/session-index.ts';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function makeSession(id: string): JsonlSessionMetadata {
  return {
    id,
    path: `/workspace/.scout/sessions/${id}.jsonl`,
    cwd: '/workspace',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('SessionIndex', () => {
  it('caches session lists by scope', async () => {
    const listWorkspace = vi.fn(async () => [makeSession('workspace-1')]);
    const listAll = vi.fn(async () => [makeSession('all-1')]);
    const index = new SessionIndex({ listWorkspace, listAll });

    await expect(index.list('workspace')).resolves.toEqual([makeSession('workspace-1')]);
    await expect(index.list('workspace')).resolves.toEqual([makeSession('workspace-1')]);
    await expect(index.list('all')).resolves.toEqual([makeSession('all-1')]);

    expect(listWorkspace).toHaveBeenCalledTimes(1);
    expect(listAll).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent loads for the same scope', async () => {
    const deferred = createDeferred<JsonlSessionMetadata[]>();
    const listWorkspace = vi.fn(() => deferred.promise);
    const index = new SessionIndex({
      listWorkspace,
      listAll: vi.fn(async () => []),
    });

    const first = index.list('workspace');
    const second = index.list('workspace');
    deferred.resolve([makeSession('workspace-1')]);

    await expect(Promise.all([first, second])).resolves.toEqual([
      [makeSession('workspace-1')],
      [makeSession('workspace-1')],
    ]);
    expect(listWorkspace).toHaveBeenCalledTimes(1);
  });

  it('caches filtered results within a loaded scope', async () => {
    const listWorkspace = vi.fn(async () => [
      makeSession('workspace-1'),
      makeSession('workspace-2'),
    ]);
    const index = new SessionIndex({
      listWorkspace,
      listAll: vi.fn(async () => []),
    });
    const predicate = vi.fn((session: JsonlSessionMetadata) => session.id === 'workspace-2');

    await expect(index.filter('workspace', 'query', predicate)).resolves.toEqual([
      makeSession('workspace-2'),
    ]);
    await expect(index.filter('workspace', 'query', predicate)).resolves.toEqual([
      makeSession('workspace-2'),
    ]);

    expect(listWorkspace).toHaveBeenCalledTimes(1);
    expect(predicate).toHaveBeenCalledTimes(2);
  });

  it('clears filtered results when the scope is invalidated', async () => {
    const listWorkspace = vi
      .fn()
      .mockResolvedValueOnce([makeSession('workspace-1')])
      .mockResolvedValueOnce([makeSession('workspace-2')]);
    const index = new SessionIndex({
      listWorkspace,
      listAll: vi.fn(async () => []),
    });

    await expect(index.filter('workspace', 'query', () => true)).resolves.toEqual([
      makeSession('workspace-1'),
    ]);
    index.invalidate('workspace');
    await expect(index.filter('workspace', 'query', () => true)).resolves.toEqual([
      makeSession('workspace-2'),
    ]);
    expect(listWorkspace).toHaveBeenCalledTimes(2);
  });

  it('invalidates a single scope or the full cache', async () => {
    const listWorkspace = vi
      .fn()
      .mockResolvedValueOnce([makeSession('workspace-1')])
      .mockResolvedValueOnce([makeSession('workspace-2')])
      .mockResolvedValueOnce([makeSession('workspace-3')]);
    const listAll = vi
      .fn()
      .mockResolvedValueOnce([makeSession('all-1')])
      .mockResolvedValueOnce([makeSession('all-2')]);
    const index = new SessionIndex({ listWorkspace, listAll });

    await index.list('workspace');
    await index.list('all');
    index.invalidate('workspace');

    await expect(index.list('workspace')).resolves.toEqual([makeSession('workspace-2')]);
    await expect(index.list('all')).resolves.toEqual([makeSession('all-1')]);
    index.invalidate();

    await expect(index.list('workspace')).resolves.toEqual([makeSession('workspace-3')]);
    await expect(index.list('all')).resolves.toEqual([makeSession('all-2')]);
  });

  it('does not cache in-flight loads that finish after invalidation', async () => {
    const staleLoad = createDeferred<JsonlSessionMetadata[]>();
    const listWorkspace = vi
      .fn()
      .mockReturnValueOnce(staleLoad.promise)
      .mockResolvedValueOnce([makeSession('workspace-2')])
      .mockResolvedValueOnce([makeSession('workspace-2')]);
    const index = new SessionIndex({
      listWorkspace,
      listAll: vi.fn(async () => []),
    });

    const staleResult = index.list('workspace');
    index.invalidate('workspace');
    await expect(index.list('workspace')).resolves.toEqual([makeSession('workspace-2')]);
    staleLoad.resolve([makeSession('workspace-1')]);
    await expect(staleResult).resolves.toEqual([makeSession('workspace-1')]);
    await expect(index.list('workspace')).resolves.toEqual([makeSession('workspace-2')]);

    expect(listWorkspace).toHaveBeenCalledTimes(2);
  });
});
