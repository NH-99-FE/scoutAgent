// ============================================================
// openai-prompt-cache 测试 — Prompt cache key 长度限制
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  clampOpenAIPromptCacheKey,
  OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH,
} from '../../src/providers/openai-prompt-cache';

describe('OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH', () => {
  it('is 64', () => {
    expect(OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH).toBe(64);
  });
});

describe('clampOpenAIPromptCacheKey', () => {
  it('returns undefined when key is undefined', () => {
    expect(clampOpenAIPromptCacheKey(undefined)).toBeUndefined();
  });

  it('returns key as-is when length equals max', () => {
    const key = 'a'.repeat(64);
    expect(clampOpenAIPromptCacheKey(key)).toBe(key);
  });

  it('returns key as-is when length is less than max', () => {
    const key = 'short-key';
    expect(clampOpenAIPromptCacheKey(key)).toBe(key);
  });

  it('truncates key when length exceeds max', () => {
    const key = 'a'.repeat(100);
    const result = clampOpenAIPromptCacheKey(key);
    expect(result).toBe('a'.repeat(64));
  });

  it('handles empty string', () => {
    expect(clampOpenAIPromptCacheKey('')).toBe('');
  });

  it('handles unicode characters correctly (multi-byte)', () => {
    // Each emoji is 1 code point but potentially multiple UTF-16 code units
    // Array.from counts code points, not UTF-16 units
    const key = '😀'.repeat(65);
    const result = clampOpenAIPromptCacheKey(key);
    // Array.from('😀') gives 1 char per emoji, so 64 emojis
    expect(Array.from(result!).length).toBe(64);
  });
});
