import { describe, expect, it } from 'vitest';
import { extractSessionTextContent } from '../../src/core/session/index.ts';

describe('extractSessionTextContent', () => {
  it('returns plain string content unchanged', () => {
    expect(extractSessionTextContent('hello')).toBe('hello');
  });

  it('joins text parts and ignores non-text content', () => {
    expect(
      extractSessionTextContent([
        { type: 'text', text: 'first ' },
        { type: 'image', text: 'ignored' },
        { type: 'text', text: 'second' },
      ]),
    ).toBe('first second');
  });

  it('treats missing text fields as empty strings', () => {
    expect(extractSessionTextContent([{ type: 'text' }, { type: 'text', text: 'kept' }])).toBe(
      'kept',
    );
  });
});
