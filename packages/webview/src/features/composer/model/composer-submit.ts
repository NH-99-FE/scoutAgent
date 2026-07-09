// ============================================================
// Composer Submit — 输入区提交契约
// ============================================================

import type { ComposerImageDescriptor } from '@/store/composer-store';

export type ComposerMode = 'currentSession' | 'newSession';
export type ComposerSubmitDelivery = 'steer' | 'followUp';

export interface ComposerSubmitPayload {
  images?: ComposerImageDescriptor[];
  text: string;
}

export interface PendingComposerSubmit extends ComposerSubmitPayload {
  deliverAs?: ComposerSubmitDelivery;
}

export type ComposerSubmitPhase = 'idle' | 'encoding_images' | 'new_session_blocked';

export interface ComposerSubmitState {
  pendingSubmit: PendingComposerSubmit | null;
  phase: ComposerSubmitPhase;
}

export type ComposerSubmitStateAction =
  | { type: 'begin_encoding_images' }
  | { type: 'finish_encoding_images' }
  | { type: 'block_new_session_submit' }
  | { type: 'release_new_session_block' }
  | { type: 'set_pending_submit'; submit: PendingComposerSubmit }
  | { type: 'clear_pending_submit' };

export const INITIAL_COMPOSER_SUBMIT_STATE: ComposerSubmitState = {
  pendingSubmit: null,
  phase: 'idle',
};

export function reduceComposerSubmitState(
  state: ComposerSubmitState,
  action: ComposerSubmitStateAction,
): ComposerSubmitState {
  switch (action.type) {
    case 'begin_encoding_images':
      return { ...state, phase: 'encoding_images' };
    case 'finish_encoding_images':
      return state.phase === 'encoding_images' ? { ...state, phase: 'idle' } : state;
    case 'block_new_session_submit':
      return { ...state, phase: 'new_session_blocked' };
    case 'release_new_session_block':
      return state.phase === 'new_session_blocked' ? { ...state, phase: 'idle' } : state;
    case 'set_pending_submit':
      return { ...state, pendingSubmit: action.submit };
    case 'clear_pending_submit':
      return state.pendingSubmit === null ? state : { ...state, pendingSubmit: null };
    default:
      return state;
  }
}
