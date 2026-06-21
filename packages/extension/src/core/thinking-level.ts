// ============================================================
// Thinking Level — 模型推理强度归一化
// ============================================================

import type { ThinkingLevel } from '@scout-agent/agent';
import type { Api, Model, ModelThinkingLevel } from '@scout-agent/ai';
import { clampThinkingLevel, getSupportedThinkingLevels } from '@scout-agent/ai';

// ---------- 常量 ----------

export const DEFAULT_REASONING_THINKING_LEVEL: ThinkingLevel = 'medium';

// ---------- 归一化 ----------

export function normalizeThinkingLevelForModel(
  model: Model<Api>,
  level: ThinkingLevel | undefined,
): ThinkingLevel {
  const supportedLevels = getSupportedThinkingLevels(model);
  const supportsThinking = supportedLevels.some((supportedLevel) => supportedLevel !== 'off');
  if (!supportsThinking) return 'off';

  if (level && supportedLevels.includes(level)) return level;

  const requestedLevel = (level ??
    (supportedLevels.includes('off')
      ? 'off'
      : DEFAULT_REASONING_THINKING_LEVEL)) as ModelThinkingLevel;
  const normalizedLevel = clampThinkingLevel(model, requestedLevel);
  if (supportedLevels.includes(normalizedLevel)) return normalizedLevel as ThinkingLevel;

  return getFallbackThinkingLevel(supportedLevels);
}

export function normalizeThinkingLevelForModelSwitch(
  model: Model<Api>,
  level: ThinkingLevel | undefined,
): ThinkingLevel {
  return normalizeThinkingLevelForModel(model, level ?? DEFAULT_REASONING_THINKING_LEVEL);
}

function getFallbackThinkingLevel(supportedLevels: readonly ModelThinkingLevel[]): ThinkingLevel {
  return (
    supportedLevels.find(
      (supportedLevel): supportedLevel is Exclude<ModelThinkingLevel, 'off'> =>
        supportedLevel !== 'off',
    ) ?? DEFAULT_REASONING_THINKING_LEVEL
  );
}
