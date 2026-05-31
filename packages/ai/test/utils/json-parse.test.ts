// ============================================================
// json-parse 测试 — JSON 修复与流式 JSON 解析
// ============================================================

import { describe, it, expect } from 'vitest';
import { repairJson, parseJsonWithRepair, parseStreamingJson } from '../../src/utils/json-parse';

// ---------- repairJson ----------

describe('repairJson', () => {
  it('returns valid JSON unchanged', () => {
    expect(repairJson('{"key":"value"}')).toBe('{"key":"value"}');
  });

  it('escapes raw control characters inside strings', () => {
    const input = '{"text":"line1\nline2"}';
    const repaired = repairJson(input);
    expect(repaired).toBe('{"text":"line1\\nline2"}');
  });

  it('escapes raw tab character inside strings', () => {
    const input = '{"text":"col1\tcol2"}';
    const repaired = repairJson(input);
    expect(repaired).toBe('{"text":"col1\\tcol2"}');
  });

  it('does not double-escape already escaped newlines', () => {
    const input = '{"text":"line1\\nline2"}';
    expect(repairJson(input)).toBe('{"text":"line1\\nline2"}');
  });

  it('preserves valid unicode escapes', () => {
    const input = '{"emoji":"\\u0041"}';
    expect(repairJson(input)).toBe('{"emoji":"\\u0041"}');
  });

  it('doubles backslash before invalid escape character', () => {
    const input = '{"text":"hello\\xworld"}';
    const repaired = repairJson(input);
    expect(repaired).toBe('{"text":"hello\\\\xworld"}');
  });

  it('handles backslash before invalid escape in string', () => {
    const input = '{"text":"path\\\\file"}';
    expect(repairJson(input)).toBe(input);
  });

  it('handles multiple strings with control characters', () => {
    const input = '{"a":"line1\nline2","b":"tab\there"}';
    const repaired = repairJson(input);
    expect(() => JSON.parse(repaired)).not.toThrow();
  });

  it('does not modify content outside of strings', () => {
    const input = '{"num":42,"flag":true}';
    expect(repairJson(input)).toBe(input);
  });

  it('preserves valid escape sequences', () => {
    const input =
      '{"text":"quotes: \\" backslash: \\\\ slash: \\/ backspace: \\b formfeed: \\f newline: \\n cr: \\r tab: \\t"}';
    expect(repairJson(input)).toBe(input);
  });
});

// ---------- parseJsonWithRepair ----------

describe('parseJsonWithRepair', () => {
  it('parses valid JSON directly', () => {
    expect(parseJsonWithRepair('{"key":"value"}')).toEqual({ key: 'value' });
  });

  it('parses valid JSON array', () => {
    expect(parseJsonWithRepair('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('repairs and parses JSON with control characters', () => {
    const input = '{"text":"hello\nworld"}';
    const result = parseJsonWithRepair<Record<string, string>>(input);
    expect(result.text).toBe('hello\nworld');
  });

  it('throws for truly unparseable JSON', () => {
    expect(() => parseJsonWithRepair('not json at all')).toThrow();
  });

  it('handles JSON with escaped backslash before invalid escape', () => {
    const input = '{"text":"hello\\xworld"}';
    const result = parseJsonWithRepair<Record<string, string>>(input);
    expect(result.text).toBe('hello\\xworld');
  });
});

// ---------- parseStreamingJson ----------

describe('parseStreamingJson', () => {
  it('parses complete JSON', () => {
    expect(parseStreamingJson('{"key":"value"}')).toEqual({ key: 'value' });
  });

  it('returns empty object for empty string', () => {
    expect(parseStreamingJson('')).toEqual({});
  });

  it('returns empty object for undefined input', () => {
    expect(parseStreamingJson(undefined)).toEqual({});
  });

  it('returns empty object for whitespace-only string', () => {
    expect(parseStreamingJson('   ')).toEqual({});
  });

  it('parses partial JSON (incomplete object)', () => {
    const result = parseStreamingJson('{"key":"val');
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  it('parses partial JSON with incomplete array', () => {
    const result = parseStreamingJson('{"items":[1,2,3');
    expect(result).toBeDefined();
  });

  it('handles JSON with control characters via repair fallback', () => {
    const input = '{"text":"line1\nline2"}';
    const result = parseStreamingJson<Record<string, string>>(input);
    expect(result.text).toBe('line1\nline2');
  });

  it('returns empty object for completely unparseable input after all fallbacks', () => {
    const result = parseStreamingJson('}}}{}}}');
    expect(result).toEqual({});
  });

  it('parses complete nested JSON', () => {
    const input = '{"outer":{"inner":"value"}}';
    expect(parseStreamingJson(input)).toEqual({ outer: { inner: 'value' } });
  });
});
