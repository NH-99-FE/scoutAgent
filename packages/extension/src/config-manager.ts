// ============================================================
// 配置管理器 — VS Code settings + 项目级 .scout/settings.json + 模型解析
// 等价 Pi SettingsManager + ModelRegistry 的简化版
// ============================================================

import * as vscode from 'vscode';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Model, Api, ThinkingBudgets, Transport } from '@scout-agent/ai';
import { getModel, getModels, getProviders, getDefaultModel } from '@scout-agent/ai';
import type { AgentHarnessStreamOptions, CompactionSettings, QueueMode } from '@scout-agent/agent';
import type { ScoutConfig, ThinkingLevel } from '@scout-agent/shared';

// ---------- Retry 配置 ----------

export interface RetrySettings {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
}

export interface ProviderRetrySettings {
  timeoutMs?: number;
  maxRetries?: number;
  maxRetryDelayMs: number;
}

const SECTION = 'scout-agent';
const VALID_TRANSPORTS: Transport[] = ['sse', 'websocket', 'websocket-cached', 'auto'];

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

function loadProjectSettings(cwd: string): ProjectSettings {
  const settingsPath = join(cwd, '.scout', 'settings.json');
  if (!existsSync(settingsPath)) return {};

  try {
    const content = readFileSync(settingsPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

// ---------- ConfigManager ----------

export class ConfigManager {
  readonly cwd: string;
  readonly agentDir: string;
  private readonly _getConfiguration: (section: string) => vscode.WorkspaceConfiguration;
  private projectSettings: ProjectSettings;

  constructor(options: ConfigManagerOptions) {
    this.cwd = options.cwd;
    this.agentDir = options.agentDir;
    this._getConfiguration = options.getConfiguration ?? vscode.workspace.getConfiguration;
    this.projectSettings = loadProjectSettings(this.cwd);
  }

  reload(): void {
    this.projectSettings = loadProjectSettings(this.cwd);
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
    // 校验是否为合法 ThinkingLevel 值
    const valid: string[] = ['off', 'minimal', 'low', 'medium', 'high'];
    return valid.includes(level) ? (level as ThinkingLevel) : undefined;
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

  getStreamOptions(): AgentHarnessStreamOptions {
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

  // ---------- 模型解析 ----------

  /** 获取所有可用模型（已配置 API key 的） */
  getAvailableModels(): { id: string; name: string; provider: string; model: Model<Api> }[] {
    const result: { id: string; name: string; provider: string; model: Model<Api> }[] = [];
    for (const provider of getProviders()) {
      const apiKey = this.getApiKey(provider);
      if (!apiKey) continue;
      for (const model of getModels(provider)) {
        result.push({ id: model.id, name: model.name, provider: model.provider, model });
      }
    }
    return result;
  }

  /** 查找默认模型 */
  findDefaultModel(): Model<Api> | undefined {
    // 1. 用户指定的默认模型
    const defaultModelId = this.getDefaultModel();
    if (defaultModelId) {
      const model = this.findModel(defaultModelId);
      if (model) return model;
    }

    // 2. 内置默认模型（如果有 API key）
    const builtIn = getDefaultModel();
    if (builtIn && this.getApiKey(builtIn.provider)) {
      return builtIn as Model<Api>;
    }

    // 3. 第一个有 API key 的模型
    const available = this.getAvailableModels();
    return available[0]?.model;
  }

  /** 按 modelId 查找模型 */
  findModel(modelId: string): Model<Api> | undefined {
    for (const provider of getProviders()) {
      const model = getModel(provider, modelId);
      if (model) return model as Model<Api>;
    }
    return undefined;
  }

  /** 获取 Webview 配置 */
  getScoutConfig(): ScoutConfig {
    const available = this.getAvailableModels();
    const defaultModel = this.findDefaultModel();
    return {
      models: available.map((m) => ({ id: m.id, name: m.name })),
      defaultModelId: defaultModel?.id ?? '',
    };
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
