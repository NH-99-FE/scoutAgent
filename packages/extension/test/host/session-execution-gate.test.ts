import { describe, expect, it } from 'vitest';
import { SessionExecutionGate } from '../../src/host/session-execution-gate.ts';

const SESSION = { sessionId: 'session-1', sessionPath: '/sessions/session-1.jsonl' };

describe('SessionExecutionGate', () => {
  it('fails fast instead of queueing a second top-level operation', async () => {
    const broker = new SessionExecutionGate();
    broker.setCurrentSession(SESSION);
    let releaseFirst!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = broker.run(
      {
        kind: 'session_replacement',
        operationId: 'replacement-1',
        session: SESSION,
      },
      async () => await release,
    );
    await Promise.resolve();

    await expect(
      broker.run(
        {
          kind: 'session_replacement',
          operationId: 'replacement-2',
          session: SESSION,
        },
        async () => undefined,
      ),
    ).resolves.toEqual({ ok: false, reason: 'busy' });

    releaseFirst();
    await first;
  });

  it('allows nested mutations owned by a command while rejecting external work', async () => {
    const broker = new SessionExecutionGate();
    broker.setCurrentSession(SESSION);
    let enterCommand!: () => void;
    let releaseCommand!: () => void;
    const entered = new Promise<void>((resolve) => {
      enterCommand = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseCommand = resolve;
    });

    const command = broker.run(
      {
        kind: 'extension_command',
        operationId: 'command-1',
        session: SESSION,
      },
      async () => {
        enterCommand();
        await Promise.resolve();
        const nested = broker.tryBegin({
          kind: 'tree_mutation',
          operationId: 'nested-label',
          session: SESSION,
        });
        expect(nested.ok).toBe(true);
        if (nested.ok) nested.lease.finish();
        await release;
      },
    );

    await entered;
    expect(broker.snapshot().activity).toEqual({
      kind: 'extension_command',
      operationId: 'command-1',
    });
    expect(
      broker.tryBegin({
        kind: 'tree_navigation',
        operationId: 'external-navigation',
        session: SESSION,
      }),
    ).toEqual({ ok: false, reason: 'busy' });

    releaseCommand();
    await command;
    expect(broker.snapshot().activity).toEqual({ kind: 'idle' });
  });

  it('serializes top-level session mutations and exposes tree navigation phases', () => {
    const broker = new SessionExecutionGate();
    broker.setCurrentSession(SESSION);

    const navigation = broker.tryBegin({
      kind: 'tree_navigation',
      operationId: 'navigation-1',
      session: SESSION,
    });
    expect(navigation.ok).toBe(true);
    expect(broker.snapshot().activity).toEqual({
      kind: 'tree_navigation',
      operationId: 'navigation-1',
      phase: 'preflight',
    });
    expect(
      broker.tryBegin({ kind: 'agent_turn', operationId: 'turn-1', session: SESSION }),
    ).toEqual({ ok: false, reason: 'busy' });

    if (!navigation.ok) return;
    navigation.lease.transition('reconciling');
    expect(broker.snapshot().activity).toMatchObject({ phase: 'reconciling' });
    navigation.lease.finish();
    expect(broker.snapshot().activity).toEqual({ kind: 'idle' });
  });

  it('uses the session path as part of identity and blocks mutations after reconciliation failure', () => {
    const broker = new SessionExecutionGate();
    broker.setCurrentSession(SESSION);

    expect(
      broker.tryBegin({
        kind: 'tree_navigation',
        operationId: 'navigation-copy',
        session: { ...SESSION, sessionPath: '/sessions/session-1-copy.jsonl' },
      }),
    ).toEqual({ ok: false, reason: 'stale' });

    const navigation = broker.tryBegin({
      kind: 'tree_navigation',
      operationId: 'navigation-1',
      session: SESSION,
    });
    if (!navigation.ok) return;
    broker.block('navigation-1', 'context sync failed');
    navigation.lease.finish();

    expect(
      broker.tryBegin({ kind: 'agent_turn', operationId: 'turn-1', session: SESSION }),
    ).toEqual({ ok: false, reason: 'blocked' });
    expect(
      broker.tryBegin({
        kind: 'session_replacement',
        operationId: 'reload-1',
        session: SESSION,
      }).ok,
    ).toBe(true);
  });
});
