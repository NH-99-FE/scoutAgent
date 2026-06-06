// ============================================================
// 模型解析器 — provider/model 引用 + 默认模型 fallback
// ============================================================

import type { Api, Model } from '@scout-agent/ai';
import type { AvailableModel, ScoutModelRegistry } from './model-registry.ts';

// ---------- 类型 ----------

export interface ModelResolution {
  model?: Model<Api>;
  warning?: string;
}

// ---------- ScoutModelResolver ----------

export class ScoutModelResolver {
  private readonly registry: ScoutModelRegistry;

  constructor(registry: ScoutModelRegistry) {
    this.registry = registry;
  }

  getAvailableModels(): AvailableModel[] {
    return this.registry.getAvailableModels();
  }

  findModel(reference: string): Model<Api> | undefined {
    const trimmed = reference.trim();
    if (!trimmed) return undefined;

    const scoped = this.findScopedModel(trimmed);
    if (scoped) return scoped;

    const matches = this.registry
      .getModels()
      .filter((model) => model.id === trimmed || `${model.provider}/${model.id}` === trimmed);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      return matches.find((model) => this.registry.hasConfiguredAuth(model)) ?? matches[0];
    }

    return undefined;
  }

  resolveDefaultModel(defaultModelReference?: string): ModelResolution {
    const requested = defaultModelReference?.trim();
    if (requested) {
      const model = this.findModel(requested);
      if (model && this.registry.hasConfiguredAuth(model)) {
        return { model };
      }

      const reason = model
        ? `provider "${model.provider}" has no configured API key`
        : 'model is not registered';
      const fallback = this.findFallbackModel();
      return {
        model: fallback,
        warning: fallback
          ? `Configured default model "${requested}" is unavailable (${reason}). Falling back to "${fallback.provider}/${fallback.id}".`
          : `Configured default model "${requested}" is unavailable (${reason}), and no fallback model has a configured API key.`,
      };
    }

    return { model: this.findFallbackModel() };
  }

  private findScopedModel(reference: string): Model<Api> | undefined {
    const slashIndex = reference.indexOf('/');
    if (slashIndex <= 0) return undefined;

    const provider = reference.slice(0, slashIndex).trim();
    const modelId = reference.slice(slashIndex + 1).trim();
    if (!provider || !modelId) return undefined;
    if (!this.registry.getProviders().includes(provider)) return undefined;
    return this.registry.getModel(provider, modelId);
  }

  private findFallbackModel(): Model<Api> | undefined {
    const builtInDefault = this.registry.getDefaultModel();
    if (this.registry.hasConfiguredAuth(builtInDefault)) {
      return builtInDefault;
    }
    return this.getAvailableModels()[0]?.model;
  }
}
