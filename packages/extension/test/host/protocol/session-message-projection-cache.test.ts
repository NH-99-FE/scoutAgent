// ============================================================
// SessionMessageProjectionCache — 投影记忆化协作类的契约测试
// ============================================================

import { describe, expect, it } from 'vitest';
import { SessionManager } from '../../../src/core/session/index.ts';
import { SessionMessageProjectionCache } from '../../../src/host/protocol/session-message-projection-cache.ts';
import { assistantMessage, userMessage } from '../../core/test-utils.ts';

describe('SessionMessageProjectionCache', () => {
  it('returns the same projected array when called with the same branch reference', () => {
    const session = SessionManager.inMemory();
    session.appendMessage(userMessage('hello'));
    session.appendMessage(assistantMessage('world'));
    const branch = session.getBranch();
    const cache = new SessionMessageProjectionCache();

    const first = cache.project(branch);
    const second = cache.project(branch);

    expect(second).toBe(first);
    expect(first.map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('reprojects when the branch reference changes', () => {
    const session = SessionManager.inMemory();
    session.appendMessage(userMessage('hello'));
    const cache = new SessionMessageProjectionCache();

    const initial = cache.project(session.getBranch());
    session.appendMessage(assistantMessage('world'));
    const updated = cache.project(session.getBranch());

    expect(updated).not.toBe(initial);
    expect(updated.map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('returns a stable empty projection when the branch is undefined', () => {
    const cache = new SessionMessageProjectionCache();

    const first = cache.project(undefined);
    const second = cache.project(undefined);

    expect(first).toBe(second);
    expect(first).toEqual([]);
  });

  it('invalidate() forces a fresh projection on the next call with the same branch', () => {
    const session = SessionManager.inMemory();
    session.appendMessage(userMessage('hello'));
    const cache = new SessionMessageProjectionCache();
    const branch = session.getBranch();

    const cached = cache.project(branch);
    cache.invalidate();
    const reprojected = cache.project(branch);

    expect(reprojected).not.toBe(cached);
    expect(reprojected).toEqual(cached);
  });

  it('does not throw when invalidate() runs before any project() call', () => {
    const cache = new SessionMessageProjectionCache();

    expect(() => cache.invalidate()).not.toThrow();
  });
});
