import { describe, expect, it, vi } from 'vitest';
import { AgentSessionRuntime } from '../agent-session-runtime.ts';
import type { AgentSession } from '../agent-session.ts';

function makeSession(overrides?: Partial<AgentSession>) {
  return {
    isStreaming: false,
    abort: vi.fn(async () => undefined),
    dispose: vi.fn(),
    getActiveToolNames: vi.fn(() => ['read', 'bash']),
    getSessionMetadata: vi.fn(async () => ({ id: 'old-session', path: '/sessions/old.jsonl' })),
    emitSessionBeforeSwitch: vi.fn(async () => false),
    emitSessionBeforeFork: vi.fn(async () => false),
    emitSessionShutdown: vi.fn(async () => undefined),
    emitSessionStart: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as AgentSession;
}

function makeRepo() {
  const targetSession = {
    getMetadata: vi.fn(async () => ({ id: 'target-session', path: '/sessions/target.jsonl' })),
  };
  return {
    targetSession,
    repo: {
      create: vi.fn(async () => targetSession),
      open: vi.fn(async () => targetSession),
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
});
