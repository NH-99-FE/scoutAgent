// ============================================================
// isContextOverflow 集成测试
// 验证各 provider 的上下文溢出错误模式被正确识别
// ============================================================

import { describe, it, expect } from 'vitest';
import { isContextOverflow } from '../../src/utils/overflow';
import type { AssistantMessage } from '../../src/types';

// ---------- 辅助 ----------

function makeAssistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'test-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------- Anthropic patterns ----------

describe('isContextOverflow — Anthropic patterns', () => {
  it('detects "prompt is too long" error', () => {
    const message = makeAssistantMessage({
      stopReason: 'error',
      errorMessage: 'prompt is too long: 213462 tokens > 200000 maximum',
    });

    expect(isContextOverflow(message)).toBe(true);
  });

  it('detects "request_too_large" error', () => {
    const message = makeAssistantMessage({
      stopReason: 'error',
      errorMessage:
        'Error: 413 {"error":{"type":"request_too_large","message":"Request exceeds the maximum size"}}',
    });

    expect(isContextOverflow(message)).toBe(true);
  });
});

// ---------- OpenAI patterns ----------

describe('isContextOverflow — OpenAI patterns', () => {
  it('detects "exceeds the context window" error', () => {
    const message = makeAssistantMessage({
      stopReason: 'error',
      errorMessage: 'Your input exceeds the context window of this model',
    });

    expect(isContextOverflow(message)).toBe(true);
  });

  it('detects "maximum context length" error', () => {
    const message = makeAssistantMessage({
      stopReason: 'error',
      errorMessage:
        "Requested token count exceeds the model's maximum context length of 131072 tokens",
    });

    expect(isContextOverflow(message)).toBe(true);
  });
});

// ---------- Edge cases ----------

describe('isContextOverflow — edge cases', () => {
  it('does not flag rate limit errors as overflow', () => {
    const message = makeAssistantMessage({
      stopReason: 'error',
      errorMessage: 'rate limit exceeded: too many requests',
    });

    expect(isContextOverflow(message)).toBe(false);
  });

  it('detects silent overflow via usage > contextWindow', () => {
    const message = makeAssistantMessage({
      stopReason: 'stop',
      usage: {
        input: 150000,
        output: 100,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 150100,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });

    // contextWindow=128000, input=150000 > 128000
    expect(isContextOverflow(message, 128000)).toBe(true);
  });
});
