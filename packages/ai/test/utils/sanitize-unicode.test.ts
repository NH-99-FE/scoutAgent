// ============================================================
// sanitize-unicode 测试 — Unicode 代理对净化
// ============================================================

import { describe, it, expect } from 'vitest';
import { sanitizeSurrogates } from '../../src/utils/sanitize-unicode';

describe('sanitizeSurrogates', () => {
  it('leaves plain ASCII text unchanged', () => {
    expect(sanitizeSurrogates('Hello, world!')).toBe('Hello, world!');
  });

  it('leaves valid emoji (correctly paired surrogates) unchanged', () => {
    expect(sanitizeSurrogates('Hello 🙈 World')).toBe('Hello 🙈 World');
  });

  it('leaves CJK characters unchanged', () => {
    expect(sanitizeSurrogates('你好世界')).toBe('你好世界');
  });

  it('removes an unpaired high surrogate', () => {
    const unpaired = String.fromCharCode(0xd83d);
    expect(sanitizeSurrogates(`Text ${unpaired} here`)).toBe('Text  here');
  });

  it('removes an unpaired low surrogate', () => {
    const unpaired = String.fromCharCode(0xdc00);
    expect(sanitizeSurrogates(`Text ${unpaired} here`)).toBe('Text  here');
  });

  it('removes multiple unpaired surrogates', () => {
    const high = String.fromCharCode(0xd800);
    const low = String.fromCharCode(0xdc00);
    expect(sanitizeSurrogates(`${high}A${low}`)).toBe('A');
  });

  it('preserves valid surrogate pairs while removing adjacent unpaired ones', () => {
    const validEmoji = '🙈';
    const unpaired = String.fromCharCode(0xdbff);
    const input = `${validEmoji}${unpaired}text`;
    const result = sanitizeSurrogates(input);
    expect(result).toContain('🙈');
    expect(result).toContain('text');
    expect(result.length).toBeLessThan(input.length);
  });

  it('handles empty string', () => {
    expect(sanitizeSurrogates('')).toBe('');
  });

  it('handles string with only unpaired surrogates', () => {
    const high = String.fromCharCode(0xd800);
    const low = String.fromCharCode(0xdfff);
    expect(sanitizeSurrogates(high)).toBe('');
    expect(sanitizeSurrogates(low)).toBe('');
    // 0xD800 + 0xDFFF is a valid surrogate pair (U+103FF)
    expect(sanitizeSurrogates(high + low).length).toBeGreaterThan(0);
  });

  it('preserves valid emoji even when surrounded by unpaired surrogates', () => {
    const emoji = '🎉';
    const unpairedHigh = String.fromCharCode(0xdbff);
    const input = `${unpairedHigh}${emoji}${unpairedHigh}`;
    const result = sanitizeSurrogates(input);
    expect(result).toContain('🎉');
  });

  it('handles string with consecutive valid emoji', () => {
    expect(sanitizeSurrogates('🎉🙈🎊')).toBe('🎉🙈🎊');
  });

  it('removes low surrogate at the start of string', () => {
    const low = String.fromCharCode(0xdc00);
    expect(sanitizeSurrogates(`${low}hello`)).toBe('hello');
  });

  it('removes high surrogate at the end of string', () => {
    const high = String.fromCharCode(0xd800);
    expect(sanitizeSurrogates(`hello${high}`)).toBe('hello');
  });
});
