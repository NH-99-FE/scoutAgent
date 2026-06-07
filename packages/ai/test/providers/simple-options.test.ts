// ============================================================
// simple-options 测试 — 选项辅助函数
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  buildBaseOptions,
  clampReasoning,
  adjustMaxTokensForThinking,
} from '../../src/providers/simple-options';
import type {
  Api,
  Model,
  ModelThinkingLevel,
  SimpleStreamOptions,
  ThinkingLevel,
} from '../../src/types';

// ---------- 辅助 ----------

function makeModel(overrides: Partial<Model<Api>> = {}): Model<Api> {
  return {
    id: 'test-model',
    name: 'Test Model',
    api: 'anthropic-messages',
    provider: 'anthropic',
    baseUrl: 'https://api.test/v1',
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: 'low', low: 'low', medium: 'medium', high: 'high' },
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096,
    maxTokens: 8192,
    ...overrides,
  };
}

// ---------- buildBaseOptions ----------

describe('buildBaseOptions', () => {
  it('returns apiKey from parameter', () => {
    const result = buildBaseOptions(makeModel(), undefined, 'sk-test');
    expect(result.apiKey).toBe('sk-test');
  });

  it('passes through all options from SimpleStreamOptions', () => {
    const opts: SimpleStreamOptions = {
      temperature: 0.5,
      maxTokens: 1000,
      cacheRetention: 'short',
      sessionId: 'sess-1',
      timeoutMs: 5000,
      maxRetries: 3,
      headers: { 'x-custom': 'value' },
    };
    const result = buildBaseOptions(makeModel(), opts, 'sk-test');
    expect(result.temperature).toBe(0.5);
    expect(result.maxTokens).toBe(1000);
    expect(result.cacheRetention).toBe('short');
    expect(result.sessionId).toBe('sess-1');
    expect(result.timeoutMs).toBe(5000);
    expect(result.maxRetries).toBe(3);
    expect(result.headers).toEqual({ 'x-custom': 'value' });
  });

  it('handles undefined options', () => {
    const result = buildBaseOptions(makeModel(), undefined, 'sk-test');
    expect(result.apiKey).toBe('sk-test');
    expect(result.temperature).toBeUndefined();
    expect(result.maxTokens).toBeUndefined();
  });

  it('preserves signal from options', () => {
    const controller = new AbortController();
    const opts: SimpleStreamOptions = { signal: controller.signal };
    const result = buildBaseOptions(makeModel(), opts, 'sk-test');
    expect(result.signal).toBe(controller.signal);
  });
});

// ---------- clampReasoning ----------

describe('clampReasoning', () => {
  it('returns undefined for undefined reasoning', () => {
    expect(clampReasoning(makeModel(), undefined)).toBeUndefined();
  });

  it('returns the level itself if available in model', () => {
    expect(clampReasoning(makeModel(), 'high')).toBe('high');
    expect(clampReasoning(makeModel(), 'low')).toBe('low');
  });

  it('clamps to nearest available level', () => {
    // Model without xhigh
    const model = makeModel({
      thinkingLevelMap: { off: null, minimal: 'low', low: 'low', medium: 'medium', high: 'high' },
    });
    const result = clampReasoning(model, 'xhigh');
    // Should clamp to nearest available, not "off" which maps to null
    expect(result).toBeDefined();
    expect(result).not.toBe('off');
  });

  it('returns undefined when clamped to off', () => {
    const model = makeModel({ reasoning: false });
    expect(clampReasoning(model, 'high')).toBeUndefined();
  });

  it('returns off -> undefined for non-reasoning model', () => {
    const model = makeModel({ reasoning: false });
    expect(clampReasoning(model, 'off' as unknown as ThinkingLevel)).toBeUndefined();
  });
});

// ---------- adjustMaxTokensForThinking ----------

describe('adjustMaxTokensForThinking', () => {
  it('returns no thinking budget when reasoning is off', () => {
    const result = adjustMaxTokensForThinking(undefined, 8192, 'off');
    expect(result.maxTokens).toBe(8192);
    expect(result.thinkingBudget).toBe(0);
  });

  it('returns no thinking budget when reasoning is undefined', () => {
    const result = adjustMaxTokensForThinking(undefined, 8192, undefined);
    expect(result.maxTokens).toBe(8192);
    expect(result.thinkingBudget).toBe(0);
  });

  it('uses model maxTokens when no user override', () => {
    const result = adjustMaxTokensForThinking(undefined, 8192, 'medium');
    expect(result.maxTokens).toBe(8192);
    // medium budget is 8192, but maxTokens=8192 <= budget, so budget shrinks to maxTokens - 1024
    expect(result.thinkingBudget).toBe(8192 - 1024);
  });

  it('respects user-provided maxTokens', () => {
    const result = adjustMaxTokensForThinking(4000, 8192, 'medium');
    expect(result.maxTokens).toBe(4000);
  });

  it('uses default budgets when no custom budgets provided', () => {
    // minimal: 1024, low: 2048, medium: 8192, high: 16384
    const low = adjustMaxTokensForThinking(undefined, 100000, 'low');
    expect(low.thinkingBudget).toBe(2048);

    const high = adjustMaxTokensForThinking(undefined, 100000, 'high');
    expect(high.thinkingBudget).toBe(16384);
  });

  it('uses custom budgets when provided', () => {
    const customBudgets = { minimal: 512, low: 1024, medium: 4096, high: 8192 };
    const result = adjustMaxTokensForThinking(undefined, 100000, 'medium', customBudgets);
    expect(result.thinkingBudget).toBe(4096);
  });

  it('shrinks thinking budget when it exceeds maxTokens', () => {
    // maxTokens=2000, high budget=16384, minOutputTokens=1024
    const result = adjustMaxTokensForThinking(2000, 8192, 'high');
    expect(result.maxTokens).toBe(2000);
    expect(result.thinkingBudget).toBe(Math.max(0, 2000 - 1024));
  });

  it('returns zero budget when maxTokens equals minOutputTokens', () => {
    const result = adjustMaxTokensForThinking(1024, 8192, 'high');
    expect(result.thinkingBudget).toBe(0);
  });

  it('returns zero budget when maxTokens is less than minOutputTokens', () => {
    const result = adjustMaxTokensForThinking(500, 8192, 'high');
    expect(result.thinkingBudget).toBe(0);
  });

  it('falls back to 8192 for unknown reasoning level', () => {
    const result = adjustMaxTokensForThinking(
      undefined,
      100000,
      'xhigh' as unknown as ModelThinkingLevel,
    );
    // No budget for xhigh, falls back to 8192
    expect(result.thinkingBudget).toBe(8192);
  });
});
