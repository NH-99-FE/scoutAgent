import { describe, expect, it, vi } from 'vitest';
import type { ScoutSessionEvent } from '../../../src/host/session-coordinator.ts';
import { SessionEventForwarder } from '../../../src/host/protocol/session-event-forwarder.ts';

function makeForwarder(options: { isStreaming?: () => boolean } = {}) {
  const publishEvent = vi.fn();
  const pushState = vi.fn(async () => undefined);
  const pushQueueState = vi.fn();
  const pushTreeData = vi.fn(async () => undefined);
  const forwarder = new SessionEventForwarder({
    isStreaming: options.isStreaming ?? (() => false),
    publishEvent,
    pushState,
    pushQueueState,
    pushTreeData,
  });
  return { forwarder, publishEvent, pushState, pushQueueState, pushTreeData };
}

describe('SessionEventForwarder', () => {
  it('tracks agent busy state and falls back to streaming state while idle', () => {
    let streaming = true;
    const { forwarder, publishEvent } = makeForwarder({
      isStreaming: () => streaming,
    });

    expect(forwarder.getBusyState()).toEqual({
      kind: 'agent',
      label: 'Working',
      cancellable: true,
    });

    forwarder.handle({
      type: 'agent_event',
      event: { type: 'agent_start' },
    } as unknown as ScoutSessionEvent);
    streaming = false;

    expect(forwarder.getBusyState()).toEqual({
      kind: 'agent',
      label: 'Working',
      cancellable: true,
    });
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'runtime_state_update',
      isStreaming: true,
      busyState: {
        kind: 'agent',
        label: 'Working',
        cancellable: true,
      },
    });
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'agent_event',
      event: { type: 'agent_start' },
    });

    forwarder.handle({
      type: 'agent_event',
      event: { type: 'agent_end', willRetry: false },
    } as unknown as ScoutSessionEvent);

    expect(forwarder.getBusyState()).toEqual({ kind: 'idle', cancellable: false });
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'runtime_state_update',
      isStreaming: false,
      busyState: { kind: 'idle', cancellable: false },
    });
  });

  it('keeps retry busy after an agent end that will retry', () => {
    const { forwarder, publishEvent } = makeForwarder();

    forwarder.handle({
      type: 'agent_event',
      event: { type: 'agent_start' },
    } as unknown as ScoutSessionEvent);
    forwarder.handle({
      type: 'agent_event',
      event: { type: 'agent_end', willRetry: true },
    } as unknown as ScoutSessionEvent);

    expect(forwarder.getBusyState()).toEqual({
      kind: 'retry',
      label: 'Retrying',
      cancellable: true,
    });
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'runtime_state_update',
      isStreaming: true,
      busyState: {
        kind: 'retry',
        label: 'Retrying',
        cancellable: true,
      },
    });
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'agent_event',
      event: { type: 'agent_end', willRetry: true },
    });
  });

  it('publishes the raw idle runtime state when agent_end arrives before streaming clears', () => {
    const { forwarder, publishEvent } = makeForwarder({
      isStreaming: () => true,
    });

    forwarder.handle({
      type: 'agent_event',
      event: { type: 'agent_start' },
    } as unknown as ScoutSessionEvent);
    publishEvent.mockClear();

    forwarder.handle({
      type: 'agent_event',
      event: { type: 'agent_end', willRetry: false },
    } as unknown as ScoutSessionEvent);

    expect(publishEvent).toHaveBeenCalledWith({
      type: 'runtime_state_update',
      isStreaming: false,
      busyState: { kind: 'idle', cancellable: false },
    });
  });

  it('does not clear active agent busy when retry end arrives after the next agent start', () => {
    const { forwarder } = makeForwarder();

    forwarder.handle({
      type: 'auto_retry_start',
      attempt: 2,
      maxAttempts: 3,
      delayMs: 100,
      errorMessage: 'rate limit',
    } as unknown as ScoutSessionEvent);
    forwarder.handle({
      type: 'agent_event',
      event: { type: 'agent_start' },
    } as unknown as ScoutSessionEvent);
    forwarder.handle({
      type: 'auto_retry_end',
      success: true,
      attempt: 2,
    } as unknown as ScoutSessionEvent);

    expect(forwarder.getBusyState()).toEqual({
      kind: 'agent',
      label: 'Working',
      cancellable: true,
    });
  });

  it('maps retry and compaction events to webview messages and busy state', () => {
    const { forwarder, publishEvent } = makeForwarder();

    forwarder.handle({
      type: 'auto_retry_start',
      attempt: 2,
      maxAttempts: 3,
      delayMs: 100,
      errorMessage: 'rate limit',
    } as unknown as ScoutSessionEvent);

    expect(forwarder.getBusyState()).toEqual({
      kind: 'retry',
      label: 'Retrying',
      cancellable: true,
      attempt: 2,
      maxAttempts: 3,
      reason: 'rate limit',
    });
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'runtime_state_update',
      isStreaming: true,
      busyState: {
        kind: 'retry',
        label: 'Retrying',
        cancellable: true,
        attempt: 2,
        maxAttempts: 3,
        reason: 'rate limit',
      },
    });
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'auto_retry_start',
      attempt: 2,
      maxAttempts: 3,
      delayMs: 100,
      errorMessage: 'rate limit',
    });

    forwarder.handle({
      type: 'compaction_end',
      reason: 'overflow',
      result: { type: 'skipped' },
      aborted: false,
      willRetry: true,
      errorMessage: undefined,
    } as unknown as ScoutSessionEvent);

    expect(forwarder.getBusyState()).toEqual({
      kind: 'retry',
      label: 'Retrying',
      cancellable: true,
      reason: 'overflow',
    });
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'compaction_end',
      reason: 'overflow',
      result: { type: 'skipped' },
      aborted: false,
      willRetry: true,
      errorMessage: undefined,
    });
  });

  it('refreshes derived state for state, queue, tree, and error events', () => {
    const { forwarder, publishEvent, pushState, pushQueueState, pushTreeData } = makeForwarder();

    forwarder.handle({ type: 'state_change' } as ScoutSessionEvent);
    forwarder.handle({ type: 'queue_change' } as ScoutSessionEvent);
    forwarder.handle({ type: 'tree_change' } as ScoutSessionEvent);
    forwarder.handle({ type: 'error', message: 'boom' } as ScoutSessionEvent);

    expect(pushState).toHaveBeenCalledTimes(2);
    expect(pushQueueState).toHaveBeenCalledTimes(1);
    expect(pushTreeData).toHaveBeenCalledTimes(1);
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'notification',
      level: 'error',
      message: 'boom',
    });
  });
});
