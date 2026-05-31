// ============================================================
// SimpleStream 选项辅助函数 — 供应商间共享
// 从 Pi 的 simple-options.ts 移植
// ============================================================

import type {
  Model,
  SimpleStreamOptions,
  StreamOptions,
  ThinkingBudgets,
  ThinkingLevel,
  ModelThinkingLevel,
} from '../types';
import { clampThinkingLevel } from '../models';

const DEFAULT_THINKING_BUDGETS: ThinkingBudgets = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
};

/**
 * 从 SimpleStreamOptions 构建基础 StreamOptions。
 * 解析 API key、传输方式和会话设置。
 */
export function buildBaseOptions(
  model: Model<any>,
  options: SimpleStreamOptions | undefined,
  apiKey: string,
): StreamOptions {
  return {
    apiKey,
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    signal: options?.signal,
    transport: options?.transport,
    cacheRetention: options?.cacheRetention,
    sessionId: options?.sessionId,
    onPayload: options?.onPayload,
    onResponse: options?.onResponse,
    headers: options?.headers,
    timeoutMs: options?.timeoutMs,
    maxRetries: options?.maxRetries,
    maxRetryDelayMs: options?.maxRetryDelayMs,
    metadata: options?.metadata,
  };
}

/**
 * 使用模型的 thinkingLevelMap 限制推理等级。
 * 如果请求的等级在该模型上不可用，回退到最近的支持等级。
 */
export function clampReasoning(
  model: Model<any>,
  reasoning: ThinkingLevel | undefined,
): ThinkingLevel | undefined {
  if (!reasoning) return undefined;
  // 使用 clampThinkingLevel，尊重 model.thinkingLevelMap
  const clamped = clampThinkingLevel(model, reasoning as ModelThinkingLevel);
  return clamped === 'off' ? undefined : clamped;
}

/**
 * 调整 maxTokens 并计算 budget 模式的 thinkingBudget。
 *
 * 逻辑：
 * - 用户设置了 maxTokens 时，尊重该上限，思考预算在上限内分配
 * - 未设置时使用模型 maxTokens 作为上限
 * - thinkingBudget 在上限内分配，不叠加
 */
export function adjustMaxTokensForThinking(
  requestedMaxTokens: number | undefined,
  modelMaxTokens: number,
  reasoning: ModelThinkingLevel | undefined,
  thinkingBudgets?: ThinkingBudgets,
): { maxTokens: number; thinkingBudget: number } {
  const budgets = thinkingBudgets ?? DEFAULT_THINKING_BUDGETS;
  const minOutputTokens = 1024;

  // 无推理 — 不需要思考预算
  if (!reasoning || reasoning === 'off') {
    return {
      maxTokens: requestedMaxTokens ?? modelMaxTokens,
      thinkingBudget: 0,
    };
  }

  // 根据等级确定思考预算
  const level = reasoning as keyof ThinkingBudgets;
  const thinkingBudget = budgets[level] ?? DEFAULT_THINKING_BUDGETS[level] ?? 8192;

  // 用户设了 maxTokens 就用用户的，否则用模型的
  // 思考预算在上限内分配，不叠加
  const maxTokens = requestedMaxTokens ?? modelMaxTokens;

  // 如果思考预算超过上限，缩小它以留出输出空间
  if (maxTokens <= thinkingBudget) {
    const adjustedBudget = Math.max(0, maxTokens - minOutputTokens);
    return { maxTokens, thinkingBudget: adjustedBudget };
  }

  return { maxTokens, thinkingBudget };
}
