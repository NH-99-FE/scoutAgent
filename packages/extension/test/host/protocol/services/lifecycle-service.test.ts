import { describe, expect, it, vi } from 'vitest';
import type { ExtensionSessionCoordinator } from '../../../../src/host/session-coordinator.ts';
import { LifecycleProtocolService } from '../../../../src/host/protocol/services/lifecycle-service.ts';

function makeSessionManager(): ExtensionSessionCoordinator {
  return {
    initialize: vi.fn(async () => undefined),
  } as unknown as ExtensionSessionCoordinator;
}

describe('LifecycleProtocolService', () => {
  it('initializes chat webviews and pushes chat-specific session data', async () => {
    const calls: string[] = [];
    const sessionManager = makeSessionManager();
    const service = new LifecycleProtocolService({
      sessionManager,
      pushConfig: vi.fn(() => calls.push('config')),
      pushState: vi.fn(async () => {
        calls.push('state');
      }),
      requestCommands: vi.fn(() => calls.push('commands')),
      requestSessions: vi.fn(async () => {
        calls.push('sessions');
      }),
      pushTreeData: vi.fn(async () => {
        calls.push('tree');
      }),
      logReady: vi.fn((surface) => calls.push(`ready:${surface}`)),
    });

    await service.ready('chat');

    expect(sessionManager.initialize).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['ready:chat', 'config', 'state', 'commands', 'sessions']);
  });

  it('initializes tree webviews and pushes tree data for that surface', async () => {
    const requestSessions = vi.fn(async () => undefined);
    const pushTreeData = vi.fn(async () => undefined);
    const service = new LifecycleProtocolService({
      sessionManager: makeSessionManager(),
      pushConfig: vi.fn(),
      pushState: vi.fn(async () => undefined),
      requestCommands: vi.fn(),
      requestSessions,
      pushTreeData,
      logReady: vi.fn(),
    });

    await service.ready('tree');

    expect(requestSessions).not.toHaveBeenCalled();
    expect(pushTreeData).toHaveBeenCalledWith('tree');
  });
});
