// ============================================================
// Composer Store — 按会话隔离输入草稿
// ============================================================

import { create } from 'zustand';
import type { ScoutImageContent } from '@scout-agent/shared';

interface ComposerActions {
  addImages: (sessionId: string, images: ScoutImageContent[]) => void;
  removeImage: (sessionId: string, index: number) => void;
  setText: (sessionId: string, text: string) => void;
  clearDraft: (sessionId: string) => void;
  clearText: (sessionId: string) => void;
  reset: () => void;
}

interface ComposerStore {
  imagesBySessionId: Record<string, ScoutImageContent[]>;
  textBySessionId: Record<string, string>;
  actions: ComposerActions;
}

const EMPTY_SESSION_ID = '__empty_session__';
const EMPTY_IMAGES: ScoutImageContent[] = [];
export const HOME_COMPOSER_SESSION_ID = '__task_home__';

const initialState = {
  imagesBySessionId: {} as Record<string, ScoutImageContent[]>,
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
