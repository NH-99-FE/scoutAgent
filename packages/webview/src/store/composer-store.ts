// ============================================================
// Composer Store — 按会话隔离输入草稿
// ============================================================

import { create } from 'zustand';
import {
  releaseComposerImageDescriptors,
  resetComposerImageRegistry,
  retainComposerImageDescriptors,
  type ComposerImageDescriptor,
} from './composer-image-registry';

export type { ComposerImageDescriptor } from './composer-image-registry';

export interface ComposerDraft {
  images?: ComposerImageDescriptor[];
  text: string;
}

export interface ComposerReplaceTextEffect {
  kind: 'replace_text';
  source: 'fork';
  targetSessionId: string;
  text: string;
}

export type ComposerCommandEffect = ComposerReplaceTextEffect;

interface ComposerActions {
  addImages: (sessionId: string, images: ComposerImageDescriptor[]) => void;
  removeImage: (sessionId: string, index: number) => void;
  setText: (sessionId: string, text: string) => void;
  stagePendingDraft: (sessionId: string, draft: ComposerDraft) => void;
  restorePendingDraft: (sessionId: string) => void;
  discardPendingDraft: (sessionId: string) => void;
  clearDraft: (sessionId: string) => void;
  clearText: (sessionId: string) => void;
  setCommandEffect: (effect: ComposerCommandEffect) => void;
  consumeCommandEffect: () => void;
  reset: () => void;
}

interface ComposerStore {
  imagesBySessionId: Record<string, ComposerImageDescriptor[]>;
  pendingDraftBySessionId: Record<string, ComposerDraft>;
  textBySessionId: Record<string, string>;
  // 协议命令完成后要作用到 composer 的一次性 UI effect；由匹配的 composer 消费后清空
  pendingCommandEffect: ComposerCommandEffect | null;
  actions: ComposerActions;
}

const EMPTY_SESSION_ID = '__empty_session__';
const EMPTY_IMAGES: ComposerImageDescriptor[] = [];
export const HOME_COMPOSER_SESSION_ID = '__task_home__';

const initialState = {
  imagesBySessionId: {} as Record<string, ComposerImageDescriptor[]>,
  pendingDraftBySessionId: {} as Record<string, ComposerDraft>,
  textBySessionId: {} as Record<string, string>,
  pendingCommandEffect: null as ComposerCommandEffect | null,
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
        const removedImages = currentImages.filter((_, imageIndex) => imageIndex === index);
        const nextImages = currentImages.filter((_, imageIndex) => imageIndex !== index);
        if (nextImages.length === currentImages.length) return state;
        releaseComposerImageDescriptors(removedImages);
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
        releaseComposerImageDescriptors(state.pendingDraftBySessionId[key]?.images);
        retainComposerImageDescriptors(draft.images);
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
          releaseComposerImageDescriptors(pendingDraft.images);
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
        const pendingDraft = state.pendingDraftBySessionId[key];
        if (pendingDraft === undefined) return state;
        releaseComposerImageDescriptors(pendingDraft.images);
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
        releaseComposerImageDescriptors(nextImagesBySessionId[key]);
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
    setCommandEffect: (effect) => set({ pendingCommandEffect: effect }),
    consumeCommandEffect: () =>
      set((state) =>
        state.pendingCommandEffect === null ? state : { pendingCommandEffect: null },
      ),
    reset: () =>
      set(() => {
        resetComposerImageRegistry();
        return initialState;
      }),
  },
}));

export const useComposerImages = (sessionId: string) =>
  useComposerStore(
    (state) => state.imagesBySessionId[getComposerSessionId(sessionId)] ?? EMPTY_IMAGES,
  );

export const useComposerText = (sessionId: string) =>
  useComposerStore((state) => state.textBySessionId[getComposerSessionId(sessionId)] ?? '');

export function getComposerDraftSnapshot(sessionId: string): ComposerDraft {
  const key = getComposerSessionId(sessionId);
  const state = useComposerStore.getState();
  return {
    images: state.imagesBySessionId[key],
    text: state.textBySessionId[key] ?? '',
  };
}

export const useComposerActions = () => useComposerStore((state) => state.actions);

export const usePendingComposerCommandEffect = () =>
  useComposerStore((state) => state.pendingCommandEffect);
