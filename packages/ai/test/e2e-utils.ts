// ============================================================
// E2E 测试辅助 — 凭证检测与模型构建
// ============================================================

import type { Model } from '../src/types';

/** 检查 Anthropic 凭证是否可用 */
export function hasAnthropicCredentials(): boolean {
  return !!import.meta.env.VITE_ANTHROPIC_API_KEY;
}

/** 检查 OpenAI 兼容凭证是否可用 */
export function hasOpenAICredentials(): boolean {
  return !!import.meta.env.VITE_OPENAI_API_KEY;
}

/** 获取 Anthropic base URL */
export function getAnthropicBaseUrl(): string {
  return import.meta.env.VITE_ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1';
}

/** 获取 OpenAI base URL */
export function getOpenAIBaseUrl(): string {
  return import.meta.env.VITE_OPENAI_BASE_URL || 'https://api.openai.com/v1';
}

/** 获取 OpenAI 兼容的 API Key */
export function getOpenAIApiKey(): string {
  return import.meta.env.VITE_OPENAI_API_KEY || '';
}

/** 获取 Anthropic API Key */
export function getAnthropicApiKey(): string {
  return import.meta.env.VITE_ANTHROPIC_API_KEY || '';
}

/** GLM-5.1（通过 OpenAI 兼容协议，支持思考） */
export function getGLM51(): Model<'openai-completions'> {
  return {
    id: 'GLM-5.1',
    name: 'GLM-5.1',
    api: 'openai-completions',
    provider: 'openai',
    baseUrl: getOpenAIBaseUrl(),
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: 'low', low: 'low', medium: 'medium', high: 'high' },
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: true,
      maxTokensField: 'max_tokens',
      requiresThinkingAsText: false,
    },
  };
}

/** GLM-5-Turbo（通过 OpenAI 兼容协议，不支持思考） — 保留兼容 */
export function getGLM5Turbo(): Model<'openai-completions'> {
  return {
    id: 'GLM-5-Turbo',
    name: 'GLM-5 Turbo',
    api: 'openai-completions',
    provider: 'openai',
    baseUrl: getOpenAIBaseUrl(),
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: true,
      maxTokensField: 'max_tokens',
    },
  };
}

/** Claude Haiku 4.5（通过 Anthropic 协议） */
export function getClaudeHaiku45(): Model<'anthropic-messages'> {
  return {
    id: 'Claude Haiku 4.5',
    name: 'Claude Haiku 4.5',
    api: 'anthropic-messages',
    provider: 'anthropic',
    baseUrl: getAnthropicBaseUrl(),
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    contextWindow: 200000,
    maxTokens: 8192,
    compat: {
      supportsEagerToolInputStreaming: true,
      supportsLongCacheRetention: true,
      forceAdaptiveThinking: false,
    },
  };
}

/** GLM-5.1（通过 Anthropic 协议，支持 thinking — budget 模式） */
export function getGLM51Anthropic(): Model<'anthropic-messages'> {
  return {
    id: 'GLM-5.1',
    name: 'GLM-5.1',
    api: 'anthropic-messages',
    provider: 'anthropic',
    baseUrl: getAnthropicBaseUrl(),
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: 'low', low: 'low', medium: 'medium', high: 'high' },
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
    compat: {
      supportsEagerToolInputStreaming: true,
      supportsLongCacheRetention: true,
      forceAdaptiveThinking: false,
    },
  };
}
