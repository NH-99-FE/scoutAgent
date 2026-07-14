import { describe, expect, it, vi } from 'vitest';
import type {
  ScoutCustomModelsSaveSettings,
  ScoutCustomModelsSettings,
  ScoutRuntimeSettingsState,
} from '@scout-agent/shared';
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
    setToolProfile: vi.fn(async () => undefined),
    reload: vi.fn(async () => ({ cancelled: false })),
    ...overrides,
  } as unknown as ExtensionSessionCoordinator;
}

function makeConfigManager(): ConfigManager {
  const customModels = makeCustomModelsSettings();
  const runtimeSettings = makeRuntimeSettingsState();
  return {
    setDefaultModel: vi.fn(),
    getCustomModelsSettings: vi.fn(() => customModels),
    saveCustomModels: vi.fn(() => customModels),
    getRuntimeSettings: vi.fn(() => runtimeSettings),
    saveRuntimeSettings: vi.fn(() => runtimeSettings),
    getScoutConfig: vi.fn(() => ({
      models: [],
      defaultModelProvider: 'openai',
      defaultModelId: 'gpt-test',
      branchSummary: { reserveTokens: 100, skipPrompt: false },
    })),
  } as unknown as ConfigManager;
}

function makeCustomModelsSettings(): ScoutCustomModelsSettings {
  return {
    modelsPath: '/home/me/.scout/agent/models.json',
    providerMetadata: {
      openai: {
        provider: 'openai',
        defaultBaseUrl: 'https://api.openai.com/v1',
        defaultApi: 'openai-completions',
        supportedApis: ['openai-completions', 'openai-responses'],
      },
      anthropic: {
        provider: 'anthropic',
        defaultBaseUrl: 'https://api.anthropic.com',
        defaultApi: 'anthropic-messages',
        supportedApis: ['anthropic-messages'],
      },
    },
    providers: {
      openai: {
        apiKey: 'openai-key',
        baseUrl: 'https://api.openai.com/v1',
        api: 'openai-completions',
        models: [],
        modelOverrides: {},
      },
      anthropic: {
        apiKey: '',
        baseUrl: 'https://api.anthropic.com',
        api: 'anthropic-messages',
        models: [],
        modelOverrides: {},
      },
    },
  };
}

function makeCustomModelsSaveSettings(): ScoutCustomModelsSaveSettings {
  return {
    providers: {
      openai: {
        apiKey: 'openai-key',
        baseUrl: 'https://api.openai.com/v1',
        api: 'openai-completions',
        models: [],
        modelOverrides: {},
      },
    },
  };
}

function makeRuntimeSettingsState(): ScoutRuntimeSettingsState {
  return {
    globalSettingsPath: '/home/me/.scout/agent/settings.json',
    projectSettingsPath: '/workspace/.scout/settings.json',
    global: { defaultProvider: 'openai', defaultModel: 'gpt-test' },
    project: {},
    effective: { defaultProvider: 'openai', defaultModel: 'gpt-test' },
  };
}

function makeService(
  options: {
    sessionManager?: ExtensionSessionCoordinator;
    configManager?: ConfigManager;
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
  const configManager = options.configManager ?? makeConfigManager();
  const service = new ConfigProtocolService({
    sessionManager: options.sessionManager ?? makeSessionManager(),
    configManager,
    sessionIndex,
    pushConfig: options.pushConfig ?? vi.fn(),
    requestCommands: options.requestCommands ?? vi.fn(),
    pushState: options.pushState ?? vi.fn(async () => undefined),
    pushTreeData: options.pushTreeData ?? vi.fn(async () => undefined),
  });
  return { service, sessionIndex, listAll, configManager };
}

describe('ConfigProtocolService', () => {
  it('delegates model, thinking, and tool profile changes to the session coordinator', async () => {
    const sessionManager = makeSessionManager();
    const { service } = makeService({ sessionManager });

    await service.setModel({ type: 'select_model', provider: 'openai', modelId: 'gpt-test' });
    await service.setThinkingLevel({ type: 'select_thinking', level: 'high' });
    service.setToolProfile({ type: 'set_tool_profile', profileId: 'review' });

    expect(sessionManager.setModel).toHaveBeenCalledWith('gpt-test', 'openai');
    expect(sessionManager.setThinkingLevel).toHaveBeenCalledWith('high');
    expect(sessionManager.setToolProfile).toHaveBeenCalledWith('review');
  });

  it('returns editable custom models and runtime settings from the config manager', () => {
    const respond = vi.fn();
    const configManager = makeConfigManager();
    const { service } = makeService({ configManager });

    service.requestCustomModels(respond);
    service.requestRuntimeSettings(respond);

    expect(respond).toHaveBeenNthCalledWith(1, {
      type: 'custom_models_result',
      settings: makeCustomModelsSettings(),
    });
    expect(respond).toHaveBeenNthCalledWith(2, {
      type: 'runtime_settings_result',
      settings: makeRuntimeSettingsState(),
    });
  });

  it('persists the default model, applies it to the current session, and refreshes projections', async () => {
    const calls: string[] = [];
    const sessionManager = makeSessionManager({
      setModel: vi.fn(async () => {
        calls.push('model');
      }),
    });
    const pushConfig = vi.fn(() => calls.push('config'));
    const pushState = vi.fn(async () => {
      calls.push('state');
    });
    const pushTreeData = vi.fn(async () => {
      calls.push('tree');
    });
    const respond = vi.fn((payload) => {
      calls.push(`respond:${payload.success}`);
    });
    const configManager = makeConfigManager();
    const { service } = makeService({
      sessionManager,
      configManager,
      pushConfig,
      pushState,
      pushTreeData,
    });

    await service.setDefaultModel(
      { type: 'set_default_model', provider: 'openai', modelId: 'gpt-test', scope: 'project' },
      respond,
    );

    expect(configManager.setDefaultModel).toHaveBeenCalledWith('openai', 'gpt-test', 'project');
    expect(sessionManager.setModel).toHaveBeenCalledWith('gpt-test', 'openai');
    expect(respond).toHaveBeenCalledWith({
      type: 'set_default_model_result',
      success: true,
    });
    expect(calls).toEqual(['model', 'respond:true', 'config', 'state', 'tree']);
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

  it('saves custom models, reloads runtime, and refreshes config, commands, state, and tree', async () => {
    const calls: string[] = [];
    const configManager = makeConfigManager();
    const pushConfig = vi.fn(() => calls.push('config'));
    const requestCommands = vi.fn(() => calls.push('commands'));
    const pushState = vi.fn(async () => {
      calls.push('state');
    });
    const pushTreeData = vi.fn(async () => {
      calls.push('tree');
    });
    const respond = vi.fn((payload) => {
      calls.push(`respond:${payload.success}`);
    });
    const { service } = makeService({
      configManager,
      pushConfig,
      requestCommands,
      pushState,
      pushTreeData,
    });
    const settings = makeCustomModelsSaveSettings();

    await service.saveCustomModels({ type: 'save_custom_models', settings }, respond);

    expect(configManager.saveCustomModels).toHaveBeenCalledWith(settings);
    expect(respond).toHaveBeenCalledWith({
      type: 'save_custom_models_result',
      success: true,
      error: undefined,
      settings: makeCustomModelsSettings(),
    });
    expect(calls).toEqual(['respond:true', 'config', 'commands', 'state', 'tree']);
  });

  it('reports manager custom model validation errors without reloading runtime', async () => {
    const sessionManager = makeSessionManager();
    const configManager = makeConfigManager();
    vi.mocked(configManager.saveCustomModels).mockImplementation(() => {
      throw new Error('openai/bad-model.maxTokens must be greater than 0');
    });
    const respond = vi.fn();
    const { service } = makeService({ configManager, sessionManager });

    await service.saveCustomModels(
      { type: 'save_custom_models', settings: makeCustomModelsSaveSettings() },
      respond,
    );

    expect(respond).toHaveBeenCalledWith({
      type: 'save_custom_models_result',
      success: false,
      error: 'openai/bad-model.maxTokens must be greater than 0',
    });
    expect(sessionManager.reload).not.toHaveBeenCalled();
  });

  it('saves runtime settings, reloads runtime, and refreshes config, commands, state, and tree', async () => {
    const calls: string[] = [];
    const configManager = makeConfigManager();
    const pushConfig = vi.fn(() => calls.push('config'));
    const requestCommands = vi.fn(() => calls.push('commands'));
    const pushState = vi.fn(async () => {
      calls.push('state');
    });
    const pushTreeData = vi.fn(async () => {
      calls.push('tree');
    });
    const respond = vi.fn((payload) => {
      calls.push(`respond:${payload.success}`);
    });
    const { service } = makeService({
      configManager,
      pushConfig,
      requestCommands,
      pushState,
      pushTreeData,
    });
    const patch = {
      operations: [
        {
          op: 'set' as const,
          path: 'extensions' as const,
          value: ['/workspace/.scout/extensions/hello'],
        },
      ],
    };

    await service.saveRuntimeSettings(
      { type: 'save_runtime_settings', scope: 'project', patch },
      respond,
    );

    expect(configManager.saveRuntimeSettings).toHaveBeenCalledWith('project', patch);
    expect(respond).toHaveBeenCalledWith({
      type: 'save_runtime_settings_result',
      success: true,
      error: undefined,
      settings: makeRuntimeSettingsState(),
    });
    expect(calls).toEqual(['respond:true', 'config', 'commands', 'state', 'tree']);
  });

  it('reports manager runtime settings validation errors without reloading runtime', async () => {
    const sessionManager = makeSessionManager();
    const configManager = makeConfigManager();
    vi.mocked(configManager.saveRuntimeSettings).mockImplementation(() => {
      throw new Error('defaultProvider must be one of openai, anthropic');
    });
    const respond = vi.fn();
    const { service } = makeService({ configManager, sessionManager });

    await service.saveRuntimeSettings(
      {
        type: 'save_runtime_settings',
        scope: 'global',
        patch: {
          operations: [{ op: 'set', path: 'defaultProvider', value: 'openrouter' }],
        },
      },
      respond,
    );

    expect(respond).toHaveBeenCalledWith({
      type: 'save_runtime_settings_result',
      success: false,
      error: 'defaultProvider must be one of openai, anthropic',
    });
    expect(sessionManager.reload).not.toHaveBeenCalled();
  });

  it('reports saved settings as successful when runtime reload is cancelled', async () => {
    const calls: string[] = [];
    const configManager = makeConfigManager();
    const pushConfig = vi.fn(() => calls.push('config'));
    const pushState = vi.fn(async () => {
      calls.push('state');
    });
    const pushTreeData = vi.fn(async () => {
      calls.push('tree');
    });
    const respond = vi.fn((payload) => {
      calls.push(`respond:${payload.success}`);
    });
    const patch = {
      operations: [
        { op: 'set' as const, path: 'defaultProvider' as const, value: 'openai' },
        { op: 'set' as const, path: 'defaultModel' as const, value: 'gpt-next' },
      ],
    };
    const { service } = makeService({
      configManager,
      sessionManager: makeSessionManager({
        reload: vi.fn(async () => ({ cancelled: true })),
      }),
      pushConfig,
      pushState,
      pushTreeData,
    });

    await service.saveRuntimeSettings(
      { type: 'save_runtime_settings', scope: 'global', patch },
      respond,
    );

    expect(configManager.saveRuntimeSettings).toHaveBeenCalledWith('global', patch);
    expect(respond).toHaveBeenCalledWith({
      type: 'save_runtime_settings_result',
      success: true,
      error: 'Runtime reload cancelled after saving settings',
      settings: makeRuntimeSettingsState(),
    });
    expect(calls).toEqual(['respond:true', 'config']);
    expect(pushState).not.toHaveBeenCalled();
    expect(pushTreeData).not.toHaveBeenCalled();
  });

  it('reports saved settings as successful when runtime reload throws', async () => {
    const calls: string[] = [];
    const configManager = makeConfigManager();
    const pushConfig = vi.fn(() => calls.push('config'));
    const pushState = vi.fn(async () => {
      calls.push('state');
    });
    const pushTreeData = vi.fn(async () => {
      calls.push('tree');
    });
    const respond = vi.fn((payload) => {
      calls.push(`respond:${payload.success}`);
    });
    const settings = makeCustomModelsSaveSettings();
    const { service } = makeService({
      configManager,
      sessionManager: makeSessionManager({
        reload: vi.fn(async () => {
          throw new Error('reload failed');
        }),
      }),
      pushConfig,
      pushState,
      pushTreeData,
    });

    await service.saveCustomModels({ type: 'save_custom_models', settings }, respond);

    expect(configManager.saveCustomModels).toHaveBeenCalledWith(settings);
    expect(respond).toHaveBeenCalledWith({
      type: 'save_custom_models_result',
      success: true,
      error: 'Runtime reload failed after saving settings: reload failed',
      settings: makeCustomModelsSettings(),
    });
    expect(calls).toEqual(['respond:true', 'config']);
    expect(pushState).not.toHaveBeenCalled();
    expect(pushTreeData).not.toHaveBeenCalled();
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
