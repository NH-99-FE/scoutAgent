import { describe, expect, it } from 'vitest';
import {
  INITIAL_COMPOSER_SUBMIT_STATE,
  reduceComposerSubmitState,
} from '@/features/composer/model/composer-submit';

describe('reduceComposerSubmitState', () => {
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
    const pendingSubmit = { text: 'queued follow-up' };
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
});
