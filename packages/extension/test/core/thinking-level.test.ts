import { describe, expect, it } from 'vitest';
import {
  normalizeThinkingLevelForModel,
  normalizeThinkingLevelForModelSwitch,
} from '../../src/core/thinking-level.ts';
import { mockModel } from './test-utils.ts';

describe('normalizeThinkingLevelForModel', () => {
  it('returns off for models without thinking support', () => {
    const model = mockModel({ reasoning: false });

    expect(normalizeThinkingLevelForModel(model, 'high')).toBe('off');
  });

  it('preserves manual off for thinking models that support disabling thinking', () => {
    const model = mockModel({ reasoning: true });

    expect(normalizeThinkingLevelForModel(model, 'off')).toBe('off');
    expect(normalizeThinkingLevelForModel(model, undefined)).toBe('off');
  });

  it('preserves an available thinking level', () => {
    const model = mockModel({ reasoning: true });

    expect(normalizeThinkingLevelForModel(model, 'high')).toBe('high');
  });

  it('uses model capability clamping when off is unavailable', () => {
    const model = mockModel({
      reasoning: true,
      thinkingLevelMap: { off: null },
    });

    expect(normalizeThinkingLevelForModel(model, 'off')).toBe('minimal');
  });

  it('uses provider clamp order when medium is unavailable', () => {
    const model = mockModel({
      reasoning: true,
      thinkingLevelMap: { off: null, medium: null, xhigh: null },
    });

    expect(normalizeThinkingLevelForModel(model, 'off')).toBe('minimal');
  });
});

describe('normalizeThinkingLevelForModelSwitch', () => {
  it('uses medium before clamping when no inherited level is available', () => {
    const model = mockModel({ reasoning: true });

    expect(normalizeThinkingLevelForModelSwitch(model, undefined)).toBe('medium');
  });

  it('preserves explicit off when switching between thinking-capable models', () => {
    const model = mockModel({ reasoning: true });

    expect(normalizeThinkingLevelForModelSwitch(model, 'off')).toBe('off');
  });
});
