// ============================================================
// Truncate 测试
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  truncateHead,
  truncateTail,
  truncateLine,
  formatSize,
} from '../../tools/shared/truncate.ts';

describe('truncateHead', () => {
  it('returns content unchanged when within limits', () => {
    const result = truncateHead('hello\nworld');
    expect(result.truncated).toBe(false);
    expect(result.content).toBe('hello\nworld');
  });

  it('truncates by lines when exceeding maxLines', () => {
    const content = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
    const result = truncateHead(content, { maxLines: 3 });
    expect(result.truncated).toBe(true);
    expect(result.truncatedBy).toBe('lines');
    expect(result.outputLines).toBe(3);
    expect(result.content).toBe('line 1\nline 2\nline 3');
  });

  it('truncates by bytes when exceeding maxBytes', () => {
    const content = 'a'.repeat(1000);
    const result = truncateHead(content, { maxBytes: 100 });
    expect(result.truncated).toBe(true);
    expect(result.truncatedBy).toBe('bytes');
  });

  it('reports firstLineExceedsLimit when first line exceeds byte limit', () => {
    const content = 'a'.repeat(1000);
    const result = truncateHead(content, { maxBytes: 100 });
    expect(result.firstLineExceedsLimit).toBe(true);
    expect(result.content).toBe('');
  });

  it('counts total lines correctly', () => {
    const content = 'a\nb\nc\nd';
    const result = truncateHead(content, { maxLines: 2 });
    expect(result.totalLines).toBe(4);
  });
});

describe('truncateTail', () => {
  it('returns content unchanged when within limits', () => {
    const result = truncateTail('hello\nworld');
    expect(result.truncated).toBe(false);
    expect(result.content).toBe('hello\nworld');
  });

  it('keeps last N lines', () => {
    const content = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
    const result = truncateTail(content, { maxLines: 3 });
    expect(result.truncated).toBe(true);
    expect(result.content).toBe('line 8\nline 9\nline 10');
  });

  it('handles partial first line in byte truncation', () => {
    const content = 'a'.repeat(1000);
    const result = truncateTail(content, { maxBytes: 100 });
    expect(result.truncated).toBe(true);
    expect(result.lastLinePartial).toBe(true);
  });
});

describe('truncateLine', () => {
  it('returns line unchanged when within limit', () => {
    const result = truncateLine('short line', 100);
    expect(result.text).toBe('short line');
    expect(result.wasTruncated).toBe(false);
  });

  it('truncates long lines', () => {
    const longLine = 'a'.repeat(1000);
    const result = truncateLine(longLine, 100);
    expect(result.text.length).toBeLessThan(longLine.length);
    expect(result.wasTruncated).toBe(true);
    expect(result.text).toContain('[truncated]');
  });
});

describe('formatSize', () => {
  it('formats bytes', () => {
    expect(formatSize(500)).toBe('500B');
  });

  it('formats kilobytes', () => {
    expect(formatSize(2048)).toBe('2.0KB');
  });

  it('formats megabytes', () => {
    expect(formatSize(2 * 1024 * 1024)).toBe('2.0MB');
  });
});
