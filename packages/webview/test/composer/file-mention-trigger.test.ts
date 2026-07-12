import { describe, expect, it } from 'vitest';
import { getFileMentionTrigger } from '@/features/composer/model/file-mention-trigger';
import { getComposerPlainText, replaceComposerRange } from '@/store/composer-document';

describe('getFileMentionTrigger', () => {
  it('opens the add state for an at sign at the beginning of the composer', () => {
    expect(getFileMentionTrigger('@', 1)).toEqual({
      query: '',
      range: { start: 0, end: 1 },
    });
  });

  it('opens file search for content after a boundary at sign', () => {
    expect(getFileMentionTrigger('inspect @agent', 14)).toEqual({
      query: 'agent',
      range: { start: 8, end: 14 },
    });
    expect(getFileMentionTrigger('inspect\n@src', 12)).toEqual({
      query: 'src',
      range: { start: 8, end: 12 },
    });
  });

  it('does not open inside a word or after the mention token is complete', () => {
    expect(getFileMentionTrigger('email@agent', 11)).toBeNull();
    expect(getFileMentionTrigger('@agent next', 11)).toBeNull();
  });

  it('uses the mention token that contains the caret', () => {
    const trigger = getFileMentionTrigger('@agent', 3);
    expect(trigger).toEqual({
      query: 'agent',
      range: { start: 0, end: 6 },
    });
    expect(
      getComposerPlainText(
        replaceComposerRange(
          { segments: [{ text: '@agent', type: 'text' }] },
          trigger?.range ?? { start: 0, end: 0 },
          '',
        ),
      ),
    ).toBe('');

    expect(getFileMentionTrigger('@first and @second tail', 14)).toEqual({
      query: 'second',
      range: { start: 11, end: 18 },
    });
    expect(getFileMentionTrigger('@agent', 1)).toEqual({
      query: 'agent',
      range: { start: 0, end: 6 },
    });
  });

  it('continues search inside a quoted path and consumes its closing quote', () => {
    const text = 'inspect @"My Folder/file.ts" next';

    expect(getFileMentionTrigger(text, 20)).toEqual({
      query: 'My Folder/file.ts',
      range: { start: 8, end: 28 },
    });
    expect(getFileMentionTrigger('inspect @"My Folder/fi', 22)).toEqual({
      query: 'My Folder/fi',
      range: { start: 8, end: 22 },
    });
  });

  it('does not reopen a completed quoted mention after its closing quote', () => {
    expect(getFileMentionTrigger('@"My Folder/file.ts"', 20)).toBeNull();
  });
});
