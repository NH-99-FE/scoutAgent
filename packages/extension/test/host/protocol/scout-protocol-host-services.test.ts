import { describe, expect, it, vi } from 'vitest';
import type { ConfigManager } from '../../../src/config-manager.ts';
import type { ExtensionSessionCoordinator } from '../../../src/host/session-coordinator.ts';
import { SessionIndex } from '../../../src/host/session-index.ts';
import {
  createScoutProtocolHostServices,
  type ScoutProtocolHostServices,
} from '../../../src/host/protocol/scout-protocol-host-services.ts';
import type { TaskProtocolService } from '../../../src/host/protocol/services/task-service.ts';

function makeSessionManager(): ExtensionSessionCoordinator {
  return {
    sessionFile: '/workspace/.scout/sessions/current.jsonl',
    getCommands: vi.fn(() => []),
    isStreaming: false,
  } as unknown as ExtensionSessionCoordinator;
}

function makeConfigManager(): ConfigManager {
  return {
    getScoutConfig: vi.fn(() => ({ provider: 'openai' })),
  } as unknown as ConfigManager;
}

function makeBundle(): ScoutProtocolHostServices {
  return createScoutProtocolHostServices({
    cwd: '/workspace',
    sessionManager: makeSessionManager(),
    configManager: makeConfigManager(),
    sessionIndex: new SessionIndex({
      listWorkspace: vi.fn(async () => []),
      listAll: vi.fn(async () => []),
    }),
    postMessage: vi.fn(),
    log: vi.fn(),
  });
}

describe('createScoutProtocolHostServices', () => {
  it('routes protocol service calls through the current service references', async () => {
    const bundle = makeBundle();
    const respond = vi.fn();
    const replacementTask = {
      requestTaskHistory: vi.fn(async (_message, response) => {
        response({
          type: 'task_history_data',
          query: 'alpha',
          tasks: [],
          offset: 0,
          hasMore: false,
          nextOffset: 0,
        });
      }),
    } as unknown as TaskProtocolService;
    bundle.task = replacementTask;

    await bundle.protocolServices.task.requestTaskHistory(
      { type: 'request_task_history', query: 'alpha', offset: 0 },
      respond,
    );

    expect(replacementTask.requestTaskHistory).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith({
      type: 'task_history_data',
      query: 'alpha',
      tasks: [],
      offset: 0,
      hasMore: false,
      nextOffset: 0,
    });
  });

  it('uses the event forwarder busy state when building webview state', async () => {
    const messages: unknown[] = [];
    const bundle = createScoutProtocolHostServices({
      cwd: '/workspace',
      sessionManager: {
        ...makeSessionManager(),
        isStreaming: true,
        getSessionName: vi.fn(async () => undefined),
        getSessionStats: vi.fn(async () => undefined),
        getVisibleLeafId: vi.fn(async () => null),
        getScoutMessages: vi.fn(() => []),
        getQueueState: vi.fn(() => ({ messages: [], followUps: [], paused: false })),
        getAllToolInfos: vi.fn(() => []),
        getActiveToolNames: vi.fn(() => []),
        model: undefined,
        thinkingLevel: 'off',
        currentCwd: '/workspace',
        sessionId: 'session-1',
        parentSessionPath: undefined,
        diagnostics: [],
        modelFallbackMessage: undefined,
      } as unknown as ExtensionSessionCoordinator,
      configManager: makeConfigManager(),
      sessionIndex: new SessionIndex({
        listWorkspace: vi.fn(async () => []),
        listAll: vi.fn(async () => []),
      }),
      postMessage: (message) => {
        messages.push(message);
      },
      log: vi.fn(),
    });

    await bundle.state.pushState();

    expect(messages).toEqual([
      expect.objectContaining({
        type: 'state_update',
        state: expect.objectContaining({
          busyState: { kind: 'agent', label: 'Working', cancellable: true },
        }),
      }),
    ]);
  });
});
