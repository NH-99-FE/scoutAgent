// ============================================================
// Model Menu Options — 模型菜单纯数据推导
// ============================================================

import { THINKING_STRENGTH_LEVELS } from '@scout-agent/shared';
import type { ScoutModelInfo, ThinkingStrengthLevel } from '@scout-agent/shared';

// ---------- 常量 ----------

export const MODEL_OPTION_HEIGHT_PX = 28;
export const MAX_MODEL_LIST_HEIGHT_PX = 160;

export interface ThinkingOption {
  level: ThinkingStrengthLevel;
  label: string;
}

const THINKING_LEVEL_LABELS: Record<ThinkingStrengthLevel, string> = {
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
};

// ---------- 模型选项 ----------

export interface ResolveActiveModelOptions {
  models: ScoutModelInfo[];
  currentProvider: string;
  currentModelId: string;
  defaultProvider: string;
  defaultModelId: string;
}

export function resolveActiveModel({
  models,
  currentProvider,
  currentModelId,
  defaultProvider,
  defaultModelId,
}: ResolveActiveModelOptions): ScoutModelInfo | undefined {
  if (currentProvider || currentModelId) {
    return findModel(models, currentProvider, currentModelId);
  }

  return findModel(models, defaultProvider, defaultModelId) ?? models[0];
}

export function getModelValue(model: ScoutModelInfo): string {
  return `${model.provider}:${model.id}`;
}

export function formatModelName(model: ScoutModelInfo): string {
  return model.name || model.id;
}

export function formatModelLabel(model: string): string {
  if (!model) return '模型';
  const parts = model.split('/').map((part) => part.trim());
  return parts.at(-1) || model;
}

function findModel(
  models: ScoutModelInfo[],
  provider: string,
  modelId: string,
): ScoutModelInfo | undefined {
  if (!provider || !modelId) return undefined;
  return models.find((model) => model.provider === provider && model.id === modelId);
}

// ---------- 推理强度 ----------

export function getThinkingOptions(model: ScoutModelInfo | undefined): ThinkingOption[] {
  if (!model) return [];
  const supportedLevels = new Set(model.supportedThinkingLevels);
  return THINKING_STRENGTH_LEVELS.filter((level) => supportedLevels.has(level)).map((level) => ({
    level,
    label: THINKING_LEVEL_LABELS[level],
  }));
}
