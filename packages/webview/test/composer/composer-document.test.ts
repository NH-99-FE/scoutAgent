import { describe, expect, it } from 'vitest';
import {
  COMPOSER_REFERENCE_CHARACTER,
  getComposerLinearText,
  insertComposerReferenceAt,
  insertComposerReferencesAt,
  replaceComposerRange,
  replaceComposerRangeWithReferences,
} from '@/store/composer-document';

const FILE_REFERENCE = {
  fileKind: 'file',
  id: 'src/agent.ts',
  kind: 'file',
  label: 'agent.ts',
  path: 'src/agent.ts',
} as const;

describe('composer document', () => {
  it('inserts a reference at an arbitrary document position without offsets', () => {
    const document = replaceComposerRange(
      { segments: [{ text: 'inspect before editing', type: 'text' }] },
      { start: 8, end: 8 },
      ' ',
      {
        fileKind: 'file',
        id: 'src/agent.ts',
        kind: 'file',
        label: 'agent.ts',
        path: 'src/agent.ts',
      },
    );

    expect(document).toEqual({
      segments: [
        { text: 'inspect ', type: 'text' },
        {
          reference: {
            fileKind: 'file',
            id: 'src/agent.ts',
            kind: 'file',
            label: 'agent.ts',
            path: 'src/agent.ts',
          },
          type: 'reference',
        },
        { text: ' before editing', type: 'text' },
      ],
    });
    expect(getComposerLinearText(document)).toBe(
      `inspect ${COMPOSER_REFERENCE_CHARACTER} before editing`,
    );
  });

  it('inserts a button-selected reference without consuming text after the caret', () => {
    const insertion = insertComposerReferenceAt(
      { segments: [{ text: 'hello', type: 'text' }] },
      3,
      FILE_REFERENCE,
    );

    expect(insertion.document.segments).toEqual([
      { text: 'hel ', type: 'text' },
      { reference: FILE_REFERENCE, type: 'reference' },
      { text: ' lo', type: 'text' },
    ]);
    expect(insertion.selectionOffset).toBe(6);
  });

  it('adds only the missing separators around a button-selected reference', () => {
    const insertion = insertComposerReferenceAt(
      { segments: [{ text: 'hello world', type: 'text' }] },
      6,
      FILE_REFERENCE,
    );

    expect(insertion.document.segments).toEqual([
      { text: 'hello ', type: 'text' },
      { reference: FILE_REFERENCE, type: 'reference' },
      { text: ' world', type: 'text' },
    ]);
  });

  it('inserts multiple references in selection order without consuming surrounding text', () => {
    const secondReference = {
      ...FILE_REFERENCE,
      id: 'src/main.ts',
      label: 'main.ts',
      path: 'src/main.ts',
    };
    const insertion = insertComposerReferencesAt(
      { segments: [{ text: 'hello', type: 'text' }] },
      3,
      [FILE_REFERENCE, secondReference],
    );

    expect(insertion.document.segments).toEqual([
      { text: 'hel ', type: 'text' },
      { reference: FILE_REFERENCE, type: 'reference' },
      { text: ' ', type: 'text' },
      { reference: secondReference, type: 'reference' },
      { text: ' lo', type: 'text' },
    ]);
  });

  it('replaces a mention token with multiple references atomically', () => {
    const secondReference = {
      ...FILE_REFERENCE,
      id: 'src/main.ts',
      label: 'main.ts',
      path: 'src/main.ts',
    };
    const insertion = replaceComposerRangeWithReferences(
      { segments: [{ text: '@src after', type: 'text' }] },
      { start: 0, end: 4 },
      [FILE_REFERENCE, secondReference],
    );

    expect(insertion.document.segments).toEqual([
      { reference: FILE_REFERENCE, type: 'reference' },
      { text: ' ', type: 'text' },
      { reference: secondReference, type: 'reference' },
      { text: ' after', type: 'text' },
    ]);
  });

  it('edits text before a reference without updating positional metadata', () => {
    const document = replaceComposerRange(
      {
        segments: [
          { text: 'inspect ', type: 'text' },
          {
            reference: {
              fileKind: 'file',
              id: 'src/agent.ts',
              kind: 'file',
              label: 'agent.ts',
              path: 'src/agent.ts',
            },
            type: 'reference',
          },
          { text: ' before editing', type: 'text' },
        ],
      },
      { start: 0, end: 7 },
      'review',
    );

    expect(document.segments).toEqual([
      { text: 'review ', type: 'text' },
      expect.objectContaining({ type: 'reference' }),
      { text: ' before editing', type: 'text' },
    ]);
  });

  it('keeps skill references unique when replacing the command', () => {
    const document = replaceComposerRange(
      {
        segments: [
          {
            reference: {
              commandName: 'skill:old',
              id: 'skill:old',
              kind: 'skill',
              path: '/skills/old/SKILL.md',
            },
            type: 'reference',
          },
          { text: ' prompt', type: 'text' },
        ],
      },
      { start: 0, end: 0 },
      ' ',
      {
        commandName: 'skill:new',
        id: 'skill:new',
        kind: 'skill',
        path: '/skills/new/SKILL.md',
      },
    );

    expect(
      document.segments.filter(
        (segment) => segment.type === 'reference' && segment.reference.kind === 'skill',
      ),
    ).toHaveLength(1);
  });
});
