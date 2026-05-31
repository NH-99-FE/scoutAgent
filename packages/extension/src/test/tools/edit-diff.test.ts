// ============================================================
// EditDiff 测试
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  applyEditsToNormalizedContent,
  detectLineEnding,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
  fuzzyFindText,
  generateDiffString,
} from '../../tools/shared/edit-diff.ts';

describe('detectLineEnding', () => {
  it('detects CRLF', () => {
    expect(detectLineEnding('a\r\nb')).toBe('\r\n');
  });

  it('detects LF', () => {
    expect(detectLineEnding('a\nb')).toBe('\n');
  });

  it('defaults to LF when no newlines', () => {
    expect(detectLineEnding('hello')).toBe('\n');
  });
});

describe('normalizeToLF', () => {
  it('converts CRLF to LF', () => {
    expect(normalizeToLF('a\r\nb\r\n')).toBe('a\nb\n');
  });

  it('converts CR to LF', () => {
    expect(normalizeToLF('a\rb')).toBe('a\nb');
  });
});

describe('restoreLineEndings', () => {
  it('restores CRLF', () => {
    expect(restoreLineEndings('a\nb', '\r\n')).toBe('a\r\nb');
  });

  it('keeps LF', () => {
    expect(restoreLineEndings('a\nb', '\n')).toBe('a\nb');
  });
});

describe('stripBom', () => {
  it('strips BOM', () => {
    const { bom, text } = stripBom('\uFEFFhello');
    expect(bom).toBe('\uFEFF');
    expect(text).toBe('hello');
  });

  it('returns empty BOM for content without BOM', () => {
    const { bom, text } = stripBom('hello');
    expect(bom).toBe('');
    expect(text).toBe('hello');
  });
});

describe('fuzzyFindText', () => {
  it('finds exact match', () => {
    const result = fuzzyFindText('hello world', 'world');
    expect(result.found).toBe(true);
    expect(result.index).toBe(6);
    expect(result.usedFuzzyMatch).toBe(false);
  });

  it('finds fuzzy match with trailing whitespace difference', () => {
    const result = fuzzyFindText('hello world  \nfoo', 'world\n');
    expect(result.found).toBe(true);
    expect(result.usedFuzzyMatch).toBe(true);
  });

  it('returns not found when text is absent', () => {
    const result = fuzzyFindText('hello world', 'xyz');
    expect(result.found).toBe(false);
  });
});

describe('applyEditsToNormalizedContent', () => {
  it('applies a single edit', () => {
    const result = applyEditsToNormalizedContent(
      'hello world',
      [{ oldText: 'world', newText: 'Scout' }],
      'test.txt',
    );
    expect(result.newContent).toBe('hello Scout');
  });

  it('applies multiple non-overlapping edits in reverse order', () => {
    const result = applyEditsToNormalizedContent(
      'aaa bbb ccc',
      [
        { oldText: 'aaa', newText: 'AAA' },
        { oldText: 'ccc', newText: 'CCC' },
      ],
      'test.txt',
    );
    expect(result.newContent).toBe('AAA bbb CCC');
  });

  it('throws on empty oldText', () => {
    expect(() =>
      applyEditsToNormalizedContent('hello', [{ oldText: '', newText: 'x' }], 'test.txt'),
    ).toThrow(/must not be empty/);
  });

  it('throws on not found', () => {
    expect(() =>
      applyEditsToNormalizedContent('hello', [{ oldText: 'xyz', newText: 'abc' }], 'test.txt'),
    ).toThrow(/Could not find/);
  });

  it('throws on duplicate matches', () => {
    expect(() =>
      applyEditsToNormalizedContent('aaa aaa', [{ oldText: 'aaa', newText: 'bbb' }], 'test.txt'),
    ).toThrow(/unique/);
  });

  it('throws on overlapping edits', () => {
    expect(() =>
      applyEditsToNormalizedContent(
        'abcdef',
        [
          { oldText: 'abc', newText: 'ABC' },
          { oldText: 'cde', newText: 'CDE' },
        ],
        'test.txt',
      ),
    ).toThrow(/overlap/);
  });

  it('throws when no change results', () => {
    expect(() =>
      applyEditsToNormalizedContent('hello', [{ oldText: 'hello', newText: 'hello' }], 'test.txt'),
    ).toThrow(/No changes/);
  });
});

describe('generateDiffString', () => {
  it('generates diff with line numbers', () => {
    const result = generateDiffString('hello\nworld', 'hello\nScout');
    expect(result.diff).toContain('+');
    expect(result.diff).toContain('Scout');
    expect(result.firstChangedLine).toBe(2);
  });
});
