import { describe, expect, it } from 'vitest';
import {
  COMPOSER_REFERENCE_CHARACTER,
  getComposerLinearText,
  replaceComposerRange,
} from '@/store/composer-document';

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
      },
    );

    expect(
      document.segments.filter(
        (segment) => segment.type === 'reference' && segment.reference.kind === 'skill',
      ),
    ).toHaveLength(1);
  });
});
