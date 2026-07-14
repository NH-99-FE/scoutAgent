import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ScoutRuntimeSettingsPath } from '@scout-agent/shared';
import { ConfigManager } from '../../src/config-manager.ts';
import { ModelsConfigManager } from '../../src/models-config-manager.ts';
import { SettingsManager } from '../../src/settings-manager.ts';

describe('SettingsManager', () => {
  let tempDir: string;
  let cwd: string;
  let userConfigDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-settings-test-'));
    cwd = path.join(tempDir, 'project');
    userConfigDir = path.join(tempDir, 'global');
    fs.mkdirSync(path.join(cwd, '.scout'), { recursive: true });
    fs.mkdirSync(userConfigDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('deep merges project settings over global settings', () => {
    writeJson(path.join(userConfigDir, 'settings.json'), {
      defaultProvider: 'openai',
      defaultModel: 'global-model',
      compaction: { enabled: true, reserveTokens: 999, keepRecentTokens: 20000 },
      retry: { provider: { timeoutMs: 300000, maxRetryDelayMs: 60000 } },
    });
    writeJson(path.join(cwd, '.scout', 'settings.json'), {
      defaultModel: 'project-model',
      compaction: { keepRecentTokens: 1234 },
    });

    const manager = new SettingsManager({ cwd, userConfigDir });

    expect(manager.getEffectiveSettings()).toMatchObject({
      defaultProvider: 'openai',
      defaultModel: 'project-model',
      compaction: { enabled: true, reserveTokens: 999, keepRecentTokens: 1234 },
      retry: { provider: { timeoutMs: 300000, maxRetryDelayMs: 60000 } },
    });
  });

  it('patches only the selected runtime settings paths in the selected scope', () => {
    const globalSettingsPath = path.join(userConfigDir, 'settings.json');
    const projectSettingsPath = path.join(cwd, '.scout', 'settings.json');
    writeJson(globalSettingsPath, {
      defaultProvider: 'openai',
      defaultModel: 'global-model',
      compaction: { reserveTokens: 1000 },
    });
    writeJson(projectSettingsPath, { defaultModel: 'project-model' });
    const manager = new SettingsManager({ cwd, userConfigDir });

    manager.save('global', {
      operations: [
        { op: 'set', path: 'defaultProvider', value: 'anthropic' },
        { op: 'set', path: 'defaultModel', value: 'claude-test' },
      ],
    });

    expect(readJson(globalSettingsPath)).toEqual({
      defaultProvider: 'anthropic',
      defaultModel: 'claude-test',
      compaction: { reserveTokens: 1000 },
    });
    expect(readJson(projectSettingsPath)).toEqual({ defaultModel: 'project-model' });

    manager.save('project', {
      operations: [
        { op: 'set', path: 'defaultModel', value: 'project-next' },
        { op: 'set', path: 'branchSummary.reserveTokens', value: 111 },
      ],
    });

    expect(readJson(globalSettingsPath)).toEqual({
      defaultProvider: 'anthropic',
      defaultModel: 'claude-test',
      compaction: { reserveTokens: 1000 },
    });
    expect(readJson(projectSettingsPath)).toEqual({
      defaultModel: 'project-next',
      branchSummary: { reserveTokens: 111 },
    });
  });

  it('wraps scoped settings writes in a file lock and releases it', () => {
    const projectSettingsPath = path.join(cwd, '.scout', 'settings.json');
    writeJson(projectSettingsPath, { defaultProvider: 'openai' });
    const manager = new SettingsManager({ cwd, userConfigDir });

    manager.save('project', {
      operations: [{ op: 'set', path: 'defaultModel', value: 'locked-model' }],
    });

    expect(readJson(projectSettingsPath)).toEqual({
      defaultProvider: 'openai',
      defaultModel: 'locked-model',
    });
    expect(fs.existsSync(`${projectSettingsPath}.lock`)).toBe(false);
  });

  it('preserves external edits to unrelated known runtime settings while saving a patch', () => {
    const settingsPath = path.join(cwd, '.scout', 'settings.json');
    writeJson(settingsPath, {
      defaultProvider: 'openai',
      defaultModel: 'project-model',
      retry: { maxRetries: 3 },
    });
    const manager = new SettingsManager({ cwd, userConfigDir });
    writeJson(settingsPath, {
      defaultProvider: 'anthropic',
      defaultModel: 'external-model',
      retry: { maxRetries: 5 },
    });

    manager.save('project', {
      operations: [{ op: 'set', path: 'defaultModel', value: 'patched-model' }],
    });

    expect(readJson(settingsPath)).toEqual({
      defaultProvider: 'anthropic',
      defaultModel: 'patched-model',
      retry: { maxRetries: 5 },
    });
  });

  it('reports invalid settings JSON and refuses to overwrite that scope on save', () => {
    const settingsPath = path.join(cwd, '.scout', 'settings.json');
    fs.writeFileSync(settingsPath, '{ invalid', 'utf-8');

    const manager = new SettingsManager({ cwd, userConfigDir });

    expect(manager.getSnapshot().error).toContain(`Settings JSON is invalid: ${settingsPath}`);
    expect(manager.getProjectSettings()).toEqual({});

    expect(() =>
      manager.save('project', {
        operations: [
          { op: 'set', path: 'defaultProvider', value: 'openai' },
          { op: 'set', path: 'defaultModel', value: 'gpt-test' },
        ],
      }),
    ).toThrow('Cannot save project settings while settings JSON is invalid');
    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe('{ invalid');
  });

  it('normalizes provider-scoped default model settings but keeps slash model ids', () => {
    writeJson(path.join(userConfigDir, 'settings.json'), {
      defaultProvider: 'openai',
      defaultModel: 'openai/gpt-test',
    });
    writeJson(path.join(cwd, '.scout', 'settings.json'), {
      defaultModel: 'vendor/project-gpt',
    });

    const manager = new SettingsManager({ cwd, userConfigDir });

    expect(manager.getGlobalSettings()).toEqual({
      defaultProvider: 'openai',
      defaultModel: 'gpt-test',
    });
    expect(manager.getProjectSettings()).toEqual({ defaultModel: 'vendor/project-gpt' });
    expect(manager.getSnapshot().error).toBeUndefined();
    expect(manager.getEffectiveSettings()).toEqual({
      defaultProvider: 'openai',
      defaultModel: 'vendor/project-gpt',
    });
  });

  it('normalizes resource settings and exposes them to core config', () => {
    writeJson(path.join(userConfigDir, 'settings.json'), {
      skills: ['~/skills/global'],
      packages: ['global-package'],
    });
    writeJson(path.join(cwd, '.scout', 'settings.json'), {
      skills: ['./skills/project'],
      packages: [{ source: '../package', skills: ['skills/*'] }],
    });

    const manager = new SettingsManager({ cwd, userConfigDir });
    expect(manager.getGlobalSettings()).toMatchObject({
      skills: ['~/skills/global'],
      packages: ['global-package'],
    });
    expect(manager.getProjectSettings()).toMatchObject({
      skills: ['./skills/project'],
      packages: [{ source: '../package', skills: ['skills/*'] }],
    });

    const configManager = new ConfigManager({ cwd, userConfigDir });
    expect(configManager.getResourceSettings()).toEqual({
      global: {
        packages: ['global-package'],
        extensions: undefined,
        skills: ['~/skills/global'],
        prompts: undefined,
      },
      project: {
        packages: [{ source: '../package', skills: ['skills/*'] }],
        extensions: undefined,
        skills: ['./skills/project'],
        prompts: undefined,
      },
    });
  });

  it('normalizes saving provider-scoped default model settings', () => {
    const globalSettingsPath = path.join(userConfigDir, 'settings.json');
    const manager = new SettingsManager({ cwd, userConfigDir });

    manager.save('global', {
      operations: [
        { op: 'set', path: 'defaultProvider', value: 'anthropic' },
        { op: 'set', path: 'defaultModel', value: 'openai/gpt-test' },
      ],
    });

    expect(readJson(globalSettingsPath)).toEqual({
      defaultProvider: 'openai',
      defaultModel: 'gpt-test',
    });
  });

  it('rejects invalid runtime setting enum values on save', () => {
    const manager = new SettingsManager({ cwd, userConfigDir });

    expect(() =>
      manager.save('global', {
        operations: [{ op: 'set', path: 'defaultProvider', value: 'openrouter' }],
      }),
    ).toThrow('defaultProvider must be one of openai, anthropic');
    expect(() =>
      manager.save('global', {
        operations: [{ op: 'set', path: 'defaultThinkingLevel', value: 'turbo' }],
      }),
    ).toThrow('defaultThinkingLevel must be one of off, minimal, low, medium, high, xhigh');
  });

  it('rejects blank custom tool profile names instead of silently dropping them', () => {
    const manager = new SettingsManager({ cwd, userConfigDir });

    expect(() =>
      manager.save('global', {
        operations: [
          {
            op: 'set',
            path: 'toolProfiles',
            value: [{ id: 'search-only', name: '   ', tools: ['read', 'grep'] }],
          },
        ],
      }),
    ).toThrow('toolProfiles[0].name must be a non-empty string');
  });

  it('validates default tool profile references after applying the complete patch', () => {
    const globalSettingsPath = path.join(userConfigDir, 'settings.json');
    const manager = new SettingsManager({ cwd, userConfigDir });

    manager.save('global', {
      operations: [
        {
          op: 'set',
          path: 'toolProfiles',
          value: [{ id: 'search-only', name: '只搜索', tools: ['read', 'grep'] }],
        },
        { op: 'set', path: 'defaultToolProfile', value: 'search-only' },
      ],
    });

    expect(() =>
      manager.save('global', {
        operations: [
          {
            op: 'set',
            path: 'toolProfiles',
            value: [{ id: 'renamed', name: '只搜索', tools: ['read', 'grep'] }],
          },
        ],
      }),
    ).toThrow('defaultToolProfile references unknown tool profile: search-only');
    expect(readJson(globalSettingsPath)).toMatchObject({
      defaultToolProfile: 'search-only',
      toolProfiles: [{ id: 'search-only' }],
    });
  });

  it('allows a project default to reference an inherited global tool profile', () => {
    writeJson(path.join(userConfigDir, 'settings.json'), {
      toolProfiles: [{ id: 'search-only', name: '只搜索', tools: ['read', 'grep'] }],
    });
    const manager = new SettingsManager({ cwd, userConfigDir });

    manager.save('project', {
      operations: [{ op: 'set', path: 'defaultToolProfile', value: 'search-only' }],
    });

    expect(manager.getEffectiveSettings()).toMatchObject({
      defaultToolProfile: 'search-only',
      toolProfiles: [{ id: 'search-only' }],
    });
  });

  it('saves a project profile override with an explicit builtin default', () => {
    writeJson(path.join(userConfigDir, 'settings.json'), {
      defaultToolProfile: 'global-search',
      toolProfiles: [{ id: 'global-search', name: '全局搜索', tools: ['read', 'grep'] }],
    });
    const manager = new SettingsManager({ cwd, userConfigDir });

    const snapshot = manager.save('project', {
      operations: [
        { op: 'set', path: 'defaultToolProfile', value: 'develop' },
        {
          op: 'set',
          path: 'toolProfiles',
          value: [{ id: 'project-search', name: '项目搜索', tools: ['read'] }],
        },
      ],
    });

    expect(snapshot.project).toMatchObject({
      defaultToolProfile: 'develop',
      toolProfiles: [{ id: 'project-search' }],
    });
    expect(snapshot.effective).toMatchObject({
      defaultToolProfile: 'develop',
      toolProfiles: [{ id: 'project-search' }],
    });
  });

  it('rejects invalid runtime numeric settings on save', () => {
    const manager = new SettingsManager({ cwd, userConfigDir });
    const invalidCases: Array<{ path: ScoutRuntimeSettingsPath; value: unknown; error: string }> = [
      {
        path: 'compaction.reserveTokens',
        value: -1,
        error: 'compaction.reserveTokens must be greater than 0',
      },
      {
        path: 'compaction.keepRecentTokens',
        value: 0,
        error: 'compaction.keepRecentTokens must be greater than 0',
      },
      {
        path: 'branchSummary.reserveTokens',
        value: 0,
        error: 'branchSummary.reserveTokens must be greater than 0',
      },
      {
        path: 'retry.maxRetries',
        value: -1,
        error: 'retry.maxRetries must be greater than or equal to 0',
      },
      {
        path: 'retry.baseDelayMs',
        value: -1000,
        error: 'retry.baseDelayMs must be between 0 and 2147483647',
      },
      {
        path: 'retry.provider.timeoutMs',
        value: -1,
        error: 'retry.provider.timeoutMs must be between 0 and 2147483647',
      },
      {
        path: 'retry.provider.maxRetries',
        value: 1.5,
        error: 'retry.provider.maxRetries must be an integer',
      },
      {
        path: 'websocketConnectTimeoutMs',
        value: 2_147_483_648,
        error: 'websocketConnectTimeoutMs must be between 0 and 2147483647',
      },
      {
        path: 'thinkingBudgets',
        value: { medium: -1 },
        error: 'thinkingBudgets.medium must be greater than 0',
      },
    ];

    for (const { path, value, error } of invalidCases) {
      expect(() =>
        manager.save('global', {
          operations: [{ op: 'set', path, value }],
        }),
      ).toThrow(error);
    }
  });

  it('reports invalid loaded runtime numbers and excludes them from effective settings', () => {
    const globalSettingsPath = path.join(userConfigDir, 'settings.json');
    writeJson(globalSettingsPath, {
      defaultProvider: 'openai',
      compaction: { reserveTokens: -1 },
      retry: { baseDelayMs: -1000, provider: { timeoutMs: -1 } },
      thinkingBudgets: { medium: -1 },
      websocketConnectTimeoutMs: 2_147_483_648,
    });

    const manager = new SettingsManager({ cwd, userConfigDir });

    expect(manager.getGlobalSettings()).toEqual({ defaultProvider: 'openai' });
    expect(manager.getEffectiveSettings()).toEqual({ defaultProvider: 'openai' });
    expect(manager.getSnapshot().error).toContain(
      `Settings config is invalid: ${globalSettingsPath}: compaction.reserveTokens must be greater than 0`,
    );
    expect(manager.getSnapshot().error).toContain(
      'retry.baseDelayMs must be between 0 and 2147483647',
    );
    expect(manager.getSnapshot().error).toContain(
      'retry.provider.timeoutMs must be between 0 and 2147483647',
    );
    expect(manager.getSnapshot().error).toContain('thinkingBudgets.medium must be greater than 0');
    expect(manager.getSnapshot().error).toContain(
      'websocketConnectTimeoutMs must be between 0 and 2147483647',
    );
  });
});

describe('ModelsConfigManager', () => {
  let tempDir: string;
  let userConfigDir: string;
  let originalEnvValue: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-models-test-'));
    userConfigDir = path.join(tempDir, 'global');
    fs.mkdirSync(userConfigDir, { recursive: true });
    originalEnvValue = process.env.SCOUT_TEST_OPENAI_KEY;
  });

  afterEach(() => {
    if (originalEnvValue === undefined) {
      delete process.env.SCOUT_TEST_OPENAI_KEY;
    } else {
      process.env.SCOUT_TEST_OPENAI_KEY = originalEnvValue;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads global provider API keys, custom models, and model overrides', () => {
    process.env.SCOUT_TEST_OPENAI_KEY = 'resolved-openai-key';
    writeJson(path.join(userConfigDir, 'models.json'), {
      providers: {
        openai: {
          apiKey: 'SCOUT_TEST_OPENAI_KEY',
          modelOverrides: {
            'gpt-4.1': { contextWindow: 123456, maxTokens: 4096 },
          },
          models: [
            {
              id: 'project-gpt',
              name: 'Project GPT',
              api: 'openai-responses',
              reasoning: true,
              thinkingLevelMap: { minimal: null, xhigh: 'max' },
              input: ['text'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 1000,
              maxTokens: 100,
            },
          ],
        },
      },
    });

    const manager = new ModelsConfigManager({ userConfigDir });

    expect(manager.getApiKey('openai')).toBe('resolved-openai-key');
    expect(manager.getConfiguredModels().find((model) => model.id === 'project-gpt')).toMatchObject(
      {
        provider: 'openai',
        name: 'Project GPT',
        api: 'openai-responses',
        contextWindow: 1000,
      },
    );
    expect(manager.getConfiguredModels().find((model) => model.id === 'gpt-4.1')).toMatchObject({
      provider: 'openai',
      contextWindow: 123456,
      maxTokens: 4096,
    });
  });

  it('reports invalid loaded models but rejects invalid saves', () => {
    writeJson(path.join(userConfigDir, 'models.json'), {
      providers: { openrouter: { apiKey: 'key' } },
    });
    expect(new ModelsConfigManager({ userConfigDir }).getSettings().error).toContain(
      'Unsupported model provider: openrouter',
    );

    const manager = new ModelsConfigManager({ userConfigDir });
    expect(() =>
      manager.save({
        providers: {
          openai: {
            apiKey: '',
            baseUrl: 'https://api.openai.com/v1',
            api: 'openai-completions',
            models: [
              {
                id: 'bad-model',
                name: 'Bad Model',
                api: 'openai-completions',
                baseUrl: 'https://api.openai.com/v1',
                reasoning: false,
                input: ['text'],
                contextWindow: 128000,
                maxTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
            modelOverrides: {},
          },
        },
      }),
    ).toThrow('openai/bad-model.maxTokens must be greater than 0');
    expect(() =>
      manager.save({
        providers: {
          openrouter: { apiKey: 'key' },
        },
      } as never),
    ).toThrow('Unsupported model provider: openrouter');
  });

  it('keeps provider defaults at provider level when saving custom models', () => {
    const modelsPath = path.join(userConfigDir, 'models.json');
    const manager = new ModelsConfigManager({ userConfigDir });

    manager.save({
      providers: {
        openai: {
          apiKey: 'openai-key',
          baseUrl: 'https://proxy.example.test/v1',
          api: 'openai-responses',
          headers: { 'x-provider': 'one' },
          compat: { supportsDeveloperRole: false },
          models: [
            {
              id: 'provider-gpt',
              contextWindow: 1000,
              maxTokens: 100,
            },
          ],
          modelOverrides: {},
        },
      },
    });

    expect(readJson(modelsPath)).toEqual({
      providers: {
        openai: {
          apiKey: 'openai-key',
          baseUrl: 'https://proxy.example.test/v1',
          api: 'openai-responses',
          headers: { 'x-provider': 'one' },
          compat: { supportsDeveloperRole: false },
          models: [{ id: 'provider-gpt', contextWindow: 1000, maxTokens: 100 }],
        },
      },
    });
    expect(
      manager.getConfiguredModels().find((model) => model.id === 'provider-gpt'),
    ).toMatchObject({
      provider: 'openai',
      api: 'openai-responses',
      baseUrl: 'https://proxy.example.test/v1',
      headers: { 'x-provider': 'one' },
      compat: { supportsDeveloperRole: false },
    });
    expect(fs.existsSync(`${modelsPath}.lock`)).toBe(false);
  });

  it('reports invalid models JSON through settings.error', () => {
    const modelsPath = path.join(userConfigDir, 'models.json');
    fs.writeFileSync(modelsPath, '{ invalid', 'utf-8');

    expect(new ModelsConfigManager({ userConfigDir }).getSettings().error).toContain(
      `Models JSON is invalid: ${modelsPath}`,
    );
  });
});

describe('ConfigManager', () => {
  let tempDir: string;
  let cwd: string;
  let userConfigDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-config-test-'));
    cwd = path.join(tempDir, 'project');
    userConfigDir = path.join(tempDir, 'user');
    fs.mkdirSync(path.join(cwd, '.scout'), { recursive: true });
    fs.mkdirSync(userConfigDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses effective settings for the default model and global models for availability', () => {
    writeJson(path.join(userConfigDir, 'settings.json'), {
      defaultProvider: 'openai',
      defaultModel: 'global-gpt',
      defaultThinkingLevel: 'off',
    });
    writeJson(path.join(cwd, '.scout', 'settings.json'), {
      defaultModel: 'project-gpt',
      steeringMode: 'all',
    });
    writeJson(path.join(userConfigDir, 'models.json'), {
      providers: {
        openai: {
          apiKey: 'openai-key',
          models: [
            {
              id: 'project-gpt',
              name: 'Project GPT',
              api: 'openai-completions',
              baseUrl: 'https://api.openai.com/v1',
              reasoning: false,
              input: ['text'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 1000,
              maxTokens: 100,
            },
          ],
          modelOverrides: {},
        },
      },
    });

    const manager = new ConfigManager({ cwd, userConfigDir });

    expect(manager.getDefaultModel()).toBe('openai/project-gpt');
    expect(manager.getDefaultThinkingLevel()).toBe('off');
    expect(manager.getSteeringMode()).toBe('all');
    expect(manager.findModelByProvider('openai', 'project-gpt')?.name).toBe('Project GPT');
  });

  it('projects the resolved default tool profile for new session composers', () => {
    writeJson(path.join(userConfigDir, 'settings.json'), {
      defaultToolProfile: 'review',
      toolProfiles: [{ id: 'search-only', name: '只搜索', tools: ['read', 'grep'] }],
    });

    const manager = new ConfigManager({ cwd, userConfigDir });

    expect(manager.getScoutConfig()).toMatchObject({
      defaultToolProfileId: 'review',
      toolProfiles: [
        { id: 'develop', name: '开发模式', builtin: true },
        { id: 'review', name: '审查模式', builtin: true },
        { id: 'search-only', name: '只搜索', tools: ['read', 'grep'], builtin: false },
      ],
    });
  });

  it('normalizes provider-scoped default model settings', () => {
    writeJson(path.join(userConfigDir, 'settings.json'), {
      defaultProvider: 'openai',
      defaultModel: 'openai/project-gpt',
    });
    writeJson(path.join(userConfigDir, 'models.json'), {
      providers: {
        openai: {
          apiKey: 'openai-key',
          models: [
            {
              id: 'project-gpt',
              name: 'Project GPT',
              api: 'openai-completions',
              baseUrl: 'https://api.openai.com/v1',
              reasoning: false,
              input: ['text'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 1000,
              maxTokens: 100,
            },
          ],
          modelOverrides: {},
        },
      },
    });

    const manager = new ConfigManager({ cwd, userConfigDir });

    expect(manager.getRuntimeSettings().global).toEqual({
      defaultProvider: 'openai',
      defaultModel: 'project-gpt',
    });
    expect(manager.getRuntimeSettings().error).toBeUndefined();
    expect(manager.getDefaultModel()).toBe('openai/project-gpt');
  });

  it('uses the default provider for unscoped custom model ids that contain slashes', () => {
    writeJson(path.join(userConfigDir, 'settings.json'), {
      defaultProvider: 'openai',
      defaultModel: 'vendor/project-gpt',
    });
    writeJson(path.join(userConfigDir, 'models.json'), {
      providers: {
        openai: {
          apiKey: 'openai-key',
          models: [
            {
              id: 'vendor/project-gpt',
              name: 'Vendor Project GPT',
              api: 'openai-completions',
              baseUrl: 'https://api.openai.com/v1',
              reasoning: false,
              input: ['text'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 1000,
              maxTokens: 100,
            },
          ],
          modelOverrides: {},
        },
      },
    });

    const manager = new ConfigManager({ cwd, userConfigDir });

    expect(manager.getDefaultModel()).toBe('openai/vendor/project-gpt');
    const resolution = manager.resolveDefaultModel();
    expect(resolution.model).toMatchObject({ id: 'vendor/project-gpt' });
    expect(resolution.warning).toBeUndefined();
  });

  it('does not read legacy project settings models or project models.json', () => {
    writeJson(path.join(cwd, '.scout', 'settings.json'), {
      openaiApiKey: 'legacy-key',
      models: [
        {
          id: 'legacy-settings-model',
          name: 'Legacy Settings Model',
          api: 'openai-completions',
          baseUrl: 'https://api.openai.com/v1',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1000,
          maxTokens: 100,
        },
      ],
    });
    writeJson(path.join(cwd, '.scout', 'models.json'), {
      providers: {
        openai: {
          apiKey: 'project-key',
          models: [
            {
              id: 'project-models-json',
              contextWindow: 1000,
              maxTokens: 100,
            },
          ],
        },
      },
    });

    const manager = new ConfigManager({ cwd, userConfigDir });

    expect(manager.getApiKey('openai')).toBeUndefined();
    expect(manager.findModelByProvider('openai', 'legacy-settings-model')).toBeUndefined();
    expect(manager.findModelByProvider('openai', 'project-models-json')).toBeUndefined();
  });

  it('writes default model changes to the selected settings scope', () => {
    const projectSettingsPath = path.join(cwd, '.scout', 'settings.json');
    writeJson(projectSettingsPath, {
      retry: { provider: { timeoutMs: 300000 } },
    });
    writeJson(path.join(userConfigDir, 'models.json'), {
      providers: {
        openai: {
          apiKey: 'openai-key',
          models: [
            {
              id: 'project-gpt-next',
              name: 'Project GPT Next',
              api: 'openai-completions',
              baseUrl: 'https://api.openai.com/v1',
              reasoning: false,
              input: ['text'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 2000,
              maxTokens: 200,
            },
          ],
          modelOverrides: {},
        },
      },
    });
    const manager = new ConfigManager({ cwd, userConfigDir });

    manager.setDefaultModel('openai', 'project-gpt-next', 'project');

    expect(readJson(projectSettingsPath)).toEqual({
      retry: { provider: { timeoutMs: 300000 } },
      defaultProvider: 'openai',
      defaultModel: 'project-gpt-next',
    });
    expect(manager.getDefaultModel()).toBe('openai/project-gpt-next');
  });

  it('saves custom models to global models.json and runtime settings to scoped settings.json', () => {
    const manager = new ConfigManager({ cwd, userConfigDir });

    manager.saveCustomModels({
      providers: {
        openai: {
          apiKey: 'openai-key',
          baseUrl: 'https://api.openai.com/v1',
          api: 'openai-completions',
          models: [
            {
              id: 'saved-gpt',
              name: 'Saved GPT',
              api: 'openai-completions',
              baseUrl: 'https://api.openai.com/v1',
              reasoning: false,
              input: ['text'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 1000,
              maxTokens: 100,
            },
          ],
          modelOverrides: {},
        },
      },
    });
    manager.saveRuntimeSettings('project', {
      operations: [
        { op: 'set', path: 'defaultProvider', value: 'openai' },
        { op: 'set', path: 'defaultModel', value: 'saved-gpt' },
      ],
    });

    expect(readJson(path.join(userConfigDir, 'models.json'))).toMatchObject({
      providers: {
        openai: {
          apiKey: 'openai-key',
          models: [{ id: 'saved-gpt', name: 'Saved GPT' }],
        },
      },
    });
    expect(readJson(path.join(cwd, '.scout', 'settings.json'))).toEqual({
      defaultProvider: 'openai',
      defaultModel: 'saved-gpt',
    });
    expect(manager.findModelByProvider('openai', 'saved-gpt')?.name).toBe('Saved GPT');
  });
});

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
}
