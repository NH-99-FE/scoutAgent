import { describe, expect, it } from 'vitest';
import {
  formatComposerSubmitText,
  INITIAL_COMPOSER_SUBMIT_STATE,
  isComposerSubmissionBlocked,
  reduceComposerSubmitState,
} from '@/features/composer/model/composer-submit';

describe('reduceComposerSubmitState', () => {
  it('blocks submission for exclusive session mutations but keeps streaming follow-ups available', () => {
    expect(isComposerSubmissionBlocked({ kind: 'agent', cancellable: true }, true)).toBe(false);
    expect(isComposerSubmissionBlocked({ kind: 'agent', cancellable: false }, false)).toBe(true);
    expect(
      isComposerSubmissionBlocked(
        {
          kind: 'tree_navigation',
          operationId: 'navigation-1',
          phase: 'preflight',
          cancellable: true,
        },
        false,
      ),
    ).toBe(true);
    expect(
      isComposerSubmissionBlocked({ kind: 'session_mutation', cancellable: false }, false),
    ).toBe(true);
    expect(
      isComposerSubmissionBlocked({ kind: 'idle', cancellable: false }, false, {
        allowed: false,
        reason: 'session_busy',
        message: '会话正在运行',
      }),
    ).toBe(true);
  });

  it('models encoding and new-session block as explicit submit phases', () => {
    const encodingState = reduceComposerSubmitState(INITIAL_COMPOSER_SUBMIT_STATE, {
      type: 'begin_encoding_images',
    });

    expect(encodingState.phase).toBe('encoding_images');

    const idleState = reduceComposerSubmitState(encodingState, {
      type: 'finish_encoding_images',
    });
    const blockedState = reduceComposerSubmitState(idleState, {
      type: 'block_new_session_submit',
    });

    expect(blockedState.phase).toBe('new_session_blocked');
    expect(
      reduceComposerSubmitState(blockedState, { type: 'release_new_session_block' }).phase,
    ).toBe('idle');
  });

  it('tracks pending submit separately from the active submit phase', () => {
    const pendingSubmit = {
      document: { segments: [{ text: 'queued follow-up', type: 'text' as const }] },
    };
    const pendingState = reduceComposerSubmitState(INITIAL_COMPOSER_SUBMIT_STATE, {
      type: 'set_pending_submit',
      submit: pendingSubmit,
    });

    expect(pendingState).toEqual({
      pendingSubmit,
      phase: 'idle',
    });
    expect(
      reduceComposerSubmitState(pendingState, { type: 'clear_pending_submit' }).pendingSubmit,
    ).toBeNull();
  });

  it('serializes a selected skill only when sending the draft', () => {
    expect(
      formatComposerSubmitText({
        document: {
          segments: [
            {
              reference: {
                commandName: 'skill:request-refactor-plan',
                id: 'skill:request-refactor-plan',
                kind: 'skill',
                path: '/skills/request-refactor-plan/SKILL.md',
              },
              type: 'reference',
            },
            {
              text: ' extract the notification flow',
              type: 'text',
            },
          ],
        },
      }),
    ).toBe('/skill:request-refactor-plan extract the notification flow');
    expect(
      formatComposerSubmitText({
        document: {
          segments: [
            {
              reference: {
                commandName: 'skill:request-refactor-plan',
                id: 'skill:request-refactor-plan',
                kind: 'skill',
                path: '/skills/request-refactor-plan/SKILL.md',
              },
              type: 'reference',
            },
            { text: ' ', type: 'text' },
          ],
        },
      }),
    ).toBe('/skill:request-refactor-plan');
  });

  it('serializes a file reference at an arbitrary document position', () => {
    expect(
      formatComposerSubmitText({
        document: {
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
      }),
    ).toBe('inspect @src/agent.ts before editing');
  });

  it('quotes a file reference whose path contains spaces', () => {
    expect(
      formatComposerSubmitText({
        document: {
          segments: [
            { text: 'inspect ', type: 'text' },
            {
              reference: {
                fileKind: 'file',
                id: 'My Folder/file.ts',
                kind: 'file',
                label: 'file.ts',
                path: 'My Folder/file.ts',
              },
              type: 'reference',
            },
          ],
        },
      }),
    ).toBe('inspect @"My Folder/file.ts"');
  });
});
