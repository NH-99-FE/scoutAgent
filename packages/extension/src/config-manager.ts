// ============================================================
// 配置管理器 — SettingsManager + ModelsConfigManager + 模型解析门面
// ============================================================

import { getSupportedThinkingLevels } from '@scout-agent/ai';
import type { Model, Api, ThinkingBudgets, Transport } from '@scout-agent/ai';
import { SCOUT_MODEL_PROVIDERS, THINKING_LEVELS } from '@scout-agent/shared';
import type {
  ScoutConfig,
  ScoutCustomModelsSaveSettings,
  ScoutCustomModelsSettings,
  ScoutModelProvider,
  ScoutRuntimeSettingsPatch,
  ScoutSettingsScope,
  ThinkingLevel,
} from '@scout-agent/shared';
import { SettingsManager } from './settings-manager.ts';
import { ModelsConfigManager } from './models-config-manager.ts';
import { ScoutModelRegistry } from './core/model-registry.ts';
import { ScoutModelResolver, type ModelResolution } from './core/model-resolver.ts';
import type { CompactionSettings } from './core/compaction/index.ts';
import type {
  BranchSummarySettings,
  ProviderRetrySettings,
  RetrySettings,
  ScoutCoreConfig,
  ScoutStreamOptions,
} from './core/config.ts';
import type { ScoutResourceSettingsSnapshot } from './core/package-manager.ts';
import type { QueueMode } from '@scout-agent/agent';

const THINKING_LEVEL_SET = new Set<string>(THINKING_LEVELS);
const SCOUT_MODEL_PROVIDER_SET = new Set<string>(SCOUT_MODEL_PROVIDERS);

export interface ConfigManagerOptions {
  cwd: string;
  userConfigDir?: string;
}

// ---------- ConfigManager ----------

export class ConfigManager implements ScoutCoreConfig {
  readonly cwd: string;
  private readonly settingsManager: SettingsManager;
  private readonly modelsConfigManager: ModelsConfigManager;
  private readonly modelRegistry: ScoutModelRegistry;
  private readonly modelResolver: ScoutModelResolver;

  constructor(options: ConfigManagerOptions) {
    this.cwd = options.cwd;
    this.settingsManager = new SettingsManager({
      cwd: this.cwd,
      userConfigDir: options.userConfigDir,
    });
    this.modelsConfigManager = new ModelsConfigManager({
      userConfigDir: options.userConfigDir,
    });
    this.modelRegistry = new ScoutModelRegistry({
      hasApiKey: (provider) => !!this.getApiKey(provider),
    });
    this.modelResolver = new ScoutModelResolver(this.modelRegistry);
    this.reloadCustomModels();
  }

  reload(): void {
    this.settingsManager.reload();
    this.modelsConfigManager.reload();
    this.reloadCustomModels();
  }

  // ---------- 设置页协议数据 ----------

  getCustomModelsSettings(): ScoutCustomModelsSettings {
    return this.modelsConfigManager.getSettings();
  }

  saveCustomModels(settings: ScoutCustomModelsSaveSettings): ScoutCustomModelsSettings {
    const normalized = this.modelsConfigManager.save(settings);
    this.reloadCustomModels();
    return normalized;
  }

  getRuntimeSettings(): ReturnType<SettingsManager['getSnapshot']> {
    return this.settingsManager.getSnapshot();
  }

  saveRuntimeSettings(
    scope: ScoutSettingsScope,
    patch: ScoutRuntimeSettingsPatch,
  ): ReturnType<SettingsManager['getSnapshot']> {
    const snapshot = this.settingsManager.save(scope, patch);
    return snapshot;
  }

  setDefaultModel(provider: string, modelId: string, scope: ScoutSettingsScope = 'global'): void {
    const model = this.modelRegistry.getModel(provider, modelId);
    if (!model) {
      throw new Error(`Model not found: ${provider}/${modelId}`);
    }
    if (!this.modelRegistry.hasConfiguredAuth(model)) {
      throw new Error(`Model auth is not configured: ${provider}/${modelId}`);
    }

    if (!isScoutModelProvider(model.provider)) {
      throw new Error(`Unsupported model provider: ${model.provider}`);
    }

    this.settingsManager.save(scope, {
      operations: [
        { op: 'set', path: 'defaultProvider', value: model.provider },
        { op: 'set', path: 'defaultModel', value: modelId },
      ],
    });
  }

  // ---------- Core 配置读取 ----------

  getApiKey(provider: string): string | undefined {
    return this.modelsConfigManager.getApiKey(provider);
  }

  getShellPath(): string | undefined {
    return this.settingsManager.getEffectiveSettings().shellPath;
  }

  getDefaultModel(): string | undefined {
    const settings = this.settingsManager.getEffectiveSettings();
    if (settings.defaultProvider && settings.defaultModel) {
      return `${settings.defaultProvider}/${settings.defaultModel}`;
    }
    return settings.defaultModel;
  }

  getDefaultThinkingLevel(): ThinkingLevel | undefined {
    return this.settingsManager.getEffectiveSettings().defaultThinkingLevel;
  }

  getCompactionSettings(): CompactionSettings {
    const compaction = this.settingsManager.getEffectiveSettings().compaction;
    return {
      enabled: compaction?.enabled ?? true,
      reserveTokens: compaction?.reserveTokens ?? 16384,
      keepRecentTokens: compaction?.keepRecentTokens ?? 20000,
    };
  }

  getBranchSummarySettings(): BranchSummarySettings {
    const branchSummary = this.settingsManager.getEffectiveSettings().branchSummary;
    return {
      reserveTokens: branchSummary?.reserveTokens ?? 16384,
      skipPrompt: branchSummary?.skipPrompt ?? false,
    };
  }

  getSteeringMode(): QueueMode {
    return this.settingsManager.getEffectiveSettings().steeringMode ?? 'one-at-a-time';
  }

  getFollowUpMode(): QueueMode {
    return this.settingsManager.getEffectiveSettings().followUpMode ?? 'one-at-a-time';
  }

  getRetrySettings(): RetrySettings {
    const retry = this.settingsManager.getEffectiveSettings().retry;
    return {
      enabled: retry?.enabled ?? true,
      maxRetries: retry?.maxRetries ?? 3,
      baseDelayMs: retry?.baseDelayMs ?? 2000,
    };
  }

  getProviderRetrySettings(): ProviderRetrySettings {
    const provider = this.settingsManager.getEffectiveSettings().retry?.provider;
    return {
      timeoutMs: provider?.timeoutMs,
      maxRetries: provider?.maxRetries,
      maxRetryDelayMs: provider?.maxRetryDelayMs ?? 60000,
    };
  }

  getTransport(): Transport {
    return (this.settingsManager.getEffectiveSettings().transport ?? 'auto') as Transport;
  }

  getThinkingBudgets(): ThinkingBudgets | undefined {
    const budgets = this.settingsManager.getEffectiveSettings().thinkingBudgets;
    return budgets && typeof budgets === 'object' ? (budgets as ThinkingBudgets) : undefined;
  }

  getWebSocketConnectTimeoutMs(): number | undefined {
    return this.settingsManager.getEffectiveSettings().websocketConnectTimeoutMs;
  }

  getStreamOptions(): ScoutStreamOptions {
    const providerRetry = this.getProviderRetrySettings();
    return {
      transport: this.getTransport(),
      timeoutMs: providerRetry.timeoutMs,
      maxRetries: providerRetry.maxRetries,
      maxRetryDelayMs: providerRetry.maxRetryDelayMs,
      websocketConnectTimeoutMs: this.getWebSocketConnectTimeoutMs(),
      thinkingBudgets: this.getThinkingBudgets(),
    };
  }

  getExtensionPaths(): string[] {
    return this.settingsManager.getEffectiveSettings().extensions ?? [];
  }

  getResourceSettings(): ScoutResourceSettingsSnapshot {
    const pickResourceSettings = (
      settings: ReturnType<SettingsManager['getEffectiveSettings']>,
    ) => ({
      packages: settings.packages,
      extensions: settings.extensions,
      skills: settings.skills,
      prompts: settings.prompts,
    });
    return {
      global: pickResourceSettings(this.settingsManager.getGlobalSettings()),
      project: pickResourceSettings(this.settingsManager.getProjectSettings()),
    };
  }

  private reloadCustomModels(): void {
    this.modelRegistry.setCustomModels(this.modelsConfigManager.getConfiguredModels());
  }

  // ---------- 模型解析 ----------

  getAvailableModels(): { id: string; name: string; provider: string; model: Model<Api> }[] {
    return this.modelResolver.getAvailableModels();
  }

  findDefaultModel(): Model<Api> | undefined {
    return this.resolveDefaultModel().model;
  }

  resolveDefaultModel(): ModelResolution {
    return this.modelResolver.resolveDefaultModel(this.getDefaultModel());
  }

  findModel(modelId: string): Model<Api> | undefined {
    return this.modelResolver.findModel(modelId);
  }

  findModelByProvider(provider: string, modelId: string): Model<Api> | undefined {
    return this.modelRegistry.getModel(provider, modelId);
  }

  getScoutConfig(): ScoutConfig {
    const available = this.getAvailableModels();
    const defaultModel = this.findDefaultModel();
    return {
      models: available.map((m) => ({
        provider: m.provider,
        id: m.id,
        name: m.name,
        supportedThinkingLevels: getSupportedThinkingLevels(m.model).filter(isThinkingLevel),
        input: m.model.input,
        contextWindow: m.model.contextWindow,
      })),
      defaultModelProvider: defaultModel?.provider ?? '',
      defaultModelId: defaultModel?.id ?? '',
      branchSummary: this.getBranchSummarySettings(),
    };
  }

  hasConfiguredModelAuth(model: Model<Api>): boolean {
    return this.modelRegistry.hasConfiguredAuth(model);
  }
}

function isThinkingLevel(level: string): level is ThinkingLevel {
  return THINKING_LEVEL_SET.has(level);
}

function isScoutModelProvider(provider: string): provider is ScoutModelProvider {
  return SCOUT_MODEL_PROVIDER_SET.has(provider);
}
