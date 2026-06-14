import { describe, expect, it, vi } from 'vitest';
import type { ConfigManager } from '../../../../src/config-manager.ts';
import type { JsonlSessionMetadata } from '../../../../src/core/session/index.ts';
import type { ExtensionSessionCoordinator } from '../../../../src/host/session-coordinator.ts';
import { SessionIndex } from '../../../../src/host/session-index.ts';
import { ConfigProtocolService } from '../../../../src/host/protocol/services/config-service.ts';

function makeSession(overrides: Partial<JsonlSessionMetadata> = {}): JsonlSessionMetadata {
  return {
    id: 'session-1',
    path: '/workspace/.scout/sessions/session-1.jsonl',
    cwd: '/workspace',
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-02T00:00:00.000Z',
    name: 'Visible session',
    firstMessage: 'hello',
    messageCount: 2,
    ...overrides,
  };
}

function makeSessionManager(overrides: Record<string, unknown> = {}): ExtensionSessionCoordinator {
  return {
    setModel: vi.fn(async () => undefined),
    setThinkingLevel: vi.fn(async () => undefined),
    setActiveTools: vi.fn(async () => undefined),
    reload: vi.fn(async () => ({ cancelled: false })),
    ...overrides,
  } as unknown as ExtensionSessionCoordinator;
}

function makeConfigManager(): ConfigManager {
  return {
    getScoutConfig: vi.fn(() => ({
      models: [],
      defaultModelProvider: 'openai',
      defaultModelId: 'gpt-test',
      branchSummary: { reserveTokens: 100, skipPrompt: false },
    })),
  } as unknown as ConfigManager;
}

function makeService(
  options: {
    sessionManager?: ExtensionSessionCoordinator;
    sessions?: JsonlSessionMetadata[];
    pushConfig?: (label?: string) => void;
    requestCommands?: (label?: string) => void;
    pushState?: (label?: string) => Promise<void>;
    pushTreeData?: (label?: string) => Promise<void>;
  } = {},
) {
  const listAll = vi.fn(async () => options.sessions ?? [makeSession()]);
  const sessionIndex = new SessionIndex({
    listWorkspace: vi.fn(async () => []),
    listAll,
  });
  const service = new ConfigProtocolService({
    sessionManager: options.sessionManager ?? makeSessionManager(),
    configManager: makeConfigManager(),
    sessionIndex,
    pushConfig: options.pushConfig ?? vi.fn(),
    requestCommands: options.requestCommands ?? vi.fn(),
    pushState: options.pushState ?? vi.fn(async () => undefined),
    pushTreeData: options.pushTreeData ?? vi.fn(async () => undefined),
  });
  return { service, sessionIndex, listAll };
}

describe('ConfigProtocolService', () => {
  it('delegates model, thinking, and active tool changes to the session coordinator', async () => {
    const sessionManager = makeSessionManager();
    const { service } = makeService({ sessionManager });

    await service.setModel({ type: 'select_model', provider: 'openai', modelId: 'gpt-test' });
    await service.setThinkingLevel({ type: 'select_thinking', level: 'high' });
    service.setActiveTools({ type: 'set_active_tools', toolNames: ['read_file', 'shell'] });

    expect(sessionManager.setModel).toHaveBeenCalledWith('gpt-test', 'openai');
    expect(sessionManager.setThinkingLevel).toHaveBeenCalledWith('high');
    expect(sessionManager.setActiveTools).toHaveBeenCalledWith(['read_file', 'shell']);
  });

  it('reloads resources, invalidates session index, and refreshes config, commands, state, and tree', async () => {
    const calls: string[] = [];
    const respond = vi.fn((payload) => {
      calls.push(`respond:${payload.success}`);
    });
    const pushConfig = vi.fn(() => calls.push('config'));
    const requestCommands = vi.fn(() => calls.push('commands'));
    const pushState = vi.fn(async () => {
      calls.push('state');
    });
    const pushTreeData = vi.fn(async () => {
      calls.push('tree');
    });
    const { service, sessionIndex, listAll } = makeService({
      pushConfig,
      requestCommands,
      pushState,
      pushTreeData,
    });
    await sessionIndex.list('all');

    await service.reloadResources(respond);
    await sessionIndex.list('all');

    expect(respond).toHaveBeenCalledWith({
      type: 'reload_result',
      success: true,
      error: undefined,
    });
    expect(calls).toEqual(['respond:true', 'config', 'commands', 'state', 'tree']);
    expect(listAll).toHaveBeenCalledTimes(2);
  });

  it('reports cancelled reloads without refreshing derived state', async () => {
    const respond = vi.fn();
    const pushState = vi.fn(async () => undefined);
    const { service } = makeService({
      sessionManager: makeSessionManager({
        reload: vi.fn(async () => ({ cancelled: true })),
      }),
      pushState,
    });

    await service.reloadResources(respond);

    expect(respond).toHaveBeenCalledWith({
      type: 'reload_result',
      success: false,
      error: 'cancelled',
    });
    expect(pushState).not.toHaveBeenCalled();
  });

  it('reports reload errors through the protocol response', async () => {
    const respond = vi.fn();
    const { service } = makeService({
      sessionManager: makeSessionManager({
        reload: vi.fn(async () => {
          throw new Error('reload failed');
        }),
      }),
    });

    await service.reloadResources(respond);

    expect(respond).toHaveBeenCalledWith({
      type: 'reload_result',
      success: false,
      error: 'reload failed',
    });
  });
});
