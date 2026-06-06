// ============================================================
// Scout 模型注册表门面 — 配置层凭证过滤 + 项目自定义模型
// ============================================================

import type { Api, Model } from '@scout-agent/ai';
import {
  getDefaultModel as getBuiltInDefaultModel,
  getModel as getBuiltInModel,
  getModels as getBuiltInModels,
  getProviders,
} from '@scout-agent/ai';

// ---------- 类型 ----------

export interface ScoutModelRegistryOptions {
  hasApiKey: (provider: string) => boolean;
}

export interface AvailableModel {
  id: string;
  name: string;
  provider: string;
  model: Model<Api>;
}

// ---------- ScoutModelRegistry ----------

export class ScoutModelRegistry {
  private readonly hasApiKey: (provider: string) => boolean;
  private customModels = new Map<string, Map<string, Model<Api>>>();

  constructor(options: ScoutModelRegistryOptions) {
    this.hasApiKey = options.hasApiKey;
  }

  setCustomModels(models: Model<Api>[]): void {
    this.customModels = new Map();
    for (const model of models) {
      let providerModels = this.customModels.get(model.provider);
      if (!providerModels) {
        providerModels = new Map();
        this.customModels.set(model.provider, providerModels);
      }
      providerModels.set(model.id, model);
    }
  }

  dispose(): void {
    this.customModels.clear();
  }

  getProviders(): string[] {
    return Array.from(new Set([...getProviders(), ...this.customModels.keys()]));
  }

  getModel(provider: string, modelId: string): Model<Api> | undefined {
    return this.customModels.get(provider)?.get(modelId) ?? getBuiltInModel(provider, modelId);
  }

  getModels(provider?: string): Model<Api>[] {
    if (provider) {
      return this.mergeModels(getBuiltInModels(provider), this.customModels.get(provider));
    }

    return this.getProviders().flatMap((providerName) => this.getModels(providerName));
  }

  getDefaultModel(): Model<Api> {
    const builtInDefault = getBuiltInDefaultModel();
    return this.getModel(builtInDefault.provider, builtInDefault.id) ?? builtInDefault;
  }

  hasConfiguredAuth(modelOrProvider: Model<Api> | string): boolean {
    const provider =
      typeof modelOrProvider === 'string' ? modelOrProvider : modelOrProvider.provider;
    return this.hasApiKey(provider);
  }

  getAvailableModels(): AvailableModel[] {
    const result: AvailableModel[] = [];
    for (const provider of this.getProviders()) {
      if (!this.hasConfiguredAuth(provider)) continue;
      for (const model of this.getModels(provider)) {
        result.push({ id: model.id, name: model.name, provider: model.provider, model });
      }
    }
    return result;
  }

  private mergeModels(
    builtInModels: Model<Api>[],
    customModels: Map<string, Model<Api>> | undefined,
  ): Model<Api>[] {
    if (!customModels) return builtInModels;

    const merged = [...builtInModels];
    for (const customModel of customModels.values()) {
      const existingIndex = merged.findIndex(
        (model) => model.provider === customModel.provider && model.id === customModel.id,
      );
      if (existingIndex >= 0) {
        merged[existingIndex] = customModel;
      } else {
        merged.push(customModel);
      }
    }
    return merged;
  }
}
