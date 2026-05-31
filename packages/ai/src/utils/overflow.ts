// ============================================================
// 上下文溢出检测
// 支持 Anthropic + OpenAI
// ============================================================

import type { AssistantMessage } from '../types';

/**
 * 检测各 provider 上下文溢出错误的正则模式。
 *
 * - Anthropic: "prompt is too long: 213462 tokens > 200000 maximum"
 * - Anthropic: 413 {"error":{"type":"request_too_large","message":"Request exceeds the maximum size"}}
 * - OpenAI: "Your input exceeds the context window of this model"
 * - OpenAI/LiteLLM: "Requested token count exceeds the model's maximum context length of 131072 tokens"
 */
const OVERFLOW_PATTERNS = [
  /prompt is too long/i, // Anthropic token 溢出
  /request_too_large/i, // Anthropic 请求体过大 (HTTP 413)
  /exceeds the context window/i, // OpenAI (Completions & Responses API)
  /exceeds (?:the )?(?:model'?s )?maximum context length of [\d,]+ tokens?/i, // OpenAI 兼容代理 (LiteLLM)
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i, // OpenRouter/Poolside
  /maximum context length is \d+ tokens/i, // OpenRouter (多数后端)
  /context[_ ]length[_ ]exceeded/i, // 通用回退
  /too many tokens/i, // 通用回退
  /token limit exceeded/i, // 通用回退
];

/**
 * 非溢出错误模式（如限流、服务端错误）。
 * 匹配这些模式的消息即使同时匹配溢出模式，也不会被判定为溢出。
 */
const NON_OVERFLOW_PATTERNS = [
  /rate limit/i, // 通用限流
  /too many requests/i, // 通用 HTTP 429 风格
];

/**
 * 判断 assistant 消息是否代表上下文溢出错误。
 *
 * 处理两种情况：
 * 1. 错误型溢出：provider 返回 stopReason "error" 并带有特定错误消息模式。
 * 2. 静默溢出：某些 provider 接受超量请求并正常返回，
 *    此时通过 usage.input 是否超过 context window 来判断。
 *
 * @param message - 要检查的 assistant 消息
 * @param contextWindow - 可选的上下文窗口大小，用于检测静默溢出
 * @returns 如果消息指示上下文溢出则返回 true
 */
export function isContextOverflow(message: AssistantMessage, contextWindow?: number): boolean {
  // 情况 1：检查错误消息模式
  if (message.stopReason === 'error' && message.errorMessage) {
    const isNonOverflow = NON_OVERFLOW_PATTERNS.some((p) => p.test(message.errorMessage!));
    if (!isNonOverflow && OVERFLOW_PATTERNS.some((p) => p.test(message.errorMessage!))) {
      return true;
    }
  }

  // 情况 2：静默溢出 — 正常返回但 usage 超过上下文窗口
  if (contextWindow && message.stopReason === 'stop') {
    const inputTokens = message.usage.input + message.usage.cacheRead;
    if (inputTokens > contextWindow) {
      return true;
    }
  }

  return false;
}

/**
 * 获取溢出模式列表（用于测试）。
 */
export function getOverflowPatterns(): RegExp[] {
  return [...OVERFLOW_PATTERNS];
}
