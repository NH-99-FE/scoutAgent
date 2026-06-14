// ============================================================
// Composer Store — 按会话隔离输入草稿
// ============================================================

import { create } from 'zustand';
import type { ScoutImageContent } from '@scout-agent/shared';

interface ComposerDraft {
  images?: ScoutImageContent[];
  text: string;
}

interface ComposerActions {
  addImages: (sessionId: string, images: ScoutImageContent[]) => void;
  removeImage: (sessionId: string, index: number) => void;
  setText: (sessionId: string, text: string) => void;
  stagePendingDraft: (sessionId: string, draft: ComposerDraft) => void;
  restorePendingDraft: (sessionId: string) => void;
  discardPendingDraft: (sessionId: string) => void;
  clearDraft: (sessionId: string) => void;
  clearText: (sessionId: string) => void;
  reset: () => void;
}

interface ComposerStore {
  imagesBySessionId: Record<string, ScoutImageContent[]>;
  pendingDraftBySessionId: Record<string, ComposerDraft>;
  textBySessionId: Record<string, string>;
  actions: ComposerActions;
}

const EMPTY_SESSION_ID = '__empty_session__';
const EMPTY_IMAGES: ScoutImageContent[] = [];
export const HOME_COMPOSER_SESSION_ID = '__task_home__';

const initialState = {
  imagesBySessionId: {} as Record<string, ScoutImageContent[]>,
  pendingDraftBySessionId: {} as Record<string, ComposerDraft>,
  textBySessionId: {} as Record<string, string>,
};

function getComposerSessionId(sessionId: string): string {
  return sessionId || EMPTY_SESSION_ID;
}

export const useComposerStore = create<ComposerStore>((set) => ({
  ...initialState,
  actions: {
    addImages: (sessionId, images) => {
      if (images.length === 0) return;
      set((state) => {
        const key = getComposerSessionId(sessionId);
        return {
          imagesBySessionId: {
            ...state.imagesBySessionId,
            [key]: [...(state.imagesBySessionId[key] ?? []), ...images],
          },
        };
      });
    },
    removeImage: (sessionId, index) =>
      set((state) => {
        const key = getComposerSessionId(sessionId);
        const currentImages = state.imagesBySessionId[key] ?? [];
        const nextImages = currentImages.filter((_, imageIndex) => imageIndex !== index);
        if (nextImages.length === currentImages.length) return state;
        const nextImagesBySessionId = { ...state.imagesBySessionId };
        if (nextImages.length === 0) {
          delete nextImagesBySessionId[key];
        } else {
          nextImagesBySessionId[key] = nextImages;
        }
        return { imagesBySessionId: nextImagesBySessionId };
      }),
    setText: (sessionId, text) =>
      set((state) => {
        const key = getComposerSessionId(sessionId);
        if (state.textBySessionId[key] === text) return state;
        return {
          textBySessionId: {
            ...state.textBySessionId,
            [key]: text,
          },
        };
      }),
    stagePendingDraft: (sessionId, draft) =>
      set((state) => {
        const key = getComposerSessionId(sessionId);
        return {
          pendingDraftBySessionId: {
            ...state.pendingDraftBySessionId,
            [key]: {
              text: draft.text,
              images: draft.images ? [...draft.images] : undefined,
            },
          },
        };
      }),
    restorePendingDraft: (sessionId) =>
      set((state) => {
        const key = getComposerSessionId(sessionId);
        const pendingDraft = state.pendingDraftBySessionId[key];
        if (!pendingDraft) return state;

        const nextPendingDrafts = { ...state.pendingDraftBySessionId };
        delete nextPendingDrafts[key];

        const currentText = state.textBySessionId[key] ?? '';
        const currentImages = state.imagesBySessionId[key] ?? [];
        if (currentText.length > 0 || currentImages.length > 0) {
          return { pendingDraftBySessionId: nextPendingDrafts };
        }

        const nextImagesBySessionId = { ...state.imagesBySessionId };
        const nextTextBySessionId = { ...state.textBySessionId };
        if (pendingDraft.images && pendingDraft.images.length > 0) {
          nextImagesBySessionId[key] = [...pendingDraft.images];
        } else {
          delete nextImagesBySessionId[key];
        }
        if (pendingDraft.text) {
          nextTextBySessionId[key] = pendingDraft.text;
        } else {
          delete nextTextBySessionId[key];
        }
        return {
          imagesBySessionId: nextImagesBySessionId,
          pendingDraftBySessionId: nextPendingDrafts,
          textBySessionId: nextTextBySessionId,
        };
      }),
    discardPendingDraft: (sessionId) =>
      set((state) => {
        const key = getComposerSessionId(sessionId);
        if (state.pendingDraftBySessionId[key] === undefined) return state;
        const nextPendingDrafts = { ...state.pendingDraftBySessionId };
        delete nextPendingDrafts[key];
        return { pendingDraftBySessionId: nextPendingDrafts };
      }),
    clearDraft: (sessionId) =>
      set((state) => {
        const key = getComposerSessionId(sessionId);
        if (
          state.imagesBySessionId[key] === undefined &&
          state.textBySessionId[key] === undefined
        ) {
          return state;
        }
        const nextImagesBySessionId = { ...state.imagesBySessionId };
        const nextTextBySessionId = { ...state.textBySessionId };
        delete nextImagesBySessionId[key];
        delete nextTextBySessionId[key];
        return {
          imagesBySessionId: nextImagesBySessionId,
          textBySessionId: nextTextBySessionId,
        };
      }),
    clearText: (sessionId) =>
      set((state) => {
        const key = getComposerSessionId(sessionId);
        if (state.textBySessionId[key] === undefined) return state;
        const nextTextBySessionId = { ...state.textBySessionId };
        delete nextTextBySessionId[key];
        return { textBySessionId: nextTextBySessionId };
      }),
    reset: () => set(initialState),
  },
}));

export const useComposerImages = (sessionId: string) =>
  useComposerStore(
    (state) => state.imagesBySessionId[getComposerSessionId(sessionId)] ?? EMPTY_IMAGES,
  );

export const useComposerText = (sessionId: string) =>
  useComposerStore((state) => state.textBySessionId[getComposerSessionId(sessionId)] ?? '');

export const useComposerActions = () => useComposerStore((state) => state.actions);
