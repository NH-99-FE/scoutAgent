// ============================================================
// Core config contracts
// 负责：定义 Agent core 所需配置能力，隔离 VS Code settings 来源。
// ============================================================

import type { Model, Api, SimpleStreamOptions, ThinkingBudgets, Transport } from '@scout-agent/ai';
import type { QueueMode, ThinkingLevel } from '@scout-agent/agent';
import type { CompactionSettings } from './compaction/index.ts';

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

export interface BranchSummarySettings {
  reserveTokens: number;
  skipPrompt: boolean;
}

export interface ScoutStreamOptions {
  transport?: Transport;
  timeoutMs?: number;
  maxRetries?: number;
  maxRetryDelayMs?: number;
  websocketConnectTimeoutMs?: SimpleStreamOptions['websocketConnectTimeoutMs'];
  headers?: Record<string, string>;
  metadata?: SimpleStreamOptions['metadata'];
  cacheRetention?: SimpleStreamOptions['cacheRetention'];
  thinkingBudgets?: ThinkingBudgets;
}

export interface ScoutCoreConfig {
  getApiKey(provider: string): string | undefined;
  getDefaultThinkingLevel(): ThinkingLevel | undefined;
  getCompactionSettings(): CompactionSettings;
  getBranchSummarySettings(): BranchSummarySettings;
  getSteeringMode(): QueueMode;
  getFollowUpMode(): QueueMode;
  getRetrySettings(): RetrySettings;
  getStreamOptions(): ScoutStreamOptions;
  getExtensionPaths(): string[];
  findDefaultModel(): Model<Api> | undefined;
  getAvailableModels(): { id: string; name: string; provider: string; model: Model<Api> }[];
  findModel(modelId: string): Model<Api> | undefined;
  findModelByProvider(provider: string, modelId: string): Model<Api> | undefined;
  hasConfiguredModelAuth(model: Model<Api>): boolean;
}
