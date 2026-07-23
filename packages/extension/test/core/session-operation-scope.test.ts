import { describe, expect, it } from 'vitest';
import { SessionOperationScope } from '../../src/core/session-operation-scope.ts';

describe('SessionOperationScope', () => {
  it('links external cancellation and keeps an operation exclusive until it finishes', () => {
    const scope = new SessionOperationScope<'treeNavigation'>();
    const request = new AbortController();
    const operation = scope.startExclusive('treeNavigation', request.signal);

    expect(operation).toBeDefined();
    expect(scope.startExclusive('treeNavigation')).toBeUndefined();

    request.abort();
    expect(operation?.signal.aborted).toBe(true);
    expect(scope.has('treeNavigation')).toBe(true);

    operation?.finish();
    expect(scope.has('treeNavigation')).toBe(false);
    expect(scope.startExclusive('treeNavigation')).toBeDefined();
  });

  it('aborts every owned operation and rejects new work after disposal', () => {
    const scope = new SessionOperationScope<'retry' | 'treeNavigation'>();
    const retry = scope.startExclusive('retry');
    const navigation = scope.startExclusive('treeNavigation');

    scope.dispose();

    expect(retry?.signal.aborted).toBe(true);
    expect(navigation?.signal.aborted).toBe(true);
    expect(scope.startExclusive('treeNavigation')).toBeUndefined();
  });
});
