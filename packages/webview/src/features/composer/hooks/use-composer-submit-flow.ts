// ============================================================
// useComposerSubmitFlow — 输入区提交与异步 guard
// ============================================================

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import type { ScoutImageContent, ScoutQueueState } from '@scout-agent/shared';
import { protocolClient } from '@/bridge/protocol-client';
import { retainComposerImageLease, type ComposerImageLease } from '@/store/composer-image-registry';
import { getComposerDraftSnapshot, useComposerActions } from '@/store/composer-store';
import type { ComposerImageDescriptor } from '@/store/composer-store';
import { getVisualBusyStateSnapshot } from '@/store/runtime-overlay-store';
import { useSessionStore } from '@/store/session-store';
import { useUiActions, useUiStore } from '@/store/ui-store';
import { ComposerImageEncodeError, encodeComposerImageAttachments } from '../model/composer-images';
import { INITIAL_COMPOSER_SUBMIT_STATE, reduceComposerSubmitState } from '../model/composer-submit';
import type {
  ComposerMode,
  ComposerSubmitDelivery,
  ComposerSubmitPayload,
  ComposerSubmitStateAction,
  PendingComposerSubmit,
} from '../model/composer-submit';

interface ComposerSubmitContext {
  generation: number;
  mode: ComposerMode;
  sessionId: string;
}

interface SubmitGeneration {
  mode: ComposerMode;
  sessionId: string;
  value: number;
}

interface UseComposerSubmitFlowOptions {
  images: ComposerImageDescriptor[];
  isStreaming: boolean;
  mode: ComposerMode;
  onBeginNewSessionRequest?: () => void;
  onMessageSent?: () => void;
  queueState: ScoutQueueState;
  sessionId: string;
  submitDisabled: boolean;
  text: string;
}

interface ComposerSubmitFlow {
  canSubmit: boolean;
  closePendingSubmitDialog: () => void;
  hasDraft: boolean;
  isDraftLocked: boolean;
  isSubmitPending: boolean;
  pendingSubmit: PendingComposerSubmit | null;
  sendPendingSubmit: (clearFollowUpQueue: boolean) => void;
  submit: (delivery?: ComposerSubmitDelivery) => Promise<void>;
}

const COMPACTION_SEND_BLOCKED_MESSAGE = '正在压缩上下文，请等待压缩完成后再发送';

export function useComposerSubmitFlow({
  images,
  isStreaming,
  mode,
  onBeginNewSessionRequest,
  onMessageSent,
  queueState,
  sessionId,
  submitDisabled,
  text,
}: UseComposerSubmitFlowOptions): ComposerSubmitFlow {
  const [submitState, dispatchSubmitState] = useReducer(
    reduceComposerSubmitState,
    INITIAL_COMPOSER_SUBMIT_STATE,
  );
  const submitStateRef = useRef(submitState);
  const pendingSubmitLeaseRef = useRef<ComposerImageLease | null>(null);
  const composerActions = useComposerActions();
  const uiActions = useUiActions();
  const { createSubmitContext, isSubmitContextActive, isSubmitContextMounted } =
    useComposerSubmitContextGuard(mode, sessionId);

  const isCurrentSessionMode = mode === 'currentSession';
  const hasText = text.trim().length > 0;
  const hasImages = images.length > 0;
  const hasDraft = hasText || hasImages;
  const hasPausedFollowUps = queueState.paused && queueState.followUps.length > 0;
  const submitBusy = submitState.phase !== 'idle';
  const isSubmitPending = (mode === 'newSession' && submitDisabled) || submitBusy;
  const isDraftLocked = (mode === 'newSession' && submitDisabled) || submitBusy;
  const canSubmit = hasDraft && !submitDisabled && !submitBusy;

  const transitionSubmitState = useCallback((action: ComposerSubmitStateAction) => {
    submitStateRef.current = reduceComposerSubmitState(submitStateRef.current, action);
    dispatchSubmitState(action);
  }, []);

  const releasePendingSubmitLease = useCallback(() => {
    pendingSubmitLeaseRef.current?.release();
    pendingSubmitLeaseRef.current = null;
  }, []);

  const setLeasedPendingSubmit = useCallback(
    (nextSubmit: PendingComposerSubmit | null) => {
      releasePendingSubmitLease();
      pendingSubmitLeaseRef.current = retainComposerImageLease(nextSubmit?.images);
      transitionSubmitState(
        nextSubmit
          ? { type: 'set_pending_submit', submit: nextSubmit }
          : { type: 'clear_pending_submit' },
      );
    },
    [releasePendingSubmitLease, transitionSubmitState],
  );

  useLayoutEffect(() => {
    submitStateRef.current = submitState;
  }, [submitState]);

  useEffect(() => {
    return releasePendingSubmitLease;
  }, [releasePendingSubmitLease]);

  useEffect(() => {
    if (submitDisabled) return;
    transitionSubmitState({ type: 'release_new_session_block' });
  }, [submitDisabled, transitionSubmitState]);

  const notifyImageEncodeError = useCallback(
    (error: unknown) => {
      uiActions.setNotification({
        type: 'notification',
        level: 'error',
        message:
          error instanceof ComposerImageEncodeError ? error.message : '图片读取失败，请重新选择',
      });
    },
    [uiActions],
  );

  const blockCompactionSubmit = useCallback(
    (payload: ComposerSubmitPayload) => {
      const currentImageCount = getComposerDraftSnapshot(sessionId).images?.length ?? 0;
      if (payload.images && payload.images.length > 0 && currentImageCount === 0) {
        const restoredImageLease = retainComposerImageLease(payload.images);
        const restoredImages = restoredImageLease?.transfer() ?? [];
        composerActions.addImages(sessionId, restoredImages);
      }
      setLeasedPendingSubmit(null);
      uiActions.setNotification({
        type: 'notification',
        level: 'error',
        message: COMPACTION_SEND_BLOCKED_MESSAGE,
      });
    },
    [composerActions, sessionId, setLeasedPendingSubmit, uiActions],
  );

  const encodeImagesForProtocol = useCallback(
    async (nextImages: ComposerImageDescriptor[] | undefined) => {
      if (!nextImages || nextImages.length === 0) return undefined;
      transitionSubmitState({ type: 'begin_encoding_images' });
      try {
        const encodedImages = await encodeComposerImageAttachments(nextImages);
        return encodedImages.length > 0 ? encodedImages : undefined;
      } finally {
        if (isSubmitContextMounted()) {
          transitionSubmitState({ type: 'finish_encoding_images' });
        }
      }
    },
    [isSubmitContextMounted, transitionSubmitState],
  );

  const sendMessage = useCallback(
    async (
      payload: ComposerSubmitPayload,
      deliverAs?: ComposerSubmitDelivery,
      options?: { clearFollowUpQueue?: boolean },
      context = createSubmitContext(),
    ) => {
      if (submitDisabled || submitStateRef.current.phase !== 'idle') return;
      if (!isSubmitContextActive(context)) return;
      if (isCurrentSessionMode && getVisualBusyStateSnapshot().kind === 'compaction') {
        blockCompactionSubmit(payload);
        return;
      }

      let protocolImages: ScoutImageContent[] | undefined;
      if (payload.images && payload.images.length > 0) {
        try {
          protocolImages = await encodeImagesForProtocol(payload.images);
        } catch (error) {
          if (isSubmitContextActive(context)) {
            notifyImageEncodeError(error);
          }
          return;
        }
      }
      if (
        submitDisabled ||
        submitStateRef.current.phase !== 'idle' ||
        !isSubmitContextActive(context)
      ) {
        return;
      }
      if (isCurrentSessionMode && getVisualBusyStateSnapshot().kind === 'compaction') {
        blockCompactionSubmit(payload);
        return;
      }

      if (mode === 'newSession') {
        transitionSubmitState({ type: 'block_new_session_submit' });
        onBeginNewSessionRequest?.();
        composerActions.stagePendingDraft(sessionId, payload);
        protocolClient.newSessionMessage(payload.text, protocolImages);
        composerActions.clearDraft(sessionId);
        setLeasedPendingSubmit(null);
        return;
      }
      protocolClient.userMessage(payload.text, deliverAs, {
        ...options,
        images: protocolImages,
      });
      onMessageSent?.();
      composerActions.clearDraft(sessionId);
      setLeasedPendingSubmit(null);
    },
    [
      blockCompactionSubmit,
      composerActions,
      encodeImagesForProtocol,
      createSubmitContext,
      isCurrentSessionMode,
      isSubmitContextActive,
      mode,
      onBeginNewSessionRequest,
      onMessageSent,
      sessionId,
      setLeasedPendingSubmit,
      submitDisabled,
      notifyImageEncodeError,
      transitionSubmitState,
    ],
  );

  const submit = useCallback(
    async (delivery?: ComposerSubmitDelivery) => {
      if (submitDisabled || submitStateRef.current.phase !== 'idle') return;
      const submitContext = createSubmitContext();
      if (!isSubmitContextActive(submitContext)) return;
      const draft = getComposerDraftSnapshot(sessionId);
      const nextText = draft.text.trim();
      const nextImages = draft.images ?? [];
      if (!nextText && nextImages.length === 0) return;
      const payload = {
        text: nextText,
        images: nextImages.length > 0 ? nextImages : undefined,
      };
      const deliverAs = isStreaming && !hasPausedFollowUps ? (delivery ?? 'followUp') : delivery;
      if (hasPausedFollowUps && !deliverAs) {
        setLeasedPendingSubmit(payload);
        return;
      }
      await sendMessage(payload, deliverAs, undefined, submitContext);
    },
    [
      createSubmitContext,
      hasPausedFollowUps,
      isStreaming,
      isSubmitContextActive,
      sendMessage,
      setLeasedPendingSubmit,
      sessionId,
      submitDisabled,
    ],
  );

  const closePendingSubmitDialog = useCallback(() => {
    setLeasedPendingSubmit(null);
  }, [setLeasedPendingSubmit]);

  const sendPendingSubmit = useCallback(
    (clearFollowUpQueue: boolean) => {
      if (!submitState.pendingSubmit) return;
      void sendMessage(submitState.pendingSubmit, submitState.pendingSubmit.deliverAs, {
        clearFollowUpQueue,
      });
    },
    [sendMessage, submitState.pendingSubmit],
  );

  return {
    canSubmit,
    closePendingSubmitDialog,
    hasDraft,
    isDraftLocked,
    isSubmitPending,
    pendingSubmit: submitState.pendingSubmit,
    sendPendingSubmit,
    submit,
  };
}

function useComposerSubmitContextGuard(mode: ComposerMode, sessionId: string) {
  const mountedRef = useRef(true);
  const generationRef = useRef<SubmitGeneration>({ mode, sessionId, value: 0 });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    const current = generationRef.current;
    if (current.mode === mode && current.sessionId === sessionId) return;
    generationRef.current = {
      mode,
      sessionId,
      value: current.value + 1,
    };
  }, [mode, sessionId]);

  const createSubmitContext = useCallback(
    (): ComposerSubmitContext => ({
      generation: generationRef.current.value,
      mode,
      sessionId,
    }),
    [mode, sessionId],
  );

  const isSubmitContextActive = useCallback((context: ComposerSubmitContext): boolean => {
    if (!mountedRef.current) return false;
    if (context.generation !== generationRef.current.value) return false;
    const uiState = useUiStore.getState();
    if (uiState.openingTaskSessionPath !== undefined) return false;
    if (context.mode === 'newSession') {
      return !uiState.newSessionPending && uiState.chatView !== 'detail';
    }
    return (
      useSessionStore.getState().sessionId === context.sessionId && uiState.chatView !== 'home'
    );
  }, []);

  const isSubmitContextMounted = useCallback(() => mountedRef.current, []);

  return {
    createSubmitContext,
    isSubmitContextActive,
    isSubmitContextMounted,
  };
}
