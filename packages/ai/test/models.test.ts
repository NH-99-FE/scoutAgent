// ============================================================
// models 测试
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  getModel,
  getModels,
  getProviders,
  getDefaultModel,
  calculateCost,
  getSupportedThinkingLevels,
  clampThinkingLevel,
  modelsAreEqual,
} from '../src/models';
import type { Usage } from '../src/types';

// ---------- getModel ----------

describe('getModel', () => {
  it('returns a known Anthropic model by provider and id', () => {
    const model = getModel('anthropic', 'claude-sonnet-4-20250514');
    expect(model).toBeDefined();
    expect(model!.id).toBe('claude-sonnet-4-20250514');
    expect(model!.api).toBe('anthropic-messages');
    expect(model!.provider).toBe('anthropic');
    expect(model!.reasoning).toBe(true);
  });

  it('returns a known OpenAI model by provider and id', () => {
    const model = getModel('openai', 'gpt-4o');
    expect(model).toBeDefined();
    expect(model!.id).toBe('gpt-4o');
    expect(model!.api).toBe('openai-completions');
    expect(model!.provider).toBe('openai');
  });

  it('returns undefined for unknown provider', () => {
    expect(getModel('nonexistent-provider', 'some-model')).toBeUndefined();
  });

  it('returns undefined for unknown model id within known provider', () => {
    expect(getModel('anthropic', 'nonexistent-model')).toBeUndefined();
  });

  it('does not find Anthropic model under OpenAI provider', () => {
    expect(getModel('openai', 'claude-sonnet-4-20250514')).toBeUndefined();
  });

  it('does not find OpenAI model under Anthropic provider', () => {
    expect(getModel('anthropic', 'gpt-4o')).toBeUndefined();
  });

  it('Opus 4 supports xhigh thinking', () => {
    const model = getModel('anthropic', 'claude-opus-4-20250514');
    expect(model).toBeDefined();
    expect(model!.thinkingLevelMap!.xhigh).toBe('xhigh');
  });

  it('Haiku 3.5 does not support reasoning', () => {
    const model = getModel('anthropic', 'claude-haiku-3-5-20241022');
    expect(model).toBeDefined();
    expect(model!.reasoning).toBe(false);
    expect(model!.thinkingLevelMap).toBeUndefined();
  });
});

// ---------- getModels ----------

describe('getModels', () => {
  it('returns all registered models when no provider specified', () => {
    const models = getModels();
    expect(models.length).toBeGreaterThanOrEqual(7);
  });

  it('includes both Anthropic and OpenAI models', () => {
    const models = getModels();
    const apis = new Set(models.map((m) => m.api));
    expect(apis.has('anthropic-messages')).toBe(true);
    expect(apis.has('openai-completions')).toBe(true);
  });

  it('filters by provider — anthropic', () => {
    const models = getModels('anthropic');
    expect(models.length).toBeGreaterThanOrEqual(3);
    expect(models.every((m) => m.provider === 'anthropic')).toBe(true);
  });

  it('filters by provider — openai', () => {
    const models = getModels('openai');
    expect(models.length).toBeGreaterThanOrEqual(4);
    expect(models.every((m) => m.provider === 'openai')).toBe(true);
  });

  it('returns empty array for unknown provider', () => {
    const models = getModels('nonexistent');
    expect(models).toEqual([]);
  });
});

// ---------- getProviders ----------

describe('getProviders', () => {
  it('returns all registered providers', () => {
    const providers = getProviders();
    expect(providers).toContain('anthropic');
    expect(providers).toContain('openai');
  });

  it('returns at least 2 providers', () => {
    const providers = getProviders();
    expect(providers.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------- getDefaultModel ----------

describe('getDefaultModel', () => {
  it('returns Claude Sonnet 4 as default', () => {
    const model = getDefaultModel();
    expect(model.id).toBe('claude-sonnet-4-20250514');
    expect(model.api).toBe('anthropic-messages');
  });
});

// ---------- calculateCost ----------

describe('calculateCost', () => {
  it('calculates cost correctly for Sonnet 4', () => {
    const model = getModel('anthropic', 'claude-sonnet-4-20250514')!;
    const usage: Usage = {
      input: 1000,
      output: 500,
      cacheRead: 200,
      cacheWrite: 100,
      totalTokens: 1800,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const cost = calculateCost(model, usage);
    expect(cost.input).toBeCloseTo((3 / 1000000) * 1000, 10);
    expect(cost.output).toBeCloseTo((15 / 1000000) * 500, 10);
    expect(cost.cacheRead).toBeCloseTo((0.3 / 1000000) * 200, 10);
    expect(cost.cacheWrite).toBeCloseTo((3.75 / 1000000) * 100, 10);
    expect(cost.total).toBeCloseTo(cost.input + cost.output + cost.cacheRead + cost.cacheWrite, 10);
  });

  it('calculates cost correctly for GPT-4o with zero cache write', () => {
    const model = getModel('openai', 'gpt-4o')!;
    const usage: Usage = {
      input: 1000,
      output: 500,
      cacheRead: 300,
      cacheWrite: 0,
      totalTokens: 1800,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const cost = calculateCost(model, usage);
    expect(cost.cacheWrite).toBe(0);
    expect(cost.cacheRead).toBeCloseTo((1.25 / 1000000) * 300, 10);
  });

  it('handles zero usage', () => {
    const model = getModel('anthropic', 'claude-sonnet-4-20250514')!;
    const usage: Usage = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const cost = calculateCost(model, usage);
    expect(cost.total).toBe(0);
  });

  it('mutates the usage.cost object in place', () => {
    const model = getModel('openai', 'gpt-4o-mini')!;
    const usage: Usage = {
      input: 1000,
      output: 1000,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const cost = calculateCost(model, usage);
    expect(usage.cost).toBe(cost);
  });
});

// ---------- getSupportedThinkingLevels ----------

describe('getSupportedThinkingLevels', () => {
  it('returns only off for non-reasoning model', () => {
    const model = getModel('anthropic', 'claude-haiku-3-5-20241022')!;
    expect(getSupportedThinkingLevels(model)).toEqual(['off']);
  });

  it('returns levels including xhigh for Opus 4', () => {
    const model = getModel('anthropic', 'claude-opus-4-20250514')!;
    const levels = getSupportedThinkingLevels(model);
    expect(levels).toContain('xhigh');
    expect(levels).toContain('high');
    expect(levels).not.toContain('off');
  });

  it('excludes xhigh for Sonnet 4 (not in thinkingLevelMap)', () => {
    const model = getModel('anthropic', 'claude-sonnet-4-20250514')!;
    const levels = getSupportedThinkingLevels(model);
    expect(levels).not.toContain('xhigh');
    expect(levels).toContain('high');
  });

  it('excludes off for reasoning models where off maps to null', () => {
    const model = getModel('openai', 'o3')!;
    const levels = getSupportedThinkingLevels(model);
    expect(levels).not.toContain('off');
    expect(levels).toContain('minimal');
  });
});

// ---------- clampThinkingLevel ----------

describe('clampThinkingLevel', () => {
  it('returns the level itself if available', () => {
    const model = getModel('anthropic', 'claude-opus-4-20250514')!;
    expect(clampThinkingLevel(model, 'high')).toBe('high');
    expect(clampThinkingLevel(model, 'low')).toBe('low');
  });

  it('clamps xhigh to next available for Sonnet 4', () => {
    const model = getModel('anthropic', 'claude-sonnet-4-20250514')!;
    const result = clampThinkingLevel(model, 'xhigh');
    expect(result).toBeDefined();
  });

  it('returns off for non-reasoning model', () => {
    const model = getModel('anthropic', 'claude-haiku-3-5-20241022')!;
    expect(clampThinkingLevel(model, 'off')).toBe('off');
    expect(clampThinkingLevel(model, 'high')).toBe('off');
  });

  it('clamps off to first available for reasoning models', () => {
    const model = getModel('openai', 'o3')!;
    const result = clampThinkingLevel(model, 'off');
    expect(result).toBeDefined();
    expect(result).not.toBe('off');
  });
});

// ---------- modelsAreEqual ----------

describe('modelsAreEqual', () => {
  it('returns true for same model', () => {
    const a = getModel('anthropic', 'claude-sonnet-4-20250514')!;
    const b = getModel('anthropic', 'claude-sonnet-4-20250514')!;
    expect(modelsAreEqual(a, b)).toBe(true);
  });

  it('returns false for different models', () => {
    const a = getModel('anthropic', 'claude-sonnet-4-20250514')!;
    const b = getModel('openai', 'gpt-4o')!;
    expect(modelsAreEqual(a, b)).toBe(false);
  });

  it('returns false when either is null/undefined', () => {
    const model = getModel('anthropic', 'claude-sonnet-4-20250514')!;
    expect(modelsAreEqual(null, model)).toBe(false);
    expect(modelsAreEqual(model, undefined)).toBe(false);
    expect(modelsAreEqual(null, undefined)).toBe(false);
  });
});
