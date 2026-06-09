// ============================================================
// 配置管理器 — VS Code settings + 项目级 .scout/settings.json + 模型解析
// 等价 Pi SettingsManager + ModelRegistry 的简化版
// ============================================================

import * as vscode from 'vscode';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Model, Api, ThinkingBudgets, Transport } from '@scout-agent/ai';
import type { ScoutConfig, ThinkingLevel } from '@scout-agent/shared';
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
import type { QueueMode } from '@scout-agent/agent';

const SECTION = 'scout-agent';
const VALID_TRANSPORTS: Transport[] = ['sse', 'websocket', 'websocket-cached', 'auto'];
const VALID_THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

export interface ConfigManagerOptions {
  cwd: string;
  agentDir: string;
  getConfiguration?: (section: string) => vscode.WorkspaceConfiguration;
}

// ---------- 深度合并 ----------

/**
 * 简单深度合并：对象递归合并，原生类型和数组后者覆盖。
 */
function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = { ...base };
  for (const key of Object.keys(override as Record<string, unknown>)) {
    const baseVal = (base as Record<string, unknown>)[key];
    const overVal = (override as Record<string, unknown>)[key];
    if (
      overVal !== undefined &&
      overVal !== null &&
      typeof overVal === 'object' &&
      !Array.isArray(overVal) &&
      typeof baseVal === 'object' &&
      baseVal !== null &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(baseVal as object, overVal as Partial<object>);
    } else if (overVal !== undefined) {
      result[key] = overVal;
    }
  }
  return result as T;
}

// ---------- 项目级配置 ----------

interface ProjectSettings {
  [key: string]: unknown;
}

function loadJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const content = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function loadProjectSettings(cwd: string): ProjectSettings {
  return loadJsonObject(join(cwd, '.scout', 'settings.json'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readCost(value: unknown): Model<Api>['cost'] | undefined {
  if (!isRecord(value)) return undefined;
  const input = readNumber(value.input);
  const output = readNumber(value.output);
  const cacheRead = readNumber(value.cacheRead);
  const cacheWrite = readNumber(value.cacheWrite);
  if (
    input === undefined ||
    output === undefined ||
    cacheRead === undefined ||
    cacheWrite === undefined
  ) {
    return undefined;
  }
  return { input, output, cacheRead, cacheWrite };
}

function parseConfiguredModel(value: unknown): Model<Api> | undefined {
  if (!isRecord(value)) return undefined;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : id;
  const provider = typeof value.provider === 'string' ? value.provider.trim() : '';
  if (!id || !name || (provider !== 'anthropic' && provider !== 'openai')) return undefined;

  const api =
    typeof value.api === 'string'
      ? value.api
      : provider === 'anthropic'
        ? 'anthropic-messages'
        : 'openai-completions';
  if (provider === 'anthropic' && api !== 'anthropic-messages') return undefined;
  if (provider === 'openai' && api !== 'openai-completions' && api !== 'openai-responses') {
    return undefined;
  }

  const baseUrl =
    typeof value.baseUrl === 'string' && value.baseUrl.trim()
      ? value.baseUrl.trim()
      : provider === 'anthropic'
        ? 'https://api.anthropic.com'
        : 'https://api.openai.com/v1';
  const input: Array<'text' | 'image'> = isStringArray(value.input)
    ? value.input.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image')
    : ['text'];
  const cost = readCost(value.cost);
  const contextWindow = readNumber(value.contextWindow);
  const maxTokens = readNumber(value.maxTokens);
  if (!cost || !contextWindow || !maxTokens || input.length === 0) return undefined;

  const model: Model<Api> = {
    id,
    name,
    api,
    provider,
    baseUrl,
    reasoning: typeof value.reasoning === 'boolean' ? value.reasoning : false,
    input,
    cost,
    contextWindow,
    maxTokens,
  };

  if (isRecord(value.thinkingLevelMap)) {
    model.thinkingLevelMap = value.thinkingLevelMap as Model<Api>['thinkingLevelMap'];
  }
  if (isRecord(value.headers)) {
    model.headers = value.headers as Record<string, string>;
  }
  if (isRecord(value.compat)) {
    model.compat = value.compat as Model<Api>['compat'];
  }
  return model;
}

function parseConfiguredModels(value: unknown): Model<Api>[] {
  const rawModels = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.models)
      ? value.models
      : [];
  return rawModels.flatMap((item) => {
    const model = parseConfiguredModel(item);
    return model ? [model] : [];
  });
}

// ---------- ConfigManager ----------

export class ConfigManager implements ScoutCoreConfig {
  readonly cwd: string;
  readonly agentDir: string;
  private readonly _getConfiguration: (section: string) => vscode.WorkspaceConfiguration;
  private readonly modelRegistry: ScoutModelRegistry;
  private readonly modelResolver: ScoutModelResolver;
  private projectSettings: ProjectSettings;

  constructor(options: ConfigManagerOptions) {
    this.cwd = options.cwd;
    this.agentDir = options.agentDir;
    this._getConfiguration = options.getConfiguration ?? vscode.workspace.getConfiguration;
    this.projectSettings = loadProjectSettings(this.cwd);
    this.modelRegistry = new ScoutModelRegistry({
      hasApiKey: (provider) => !!this.getApiKey(provider),
    });
    this.modelResolver = new ScoutModelResolver(this.modelRegistry);
    this.reloadCustomModels();
  }

  reload(): void {
    this.projectSettings = loadProjectSettings(this.cwd);
    this.reloadCustomModels();
  }

  // ---------- 配置读取（VS Code settings + 项目级合并） ----------

  private config(): vscode.WorkspaceConfiguration {
    return this._getConfiguration(SECTION);
  }

  /** 获取配置值，优先使用项目级设置，回退到 VS Code settings */
  private getSetting<T>(key: string, vscodeDefault?: T): T | undefined {
    // 项目级设置优先
    if (key in this.projectSettings) {
      return this.projectSettings[key] as T;
    }
    // 回退到 VS Code settings
    return this.config().get<T>(key) ?? vscodeDefault;
  }

  getApiKey(provider: string): string | undefined {
    switch (provider) {
      case 'anthropic':
        return this.getSetting<string>('anthropicApiKey') || undefined;
      case 'openai':
        return this.getSetting<string>('openaiApiKey') || undefined;
      default:
        return undefined;
    }
  }

  getShellPath(): string | undefined {
    return this.getSetting<string>('shellPath') || undefined;
  }

  getDefaultModel(): string | undefined {
    return this.getSetting<string>('defaultModel') || undefined;
  }

  getDefaultThinkingLevel(): ThinkingLevel | undefined {
    const level = this.getSetting<string>('defaultThinkingLevel');
    if (!level) return undefined;
    return VALID_THINKING_LEVELS.includes(level as ThinkingLevel)
      ? (level as ThinkingLevel)
      : undefined;
  }

  getCompactionSettings(): CompactionSettings {
    const projectCompaction = this.projectSettings.compaction as
      | Record<string, unknown>
      | undefined;
    const vscodeSettings: CompactionSettings = {
      enabled: this.config().get<boolean>('compaction.enabled') ?? true,
      reserveTokens: this.config().get<number>('compaction.reserveTokens') ?? 16384,
      keepRecentTokens: this.config().get<number>('compaction.keepRecentTokens') ?? 20000,
    };

    if (projectCompaction) {
      return deepMerge(vscodeSettings, projectCompaction as Partial<CompactionSettings>);
    }

    return vscodeSettings;
  }

  getBranchSummarySettings(): BranchSummarySettings {
    const projectBranchSummary = this.projectSettings.branchSummary as
      | Record<string, unknown>
      | undefined;
    const vscodeSettings: BranchSummarySettings = {
      reserveTokens: this.config().get<number>('branchSummary.reserveTokens') ?? 16384,
      skipPrompt: this.config().get<boolean>('branchSummary.skipPrompt') ?? false,
    };

    if (projectBranchSummary) {
      return deepMerge(vscodeSettings, projectBranchSummary as Partial<BranchSummarySettings>);
    }

    return vscodeSettings;
  }

  getSteeringMode(): QueueMode {
    return this.getSetting<QueueMode>('steeringMode') ?? 'one-at-a-time';
  }

  getFollowUpMode(): QueueMode {
    return this.getSetting<QueueMode>('followUpMode') ?? 'one-at-a-time';
  }

  getRetrySettings(): RetrySettings {
    return {
      enabled: this.getSetting<boolean>('retry.enabled', true) ?? true,
      maxRetries: this.getSetting<number>('retry.maxRetries', 3) ?? 3,
      baseDelayMs: this.getSetting<number>('retry.baseDelayMs', 2000) ?? 2000,
    };
  }

  getProviderRetrySettings(): ProviderRetrySettings {
    const projectRetry = this.projectSettings.retry as Record<string, unknown> | undefined;
    const projectProvider = projectRetry?.provider as Record<string, unknown> | undefined;
    return {
      timeoutMs:
        (projectProvider?.timeoutMs as number | undefined) ??
        this.config().get<number>('retry.provider.timeoutMs'),
      maxRetries:
        (projectProvider?.maxRetries as number | undefined) ??
        this.config().get<number>('retry.provider.maxRetries'),
      maxRetryDelayMs:
        (projectProvider?.maxRetryDelayMs as number | undefined) ??
        this.config().get<number>('retry.provider.maxRetryDelayMs') ??
        60000,
    };
  }

  getTransport(): Transport {
    const transport = this.getSetting<Transport>('transport', 'auto') ?? 'auto';
    return VALID_TRANSPORTS.includes(transport) ? transport : 'auto';
  }

  getThinkingBudgets(): ThinkingBudgets | undefined {
    const budgets = this.getSetting<ThinkingBudgets>('thinkingBudgets');
    if (!budgets || typeof budgets !== 'object') return undefined;
    return budgets;
  }

  getWebSocketConnectTimeoutMs(): number | undefined {
    return this.getSetting<number>('websocketConnectTimeoutMs');
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
    return this.getSetting<string[]>('extensionPaths') ?? [];
  }

  private reloadCustomModels(): void {
    const projectModels = parseConfiguredModels(this.projectSettings.models);
    const modelsFile = loadJsonObject(join(this.cwd, '.scout', 'models.json'));
    const fileModels = parseConfiguredModels(modelsFile);
    this.modelRegistry.setCustomModels([...projectModels, ...fileModels]);
  }

  // ---------- 模型解析 ----------

  /** 获取所有可用模型（已配置 API key 的） */
  getAvailableModels(): { id: string; name: string; provider: string; model: Model<Api> }[] {
    return this.modelResolver.getAvailableModels();
  }

  /** 查找默认模型 */
  findDefaultModel(): Model<Api> | undefined {
    return this.resolveDefaultModel().model;
  }

  resolveDefaultModel(): ModelResolution {
    return this.modelResolver.resolveDefaultModel(this.getDefaultModel());
  }

  /** 按 modelId 或 provider/modelId 查找模型，用于用户输入等宽松场景。 */
  findModel(modelId: string): Model<Api> | undefined {
    return this.modelResolver.findModel(modelId);
  }

  /** 按 provider + modelId 精确查找模型，用于 session 恢复等持久化场景。 */
  findModelByProvider(provider: string, modelId: string): Model<Api> | undefined {
    return this.modelRegistry.getModel(provider, modelId);
  }

  /** 获取 Webview 配置 */
  getScoutConfig(): ScoutConfig {
    const available = this.getAvailableModels();
    const defaultModel = this.findDefaultModel();
    return {
      models: available.map((m) => ({ provider: m.provider, id: m.id, name: m.name })),
      defaultModelProvider: defaultModel?.provider ?? '',
      defaultModelId: defaultModel?.id ?? '',
      branchSummary: this.getBranchSummarySettings(),
    };
  }

  hasConfiguredModelAuth(model: Model<Api>): boolean {
    return this.modelRegistry.hasConfiguredAuth(model);
  }

  // ---------- 配置变更监听 ----------

  onDidChangeSettings(callback: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(SECTION)) {
        callback();
      }
    });
  }
}
