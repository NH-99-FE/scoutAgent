// ============================================================
// 模型定义 — Anthropic + OpenAI 模型
// ============================================================

import type { Api, Model, ModelThinkingLevel, Usage } from './types';

// ---------- Anthropic 模型 ----------

const CLAUDE_MODELS: Record<string, Model<'anthropic-messages'>> = {
  'claude-sonnet-4-20250514': {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    api: 'anthropic-messages',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: 'low', low: 'low', medium: 'medium', high: 'high' },
    input: ['text', 'image'],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200000,
    maxTokens: 64000,
    compat: {
      supportsEagerToolInputStreaming: true,
      supportsLongCacheRetention: true,
      forceAdaptiveThinking: true,
    },
  },
  'claude-opus-4-20250514': {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    api: 'anthropic-messages',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    reasoning: true,
    thinkingLevelMap: {
      off: null,
      minimal: 'low',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
    },
    input: ['text', 'image'],
    cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    contextWindow: 200000,
    maxTokens: 32000,
    compat: {
      supportsEagerToolInputStreaming: true,
      supportsLongCacheRetention: true,
      forceAdaptiveThinking: true,
    },
  },
  'claude-haiku-3-5-20241022': {
    id: 'claude-haiku-3-5-20241022',
    name: 'Claude 3.5 Haiku',
    api: 'anthropic-messages',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    contextWindow: 200000,
    maxTokens: 8192,
  },
};

// ---------- OpenAI 模型 ----------

const OPENAI_MODELS: Record<string, Model<'openai-completions'>> = {
  'gpt-4o': {
    id: 'gpt-4o',
    name: 'GPT-4o',
    api: 'openai-completions',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    api: 'openai-completions',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  },
  o3: {
    id: 'o3',
    name: 'o3',
    api: 'openai-completions',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: 'low', low: 'low', medium: 'medium', high: 'high' },
    input: ['text', 'image'],
    cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 100000,
    compat: { supportsDeveloperRole: true, supportsReasoningEffort: true },
  },
  'o4-mini': {
    id: 'o4-mini',
    name: 'o4-mini',
    api: 'openai-completions',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: 'low', low: 'low', medium: 'medium', high: 'high' },
    input: ['text', 'image'],
    cost: { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 100000,
    compat: { supportsDeveloperRole: true, supportsReasoningEffort: true },
  },
};

// ---------- 注册表 ----------

// 两层 Map<provider, Map<modelId, Model>>
const modelRegistry = new Map<string, Map<string, Model<Api>>>();

for (const [id, model] of Object.entries(CLAUDE_MODELS)) {
  let providerModels = modelRegistry.get('anthropic');
  if (!providerModels) {
    providerModels = new Map();
    modelRegistry.set('anthropic', providerModels);
  }
  providerModels.set(id, model as Model<Api>);
}
for (const [id, model] of Object.entries(OPENAI_MODELS)) {
  let providerModels = modelRegistry.get('openai');
  if (!providerModels) {
    providerModels = new Map();
    modelRegistry.set('openai', providerModels);
  }
  providerModels.set(id, model as Model<Api>);
}

// ---------- 公开 API ----------

export function getModel<TApi extends Api>(
  provider: string,
  modelId: string,
): Model<TApi> | undefined {
  const providerModels = modelRegistry.get(provider);
  return providerModels?.get(modelId) as Model<TApi> | undefined;
}

export function getProviders(): string[] {
  return Array.from(modelRegistry.keys());
}

export function getModels(provider?: string): Model<Api>[] {
  if (provider) {
    const providerModels = modelRegistry.get(provider);
    return providerModels ? Array.from(providerModels.values()) : [];
  }
  return Array.from(modelRegistry.values()).flatMap((m) => Array.from(m.values()));
}

export function getDefaultModel(): Model<'anthropic-messages'> {
  return CLAUDE_MODELS['claude-sonnet-4-20250514'];
}

export function calculateCost<TApi extends Api>(model: Model<TApi>, usage: Usage): Usage['cost'] {
  usage.cost.input = (model.cost.input / 1000000) * usage.input;
  usage.cost.output = (model.cost.output / 1000000) * usage.output;
  usage.cost.cacheRead = (model.cost.cacheRead / 1000000) * usage.cacheRead;
  usage.cost.cacheWrite = (model.cost.cacheWrite / 1000000) * usage.cacheWrite;
  usage.cost.total =
    usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
  return usage.cost;
}

const EXTENDED_THINKING_LEVELS: ModelThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

export function getSupportedThinkingLevels<TApi extends Api>(
  model: Model<TApi>,
): ModelThinkingLevel[] {
  if (!model.reasoning) return ['off'];
  return EXTENDED_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === 'xhigh') return mapped !== undefined;
    return true;
  });
}

export function clampThinkingLevel<TApi extends Api>(
  model: Model<TApi>,
  level: ModelThinkingLevel,
): ModelThinkingLevel {
  const available = getSupportedThinkingLevels(model);
  if (available.includes(level)) return level;
  const requestedIndex = EXTENDED_THINKING_LEVELS.indexOf(level);
  if (requestedIndex === -1) return available[0] ?? 'off';
  for (let i = requestedIndex; i < EXTENDED_THINKING_LEVELS.length; i++) {
    if (available.includes(EXTENDED_THINKING_LEVELS[i])) return EXTENDED_THINKING_LEVELS[i];
  }
  for (let i = requestedIndex - 1; i >= 0; i--) {
    if (available.includes(EXTENDED_THINKING_LEVELS[i])) return EXTENDED_THINKING_LEVELS[i];
  }
  return available[0] ?? 'off';
}

export function modelsAreEqual<TApi extends Api>(
  a: Model<TApi> | null | undefined,
  b: Model<TApi> | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.id === b.id && a.provider === b.provider;
}
