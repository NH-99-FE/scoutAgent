import { describe, expect, it, vi } from 'vitest';
import type { ScoutConfig, ScoutWebviewState } from '@scout-agent/shared';
import type { ExtensionSessionCoordinator } from '../../../../src/host/session-coordinator.ts';
import { LifecycleProtocolService } from '../../../../src/host/protocol/services/lifecycle-service.ts';

function makeSessionManager(): ExtensionSessionCoordinator {
  return {
    initialize: vi.fn(async () => undefined),
  } as unknown as ExtensionSessionCoordinator;
}

function makeConfig(): ScoutConfig {
  return {
    models: [],
    defaultModelProvider: 'openai',
    defaultModelId: 'gpt-test',
    defaultToolProfileId: 'develop',
    toolProfiles: [],
    branchSummary: { reserveTokens: 100, skipPrompt: false },
  };
}

function makeState(): ScoutWebviewState {
  return {
    messages: [],
    isStreaming: false,
    busyState: { kind: 'idle', cancellable: false },
    modelProvider: 'openai',
    modelId: 'gpt-test',
    thinkingLevel: 'off',
    tools: [],
    activeToolNames: [],
    commands: [],
  };
}

describe('LifecycleProtocolService', () => {
  it('responds to chat ready with a single bootstrap result', async () => {
    const sessionManager = makeSessionManager();
    const respond = vi.fn();
    const service = new LifecycleProtocolService({
      sessionManager,
      getConfig: makeConfig,
      getState: vi.fn(async () => makeState()),
      getCommands: () => [],
      getSessions: vi.fn(async () => [{ id: 'session-1', path: '/session.jsonl', createdAt: '1' }]),
      getRecentTasks: vi.fn(async () => [
        {
          id: 'task-1',
          sessionId: 'session-1',
          sessionPath: '/session.jsonl',
          title: 'Task',
          createdAt: '1',
        },
      ]),
      getTreeResult: vi.fn(async () => ({ type: 'tree_result' as const, tree: [], leafId: null })),
      logReady: vi.fn(),
    });

    await service.ready('chat', respond);

    expect(sessionManager.initialize).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'bootstrap_result',
        surface: 'chat',
        sessions: [expect.objectContaining({ id: 'session-1' })],
        recentTasks: [expect.objectContaining({ id: 'task-1' })],
      }),
    );
  });

  it('responds to tree ready with tree data but no chat-only lists', async () => {
    const getSessions = vi.fn(async () => []);
    const getRecentTasks = vi.fn(async () => []);
    const respond = vi.fn();
    const service = new LifecycleProtocolService({
      sessionManager: makeSessionManager(),
      getConfig: makeConfig,
      getState: vi.fn(async () => makeState()),
      getCommands: () => [],
      getSessions,
      getRecentTasks,
      getTreeResult: vi.fn(async () => ({
        type: 'tree_result' as const,
        tree: [],
        leafId: 'leaf-1',
      })),
      logReady: vi.fn(),
    });

    await service.ready('tree', respond);

    expect(getSessions).not.toHaveBeenCalled();
    expect(getRecentTasks).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'bootstrap_result',
        surface: 'tree',
        tree: { nodes: [], leafId: 'leaf-1' },
      }),
    );
  });

  it('responds to settings ready without initializing the chat runtime', async () => {
    const sessionManager = makeSessionManager();
    const getSessions = vi.fn(async () => []);
    const getRecentTasks = vi.fn(async () => []);
    const getTreeResult = vi.fn(async () => ({
      type: 'tree_result' as const,
      tree: [],
      leafId: null,
    }));
    const respond = vi.fn();
    const service = new LifecycleProtocolService({
      sessionManager,
      getConfig: makeConfig,
      getState: vi.fn(async () => makeState()),
      getCommands: () => [],
      getSessions,
      getRecentTasks,
      getTreeResult,
      logReady: vi.fn(),
    });

    await service.ready('settings', respond);

    expect(sessionManager.initialize).not.toHaveBeenCalled();
    expect(getSessions).not.toHaveBeenCalled();
    expect(getRecentTasks).not.toHaveBeenCalled();
    expect(getTreeResult).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'bootstrap_result',
        surface: 'settings',
      }),
    );
  });

  it('notifies the host and rethrows when ready bootstrap fails', async () => {
    const sessionManager = makeSessionManager();
    const respond = vi.fn();
    const notifyReadyFailure = vi.fn();
    vi.mocked(sessionManager.initialize).mockRejectedValueOnce(new Error('runtime unavailable'));
    const service = new LifecycleProtocolService({
      sessionManager,
      getConfig: makeConfig,
      getState: vi.fn(async () => makeState()),
      getCommands: () => [],
      getSessions: vi.fn(async () => []),
      getRecentTasks: vi.fn(async () => []),
      getTreeResult: vi.fn(async () => ({ type: 'tree_result' as const, tree: [], leafId: null })),
      logReady: vi.fn(),
      notifyReadyFailure,
    });

    await expect(service.ready('chat', respond)).rejects.toThrow('runtime unavailable');

    expect(notifyReadyFailure).toHaveBeenCalledWith('chat', 'runtime unavailable');
    expect(respond).not.toHaveBeenCalled();
  });
});
