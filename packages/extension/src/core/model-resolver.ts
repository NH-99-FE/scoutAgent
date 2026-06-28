// ============================================================
// 模型解析器 — provider/model 引用 + 默认模型 fallback
// ============================================================

import type { Api, Model } from '@scout-agent/ai';
import { THINKING_LEVELS } from '@scout-agent/shared';
import type { AvailableModel, ScoutModelRegistry } from './model-registry.ts';

const THINKING_LEVEL_SET = new Set<string>(THINKING_LEVELS);

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

    return this.findModelReference(trimmed) ?? this.findModelWithThinkingSuffix(trimmed);
  }

  private findModelReference(reference: string): Model<Api> | undefined {
    const normalized = reference.toLowerCase();
    const scoped = this.findScopedModel(reference);
    if (scoped) return scoped;

    const allModels = this.registry.getModels();
    const matches = this.registry
      .getModels()
      .filter(
        (model) =>
          model.id.toLowerCase() === normalized ||
          `${model.provider}/${model.id}`.toLowerCase() === normalized,
      );
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      return matches.find((model) => this.registry.hasConfiguredAuth(model)) ?? matches[0];
    }

    const partialMatches = allModels.filter(
      (model) =>
        model.id.toLowerCase().includes(normalized) ||
        model.name?.toLowerCase().includes(normalized),
    );
    if (partialMatches.length === 0) return undefined;
    const authenticated = partialMatches.filter((model) => this.registry.hasConfiguredAuth(model));
    const candidates = authenticated.length > 0 ? authenticated : partialMatches;
    return candidates.sort((a, b) => b.id.localeCompare(a.id))[0];
  }

  private findModelWithThinkingSuffix(reference: string): Model<Api> | undefined {
    const colonIndex = reference.lastIndexOf(':');
    if (colonIndex === -1) return undefined;
    const suffix = reference.slice(colonIndex + 1);
    if (!THINKING_LEVEL_SET.has(suffix)) return undefined;
    return this.findModelReference(reference.slice(0, colonIndex));
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
    const canonicalProvider = this.registry
      .getProviders()
      .find((candidate) => candidate.toLowerCase() === provider.toLowerCase());
    if (!canonicalProvider) return undefined;
    return (
      this.registry.getModel(canonicalProvider, modelId) ??
      this.registry
        .getModels(canonicalProvider)
        .find((model) => model.id.toLowerCase() === modelId.toLowerCase())
    );
  }

  private findFallbackModel(): Model<Api> | undefined {
    const builtInDefault = this.registry.getDefaultModel();
    if (this.registry.hasConfiguredAuth(builtInDefault)) {
      return builtInDefault;
    }
    return this.getAvailableModels()[0]?.model;
  }
}
