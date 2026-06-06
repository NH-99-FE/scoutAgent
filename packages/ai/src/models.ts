// ============================================================
// 模型注册表 — 内置模型 + 可扩展注册 API
// ============================================================

import { MODELS } from './models.generated';
import type { Api, Model, ModelThinkingLevel, Usage } from './types';

// ---------- 类型 ----------

export interface ModelRegistrationOptions {
  sourceId?: string;
}

interface ModelRegistryEntry {
  model: Model<Api>;
  sourceId: string;
}

const BUILTIN_SOURCE_ID = 'builtin';
const DEFAULT_MODEL_ID = 'claude-sonnet-4-20250514';
const DEFAULT_MODEL_PROVIDER = 'anthropic';

const modelRegistry = new Map<string, Map<string, ModelRegistryEntry[]>>();

// ---------- 注册表 ----------

function providerRegistry(provider: string): Map<string, ModelRegistryEntry[]> {
  let providerModels = modelRegistry.get(provider);
  if (!providerModels) {
    providerModels = new Map();
    modelRegistry.set(provider, providerModels);
  }
  return providerModels;
}

export function registerModel<TApi extends Api>(
  model: Model<TApi>,
  options: ModelRegistrationOptions = {},
): void {
  const sourceId = options.sourceId ?? 'custom';
  const providerModels = providerRegistry(model.provider);
  const stack = providerModels.get(model.id)?.filter((entry) => entry.sourceId !== sourceId) ?? [];
  stack.push({ model: model as Model<Api>, sourceId });
  providerModels.set(model.id, stack);
}

export function registerModels(
  models: Iterable<Model<Api>>,
  options: ModelRegistrationOptions = {},
): void {
  for (const model of models) {
    registerModel(model, options);
  }
}

export function unregisterModels(sourceId: string): void {
  for (const [provider, models] of modelRegistry) {
    for (const [modelId, stack] of models) {
      const remaining = stack.filter((entry) => entry.sourceId !== sourceId);
      if (remaining.length === 0) {
        models.delete(modelId);
      } else {
        models.set(modelId, remaining);
      }
    }
    if (models.size === 0) {
      modelRegistry.delete(provider);
    }
  }
}

export function clearModels(): void {
  modelRegistry.clear();
}

export function resetModels(): void {
  clearModels();
  registerBuiltInModels();
}

function registerBuiltInModels(): void {
  for (const models of Object.values(MODELS)) {
    registerModels(Object.values(models) as Model<Api>[], { sourceId: BUILTIN_SOURCE_ID });
  }
}

resetModels();

// ---------- 查询 ----------

export function getModel<TApi extends Api>(
  provider: string,
  modelId: string,
): Model<TApi> | undefined {
  const stack = modelRegistry.get(provider)?.get(modelId);
  return stack?.[stack.length - 1]?.model as Model<TApi> | undefined;
}

export function getProviders(): string[] {
  return Array.from(modelRegistry.keys());
}

export function getModels(provider?: string): Model<Api>[] {
  if (provider) {
    return Array.from(
      modelRegistry.get(provider)?.values() ?? [],
      (stack) => stack[stack.length - 1]?.model,
    ).filter((model): model is Model<Api> => !!model);
  }

  return Array.from(modelRegistry.values()).flatMap((models) =>
    Array.from(models.values(), (stack) => stack[stack.length - 1]?.model).filter(
      (model): model is Model<Api> => !!model,
    ),
  );
}

export function getDefaultModel(): Model<Api> {
  const model = getModel(DEFAULT_MODEL_PROVIDER, DEFAULT_MODEL_ID);
  if (!model) {
    throw new Error(`内置默认模型缺失: ${DEFAULT_MODEL_PROVIDER}/${DEFAULT_MODEL_ID}`);
  }
  return model;
}

// ---------- 成本 ----------

export function calculateCost<TApi extends Api>(model: Model<TApi>, usage: Usage): Usage['cost'] {
  usage.cost.input = (model.cost.input / 1000000) * usage.input;
  usage.cost.output = (model.cost.output / 1000000) * usage.output;
  usage.cost.cacheRead = (model.cost.cacheRead / 1000000) * usage.cacheRead;
  usage.cost.cacheWrite = (model.cost.cacheWrite / 1000000) * usage.cacheWrite;
  usage.cost.total =
    usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
  return usage.cost;
}

// ---------- Thinking ----------

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
    const candidate = EXTENDED_THINKING_LEVELS[i];
    if (available.includes(candidate)) return candidate;
  }
  for (let i = requestedIndex - 1; i >= 0; i--) {
    const candidate = EXTENDED_THINKING_LEVELS[i];
    if (available.includes(candidate)) return candidate;
  }
  return available[0] ?? 'off';
}

// ---------- 比较 ----------

export function modelsAreEqual<TApi extends Api>(
  a: Model<TApi> | null | undefined,
  b: Model<TApi> | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.id === b.id && a.provider === b.provider;
}
