import { describe, expect, it, vi } from 'vitest';
import type { ConfigManager } from '../../../../src/config-manager.ts';
import type { ExtensionSessionCoordinator } from '../../../../src/host/session-coordinator.ts';
import { StateProtocolService } from '../../../../src/host/protocol/services/state-service.ts';

function makeSessionManager(
  overrides: Partial<ExtensionSessionCoordinator> = {},
): ExtensionSessionCoordinator {
  return {
    getSessionName: vi.fn(async () => 'Current session'),
    getSessionStats: vi.fn(async () => ({
      contextUsage: {
        usedTokens: 100,
        maxTokens: 200,
        percentage: 50,
      },
    })),
    getVisibleLeafId: vi.fn(async () => 'visible-leaf'),
    getScoutMessages: vi.fn(() => []),
    isStreaming: false,
    getQueueState: vi.fn(() => ({ pending: [], activeId: undefined })),
    model: { provider: 'openai', id: 'gpt-test' },
    thinkingLevel: 'low',
    getAllToolInfos: vi.fn(() => []),
    getActiveToolNames: vi.fn(() => ['read_file']),
    getActiveToolSelection: vi.fn(() => ({ kind: 'profile', profileId: 'develop' })),
    currentCwd: '/workspace',
    sessionId: 'session-1',
    sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
    parentSessionPath: undefined,
    diagnostics: [],
    modelFallbackMessage: undefined,
    getActiveChangesReview: vi.fn(() => undefined),
    ...overrides,
  } as unknown as ExtensionSessionCoordinator;
}

function makeConfigManager(config = { provider: 'openai' }): ConfigManager {
  return {
    getScoutConfig: vi.fn(() => config),
  } as unknown as ConfigManager;
}

describe('StateProtocolService', () => {
  it('projects only the active tool selection in session state', async () => {
    const service = new StateProtocolService({
      sessionManager: makeSessionManager(),
      configManager: makeConfigManager(),
      getCommands: () => [],
      getBusyState: () => ({ kind: 'idle', cancellable: false }),
      getExtensionUIRequests: () => [],
      publishEvent: vi.fn(),
    });

    const state = await service.getState();

    expect(state.activeToolSelection).toEqual({ kind: 'profile', profileId: 'develop' });
    expect(state).not.toHaveProperty('toolProfiles');
    expect(state).not.toHaveProperty('toolProfileId');
  });

  it('posts a complete webview state snapshot to the requested surface', async () => {
    const publishEvent = vi.fn();
    const service = new StateProtocolService({
      sessionManager: makeSessionManager(),
      configManager: makeConfigManager(),
      getCommands: () => [
        {
          name: 'custom',
          description: 'Custom command',
          source: 'extension',
          sourceInfo: {
            path: '/workspace/.scout/extension.ts',
            source: 'custom',
            scope: 'project',
            origin: 'top-level',
          },
        },
      ],
      getBusyState: () => ({ kind: 'agent', label: 'Working', cancellable: true }),
      getExtensionUIRequests: () => [
        {
          type: 'extension_ui_request',
          id: 'ui-1',
          method: 'select',
          title: '危险命令',
          options: ['Yes', 'No'],
          variant: 'danger',
          body: { kind: 'code', text: 'rm -rf tmp' },
        },
      ],
      publishEvent,
    });

    await service.pushState('chat');

    expect(publishEvent).toHaveBeenCalledWith(
      {
        type: 'state_update',
        state: expect.objectContaining({
          busyState: { kind: 'agent', label: 'Working', cancellable: true },
          commands: [
            expect.objectContaining({
              name: 'custom',
              description: 'Custom command',
              source: 'extension',
            }),
          ],
          contextUsage: {
            usedTokens: 100,
            maxTokens: 200,
            percentage: 50,
          },
          extensionUIRequests: [
            expect.objectContaining({
              id: 'ui-1',
              method: 'select',
              variant: 'danger',
            }),
          ],
          leafId: 'visible-leaf',
          modelId: 'gpt-test',
          modelProvider: 'openai',
          sessionName: 'Current session',
        }),
      },
      'chat',
    );
  });

  it('includes the active changes review summary in state snapshots', async () => {
    const publishEvent = vi.fn();
    const service = new StateProtocolService({
      sessionManager: makeSessionManager({
        getActiveChangesReview: vi.fn(() => ({
          turnId: 'turn-1',
          fileCount: 1,
          additions: 19,
          deletions: 19,
          files: [{ path: 'src/app.ts', additions: 19, deletions: 19 }],
        })),
      } as Partial<ExtensionSessionCoordinator>),
      configManager: makeConfigManager(),
      getCommands: () => [],
      getBusyState: () => ({ kind: 'agent', label: 'Working', cancellable: true }),
      getExtensionUIRequests: () => [],
      publishEvent,
    });

    await service.pushState('chat');

    expect(publishEvent).toHaveBeenCalledWith(
      {
        type: 'state_update',
        state: expect.objectContaining({
          activeChangesReview: {
            turnId: 'turn-1',
            fileCount: 1,
            additions: 19,
            deletions: 19,
            files: [{ path: 'src/app.ts', additions: 19, deletions: 19 }],
          },
        }),
      },
      'chat',
    );
  });

  it('posts queue and config updates while context usage requests return a result', async () => {
    const sessionManager = makeSessionManager();
    const configManager = makeConfigManager({ provider: 'anthropic' });
    const publishEvent = vi.fn();
    const service = new StateProtocolService({
      sessionManager,
      configManager,
      getCommands: () => [],
      getBusyState: () => ({ kind: 'idle', cancellable: false }),
      getExtensionUIRequests: () => [],
      publishEvent,
    });
    const respond = vi.fn();

    service.pushQueueState('tree');
    service.pushConfig('chat');
    await service.requestContextUsage(respond);

    expect(publishEvent).toHaveBeenCalledWith(
      { type: 'queue_update', queueState: { pending: [], activeId: undefined } },
      'tree',
    );
    expect(publishEvent).toHaveBeenCalledWith(
      { type: 'config_update', config: { provider: 'anthropic' } },
      'chat',
    );
    expect(respond).toHaveBeenCalledWith({
      type: 'context_usage_result',
      contextUsage: {
        usedTokens: 100,
        maxTokens: 200,
        percentage: 50,
      },
    });
    expect(sessionManager.getSessionName).not.toHaveBeenCalled();
  });
});
