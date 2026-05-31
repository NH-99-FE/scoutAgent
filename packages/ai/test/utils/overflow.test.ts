// ============================================================
// overflow 测试 — 上下文溢出检测
// ============================================================

import { describe, it, expect } from 'vitest';
import { isContextOverflow, getOverflowPatterns } from '../../src/utils/overflow';
import type { AssistantMessage } from '../../src/types';

function makeAssistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'error',
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------- Anthropic overflow ----------

describe('isContextOverflow — Anthropic', () => {
  it("detects 'prompt is too long' error", () => {
    const msg = makeAssistantMessage({
      errorMessage: 'prompt is too long: 213462 tokens > 200000 maximum',
    });
    expect(isContextOverflow(msg, 200000)).toBe(true);
  });

  it("detects 'request_too_large' error", () => {
    const msg = makeAssistantMessage({
      errorMessage:
        '413 {"error":{"type":"request_too_large","message":"Request exceeds the maximum size"}}',
    });
    expect(isContextOverflow(msg, 200000)).toBe(true);
  });
});

// ---------- OpenAI overflow ----------

describe('isContextOverflow — OpenAI', () => {
  it("detects 'exceeds the context window' error", () => {
    const msg = makeAssistantMessage({
      provider: 'openai',
      api: 'openai-completions',
      errorMessage: 'Your input exceeds the context window of this model',
    });
    expect(isContextOverflow(msg, 128000)).toBe(true);
  });

  it("detects 'maximum context length of X tokens' error", () => {
    const msg = makeAssistantMessage({
      provider: 'openai',
      api: 'openai-completions',
      errorMessage:
        "Requested token count exceeds the model's maximum context length of 131072 tokens",
    });
    expect(isContextOverflow(msg, 131072)).toBe(true);
  });

  it("detects 'maximum allowed input length' error", () => {
    const msg = makeAssistantMessage({
      provider: 'openai',
      api: 'openai-completions',
      errorMessage:
        'Input length 150000 exceeds the maximum allowed input length of 128000 tokens.',
    });
    expect(isContextOverflow(msg, 128000)).toBe(true);
  });

  it("detects 'maximum context length is X tokens' error", () => {
    const msg = makeAssistantMessage({
      provider: 'openai',
      api: 'openai-completions',
      errorMessage:
        "This endpoint's maximum context length is 128000 tokens. However, you requested about 150000 tokens",
    });
    expect(isContextOverflow(msg, 128000)).toBe(true);
  });
});

// ---------- Non-overflow cases ----------

describe('isContextOverflow — negative cases', () => {
  it('returns false for rate limit errors', () => {
    const msg = makeAssistantMessage({
      errorMessage: 'rate limit exceeded: too many tokens per minute',
    });
    expect(isContextOverflow(msg, 200000)).toBe(false);
  });

  it("returns false for 'too many requests' errors", () => {
    const msg = makeAssistantMessage({
      errorMessage: '429 Too many requests',
    });
    expect(isContextOverflow(msg, 200000)).toBe(false);
  });

  it('returns false for non-overflow errors', () => {
    const msg = makeAssistantMessage({
      errorMessage: 'Internal server error',
    });
    expect(isContextOverflow(msg, 200000)).toBe(false);
  });

  it("returns false when stopReason is not 'error'", () => {
    const msg = makeAssistantMessage({
      stopReason: 'stop',
      errorMessage: 'prompt is too long',
    });
    expect(isContextOverflow(msg, 200000)).toBe(false);
  });

  it('returns false when there is no error message', () => {
    const msg = makeAssistantMessage({ errorMessage: undefined });
    expect(isContextOverflow(msg, 200000)).toBe(false);
  });
});

// ---------- Silent overflow ----------

describe('isContextOverflow — silent overflow', () => {
  it('detects silent overflow when usage exceeds context window', () => {
    const msg = makeAssistantMessage({
      stopReason: 'stop',
      errorMessage: undefined,
      usage: {
        input: 210000,
        output: 100,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 210100,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    expect(isContextOverflow(msg, 200000)).toBe(true);
  });

  it('does not flag normal usage within context window', () => {
    const msg = makeAssistantMessage({
      stopReason: 'stop',
      errorMessage: undefined,
      usage: {
        input: 50000,
        output: 500,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 50500,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    expect(isContextOverflow(msg, 200000)).toBe(false);
  });

  it('accounts for cacheRead in input tokens', () => {
    const msg = makeAssistantMessage({
      stopReason: 'stop',
      errorMessage: undefined,
      usage: {
        input: 100000,
        output: 100,
        cacheRead: 110000,
        cacheWrite: 0,
        totalTokens: 210200,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    expect(isContextOverflow(msg, 200000)).toBe(true);
  });

  it('returns false when contextWindow is not provided', () => {
    const msg = makeAssistantMessage({
      stopReason: 'stop',
      errorMessage: undefined,
      usage: {
        input: 210000,
        output: 100,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 210100,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    expect(isContextOverflow(msg)).toBe(false);
  });
});

// ---------- getOverflowPatterns ----------

describe('getOverflowPatterns', () => {
  it('returns a non-empty array of regex patterns', () => {
    const patterns = getOverflowPatterns();
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns.every((p) => p instanceof RegExp)).toBe(true);
  });
});
