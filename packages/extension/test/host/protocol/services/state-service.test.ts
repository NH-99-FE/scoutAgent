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
    currentCwd: '/workspace',
    sessionId: 'session-1',
    sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
    parentSessionPath: undefined,
    diagnostics: [],
    modelFallbackMessage: undefined,
    ...overrides,
  } as unknown as ExtensionSessionCoordinator;
}

function makeConfigManager(config = { provider: 'openai' }): ConfigManager {
  return {
    getScoutConfig: vi.fn(() => config),
  } as unknown as ConfigManager;
}

describe('StateProtocolService', () => {
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
          leafId: 'visible-leaf',
          modelId: 'gpt-test',
          modelProvider: 'openai',
          sessionName: 'Current session',
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
