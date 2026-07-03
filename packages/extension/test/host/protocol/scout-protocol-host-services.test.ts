import { describe, expect, it, vi } from 'vitest';
import type { ConfigManager } from '../../../src/config-manager.ts';
import type { ExtensionSessionCoordinator } from '../../../src/host/session-coordinator.ts';
import { SessionIndex } from '../../../src/host/session-index.ts';
import {
  createScoutProtocolHostServices,
  type ScoutProtocolHostServices,
} from '../../../src/host/protocol/scout-protocol-host-services.ts';
import type { TaskProtocolService } from '../../../src/host/protocol/services/task-service.ts';
import type { UiProtocolService } from '../../../src/host/protocol/services/ui-service.ts';

function makeSessionManager(): ExtensionSessionCoordinator {
  return {
    sessionFile: '/workspace/.scout/sessions/current.jsonl',
    getCommands: vi.fn(() => []),
    setExtensionUIContext: vi.fn(),
    reload: vi.fn(async () => ({ cancelled: false })),
    getActiveChangesReview: vi.fn(() => undefined),
    isStreaming: false,
  } as unknown as ExtensionSessionCoordinator;
}

function makeConfigManager(): ConfigManager {
  return {
    getScoutConfig: vi.fn(() => ({ provider: 'openai' })),
    getExtensionPaths: vi.fn(() => []),
  } as unknown as ConfigManager;
}

function makeBundle(): ScoutProtocolHostServices {
  return createScoutProtocolHostServices({
    cwd: '/workspace',
    agentDir: '/home/me/.scout/agent',
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
          type: 'task_history_result',
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
      type: 'task_history_result',
      query: 'alpha',
      tasks: [],
      offset: 0,
      hasMore: false,
      nextOffset: 0,
    });
  });

  it('routes extension UI responses through the current ui service reference', () => {
    const bundle = makeBundle();
    const replacementUi = {
      extensionUIResponse: vi.fn(),
    } as unknown as UiProtocolService;
    bundle.ui = replacementUi;

    bundle.protocolServices.ui.extensionUIResponse({
      type: 'extension_ui_response',
      id: 'approval-1',
      action: 'confirm',
    });

    expect(replacementUi.extensionUIResponse).toHaveBeenCalledWith({
      type: 'extension_ui_response',
      id: 'approval-1',
      action: 'confirm',
    });
  });

  it('uses the event forwarder busy state when building webview state', async () => {
    const messages: unknown[] = [];
    const bundle = createScoutProtocolHostServices({
      cwd: '/workspace',
      agentDir: '/home/me/.scout/agent',
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

  it('uses the host notification hook when lifecycle bootstrap fails', async () => {
    const showErrorMessage = vi.fn();
    const bundle = createScoutProtocolHostServices({
      cwd: '/workspace',
      agentDir: '/home/me/.scout/agent',
      sessionManager: {
        ...makeSessionManager(),
        initialize: vi.fn(async () => {
          throw new Error('runtime unavailable');
        }),
      } as unknown as ExtensionSessionCoordinator,
      configManager: makeConfigManager(),
      sessionIndex: new SessionIndex({
        listWorkspace: vi.fn(async () => []),
        listAll: vi.fn(async () => []),
      }),
      postMessage: vi.fn(),
      showErrorMessage,
      log: vi.fn(),
    });

    await expect(bundle.protocolServices.lifecycle.ready('chat', vi.fn())).rejects.toThrow(
      'runtime unavailable',
    );

    expect(showErrorMessage).toHaveBeenCalledWith('Scout 启动失败：runtime unavailable');
  });
});
