import { describe, expect, it, vi } from 'vitest';
import { AgentSessionRuntime } from '../agent-session-runtime.ts';
import type { AgentSession } from '../agent-session.ts';
import type { ReplacedSessionContext } from '../extensions/types.ts';

function makeSession(overrides?: Partial<AgentSession>) {
  const backingSession = {} as ReturnType<AgentSession['getBackingSession']>;
  return {
    isStreaming: false,
    abort: vi.fn(async () => undefined),
    dispose: vi.fn(),
    getActiveToolNames: vi.fn(() => ['read', 'bash']),
    isActiveToolsCustomized: vi.fn(() => false),
    getBackingSession: vi.fn(() => backingSession),
    getSessionMetadata: vi.fn(async () => ({ id: 'old-session', path: '/sessions/old.jsonl' })),
    emitSessionBeforeSwitch: vi.fn(async () => false),
    emitSessionBeforeFork: vi.fn(async () => false),
    emitSessionShutdown: vi.fn(async () => undefined),
    emitSessionStart: vi.fn(async () => undefined),
    createReplacedSessionContext: vi.fn(() => ({ replacement: true })),
    ...overrides,
  } as unknown as AgentSession;
}

function makeRepo() {
  const targetSession = {
    getMetadata: vi.fn(async () => ({ id: 'target-session', path: '/sessions/target.jsonl' })),
    dispose: vi.fn(),
  };
  return {
    targetSession,
    repo: {
      create: vi.fn(async () => targetSession),
      open: vi.fn(async () => targetSession),
      delete: vi.fn(async () => undefined),
      fork: vi.fn(async () => targetSession),
    },
  };
}

describe('AgentSessionRuntime', () => {
  it('keeps the old session active when next runtime creation fails', async () => {
    const oldSession = makeSession();
    const { repo } = makeRepo();
    const rebind = vi.fn();
    const runtime = new AgentSessionRuntime(oldSession, {
      cwd: '/test/project',
      createRuntime: vi.fn(async () => {
        throw new Error('init failed');
      }),
    });
    runtime.setRebindSession(rebind);

    await expect(runtime.newSession(repo as any)).rejects.toThrow('init failed');

    expect(oldSession.emitSessionShutdown).not.toHaveBeenCalled();
    expect(oldSession.dispose).not.toHaveBeenCalled();
    expect(rebind).not.toHaveBeenCalled();
    expect(runtime.session).toBe(oldSession);
  });

  it('fork owns abort, repo fork, shutdown, apply, rebind, and session_start order', async () => {
    const events: string[] = [];
    const oldSession = makeSession({
      isStreaming: true,
      abort: vi.fn(async () => {
        events.push('abort');
      }),
      emitSessionShutdown: vi.fn(async () => {
        events.push('shutdown');
      }),
      dispose: vi.fn(() => {
        events.push('dispose');
      }),
    });
    const nextSession = makeSession({
      emitSessionStart: vi.fn(async () => {
        events.push('start');
      }),
    });
    const { repo, targetSession } = makeRepo();
    const rebind = vi.fn(() => {
      events.push('rebind');
    });
    const createRuntime = vi.fn(async () => {
      events.push('create');
      return { session: nextSession, diagnostics: [] };
    });
    const runtime = new AgentSessionRuntime(oldSession, {
      cwd: '/test/project',
      createRuntime,
    });
    runtime.setRebindSession(rebind);

    const result = await runtime.fork(repo as any, 'entry-1', 'before');

    expect(result).toEqual({ cancelled: false });
    expect(oldSession.abort).toHaveBeenCalled();
    expect(repo.fork).toHaveBeenCalledWith(
      { id: 'old-session', path: '/sessions/old.jsonl' },
      { cwd: '/test/project', entryId: 'entry-1', position: 'before' },
    );
    expect(createRuntime).toHaveBeenCalledWith({
      session: targetSession,
      activeToolNames: ['read', 'bash'],
      sessionStartEvent: {
        type: 'session_start',
        reason: 'fork',
        previousSessionFile: '/sessions/old.jsonl',
      },
    });
    expect(runtime.session).toBe(nextSession);
    expect(events).toEqual(['abort', 'create', 'shutdown', 'dispose', 'rebind', 'start']);
  });

  it('reload keeps default tool selection uncustomized so new extension tools can activate', async () => {
    const backingSession = {} as ReturnType<AgentSession['getBackingSession']>;
    const oldSession = makeSession({
      getBackingSession: vi.fn(() => backingSession),
      getActiveToolNames: vi.fn(() => ['read', 'old-extension-tool']),
      isActiveToolsCustomized: vi.fn(() => false),
    });
    const nextSession = makeSession();
    const createRuntime = vi.fn(async () => ({ session: nextSession, diagnostics: [] }));
    const runtime = new AgentSessionRuntime(oldSession, {
      cwd: '/test/project',
      createRuntime,
    });

    await runtime.reload();

    expect(createRuntime).toHaveBeenCalledWith({
      session: backingSession,
      activeToolNames: undefined,
      sessionStartEvent: {
        type: 'session_start',
        reason: 'reload',
      },
    });
    expect(oldSession.getActiveToolNames).not.toHaveBeenCalled();
  });

  it('reload preserves manually customized active tools', async () => {
    const backingSession = {} as ReturnType<AgentSession['getBackingSession']>;
    const oldSession = makeSession({
      getBackingSession: vi.fn(() => backingSession),
      getActiveToolNames: vi.fn(() => ['read']),
      isActiveToolsCustomized: vi.fn(() => true),
    });
    const nextSession = makeSession();
    const createRuntime = vi.fn(async () => ({ session: nextSession, diagnostics: [] }));
    const runtime = new AgentSessionRuntime(oldSession, {
      cwd: '/test/project',
      createRuntime,
    });

    await runtime.reload();

    expect(createRuntime).toHaveBeenCalledWith({
      session: backingSession,
      activeToolNames: ['read'],
      sessionStartEvent: {
        type: 'session_start',
        reason: 'reload',
      },
    });
  });

  it('runs withSession after rebind and session_start using the replacement context', async () => {
    const events: string[] = [];
    const oldSession = makeSession({
      emitSessionShutdown: vi.fn(async () => {
        events.push('shutdown');
      }),
      dispose: vi.fn(() => {
        events.push('dispose');
      }),
    });
    const replacementCtx = { replacement: true } as unknown as ReplacedSessionContext;
    const nextSession = makeSession({
      emitSessionStart: vi.fn(async () => {
        events.push('start');
      }),
      createReplacedSessionContext: vi.fn(() => replacementCtx),
    });
    const { repo } = makeRepo();
    const runtime = new AgentSessionRuntime(oldSession, {
      cwd: '/test/project',
      createRuntime: vi.fn(async () => {
        events.push('create');
        return { session: nextSession, diagnostics: [] };
      }),
    });
    runtime.setRebindSession(() => {
      events.push('rebind');
    });

    const withSession = vi.fn(async (ctx) => {
      events.push('withSession');
      expect(ctx).toBe(replacementCtx);
      expect(runtime.session).toBe(nextSession);
    });

    await runtime.newSession(repo as any, { withSession });

    expect(withSession).toHaveBeenCalledTimes(1);
    expect(nextSession.createReplacedSessionContext).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['create', 'shutdown', 'dispose', 'rebind', 'start', 'withSession']);
  });

  it('returns withSessionError after replacement instead of rejecting', async () => {
    const events: string[] = [];
    const callbackError = new Error('withSession failed');
    const oldSession = makeSession({
      emitSessionShutdown: vi.fn(async () => {
        events.push('shutdown');
      }),
      dispose: vi.fn(() => {
        events.push('dispose');
      }),
    });
    const nextSession = makeSession({
      emitSessionStart: vi.fn(async () => {
        events.push('start');
      }),
    });
    const { repo } = makeRepo();
    const runtime = new AgentSessionRuntime(oldSession, {
      cwd: '/test/project',
      createRuntime: vi.fn(async () => {
        events.push('create');
        return { session: nextSession, diagnostics: [] };
      }),
    });
    runtime.setRebindSession(() => {
      events.push('rebind');
    });

    const result = await runtime.newSession(repo as any, {
      withSession: async () => {
        events.push('withSession');
        throw callbackError;
      },
    });

    expect(result.cancelled).toBe(false);
    expect(result.withSessionError).toBe(callbackError);
    expect(runtime.session).toBe(nextSession);
    expect(events).toEqual(['create', 'shutdown', 'dispose', 'rebind', 'start', 'withSession']);
  });

  it('runs before-session-invalidate after shutdown and before old session dispose', async () => {
    const events: string[] = [];
    const oldSession = makeSession({
      emitSessionShutdown: vi.fn(async () => {
        events.push('shutdown');
      }),
      dispose: vi.fn(() => {
        events.push('dispose');
      }),
    });
    const nextSession = makeSession({
      emitSessionStart: vi.fn(async () => {
        events.push('start');
      }),
    });
    const { repo } = makeRepo();
    const runtime = new AgentSessionRuntime(oldSession, {
      cwd: '/test/project',
      createRuntime: vi.fn(async () => ({ session: nextSession, diagnostics: [] })),
    });
    runtime.setBeforeSessionInvalidate(() => {
      events.push('before-invalidate');
    });
    runtime.setRebindSession(() => {
      events.push('rebind');
    });

    await runtime.newSession(repo as any);

    expect(events).toEqual(['shutdown', 'before-invalidate', 'dispose', 'rebind', 'start']);
  });

  it('still invalidates and disposes when session_shutdown fails', async () => {
    const events: string[] = [];
    const oldSession = makeSession({
      emitSessionShutdown: vi.fn(async () => {
        events.push('shutdown');
        throw new Error('shutdown failed');
      }),
      dispose: vi.fn(() => {
        events.push('dispose');
      }),
    });
    const runtime = new AgentSessionRuntime(oldSession, {
      cwd: '/test/project',
      createRuntime: vi.fn(),
    });
    runtime.setBeforeSessionInvalidate(() => {
      events.push('before-invalidate');
    });

    await expect(runtime.dispose()).rejects.toThrow('shutdown failed');

    expect(events).toEqual(['shutdown', 'before-invalidate', 'dispose']);
  });

  it('disposes the target session when next runtime creation fails', async () => {
    const oldSession = makeSession();
    const { repo, targetSession } = makeRepo();
    const runtime = new AgentSessionRuntime(oldSession, {
      cwd: '/test/project',
      createRuntime: vi.fn(async () => {
        throw new Error('init failed');
      }),
    });

    await expect(runtime.newSession(repo as any)).rejects.toThrow('init failed');

    expect(targetSession.dispose).toHaveBeenCalled();
    expect(repo.delete).toHaveBeenCalledWith({
      id: 'target-session',
      path: '/sessions/target.jsonl',
    });
    expect(oldSession.emitSessionShutdown).not.toHaveBeenCalled();
    expect(oldSession.dispose).not.toHaveBeenCalled();
    expect(runtime.session).toBe(oldSession);
  });

  it('does not let invalidate or dispose errors hide a session_shutdown error', async () => {
    const shutdownError = new Error('shutdown failed');
    const oldSession = makeSession({
      emitSessionShutdown: vi.fn(async () => {
        throw shutdownError;
      }),
      dispose: vi.fn(() => {
        throw new Error('dispose failed');
      }),
    });
    const runtime = new AgentSessionRuntime(oldSession, {
      cwd: '/test/project',
      createRuntime: vi.fn(),
    });
    runtime.setBeforeSessionInvalidate(() => {
      throw new Error('invalidate failed');
    });

    await expect(runtime.dispose()).rejects.toBe(shutdownError);

    expect((shutdownError as { suppressed?: unknown[] }).suppressed).toHaveLength(2);
  });

  it('completes replacement and returns a session_shutdown teardown error', async () => {
    const events: string[] = [];
    const shutdownError = new Error('shutdown failed');
    const oldSession = makeSession({
      emitSessionShutdown: vi.fn(async () => {
        events.push('shutdown');
        throw shutdownError;
      }),
      dispose: vi.fn(() => {
        events.push('dispose');
      }),
    });
    const nextSession = makeSession({
      emitSessionStart: vi.fn(async () => {
        events.push('start');
      }),
    });
    const { repo } = makeRepo();
    const runtime = new AgentSessionRuntime(oldSession, {
      cwd: '/test/project',
      createRuntime: vi.fn(async () => {
        events.push('create');
        return { session: nextSession, diagnostics: [] };
      }),
    });
    runtime.setBeforeSessionInvalidate(() => {
      events.push('before-invalidate');
    });
    runtime.setRebindSession(() => {
      events.push('rebind');
    });

    const result = await runtime.newSession(repo as any);

    expect(result).toEqual({ cancelled: false, teardownError: shutdownError });
    expect(runtime.session).toBe(nextSession);
    expect(events).toEqual([
      'create',
      'shutdown',
      'before-invalidate',
      'dispose',
      'rebind',
      'start',
    ]);
  });

  it('cleans up a newly-created session when target metadata lookup fails', async () => {
    const metadataError = new Error('metadata failed');
    const oldSession = makeSession();
    const { repo, targetSession } = makeRepo();
    targetSession.getMetadata.mockRejectedValue(metadataError);
    const runtime = new AgentSessionRuntime(oldSession, {
      cwd: '/test/project',
      createRuntime: vi.fn(),
    });

    await expect(runtime.newSession(repo as any)).rejects.toBe(metadataError);

    expect(targetSession.dispose).toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
    expect((metadataError as { suppressed?: unknown[] }).suppressed).toHaveLength(1);
    expect(oldSession.emitSessionShutdown).not.toHaveBeenCalled();
    expect(runtime.session).toBe(oldSession);
  });
});
