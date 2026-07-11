// ============================================================
// Composer Store — 按会话隔离输入草稿
// ============================================================

import { create } from 'zustand';
import {
  areComposerDocumentsEqual,
  cloneComposerDocument,
  createComposerTextDocument,
  EMPTY_COMPOSER_DOCUMENT,
  isComposerDocumentEmpty,
  normalizeComposerDocument,
  type ComposerDocument,
} from './composer-document';
import {
  releaseComposerImageDescriptors,
  resetComposerImageRegistry,
  retainComposerImageDescriptors,
  type ComposerImageDescriptor,
} from './composer-image-registry';

export type { ComposerDocument, ComposerReference, ComposerSegment } from './composer-document';
export type { ComposerImageDescriptor } from './composer-image-registry';

export interface ComposerDraft {
  document: ComposerDocument;
  images?: ComposerImageDescriptor[];
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
  setDocument: (sessionId: string, document: ComposerDocument) => void;
  setText: (sessionId: string, text: string) => void;
  stagePendingDraft: (sessionId: string, draft: ComposerDraft) => void;
  restorePendingDraft: (sessionId: string) => void;
  discardPendingDraft: (sessionId: string) => void;
  clearDraft: (sessionId: string) => void;
  setCommandEffect: (effect: ComposerCommandEffect) => void;
  consumeCommandEffect: () => void;
  reset: () => void;
}

interface ComposerStore {
  documentBySessionId: Record<string, ComposerDocument>;
  imagesBySessionId: Record<string, ComposerImageDescriptor[]>;
  pendingDraftBySessionId: Record<string, ComposerDraft>;
  // 协议命令完成后要作用到 composer 的一次性 UI effect；由匹配的 composer 消费后清空
  pendingCommandEffect: ComposerCommandEffect | null;
  actions: ComposerActions;
}

const EMPTY_SESSION_ID = '__empty_session__';
const EMPTY_IMAGES: ComposerImageDescriptor[] = [];
export const HOME_COMPOSER_SESSION_ID = '__task_home__';

const initialState = {
  documentBySessionId: {} as Record<string, ComposerDocument>,
  imagesBySessionId: {} as Record<string, ComposerImageDescriptor[]>,
  pendingDraftBySessionId: {} as Record<string, ComposerDraft>,
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
        if (nextImages.length === 0) delete nextImagesBySessionId[key];
        else nextImagesBySessionId[key] = nextImages;
        return { imagesBySessionId: nextImagesBySessionId };
      }),
    setDocument: (sessionId, document) =>
      set((state) => {
        const key = getComposerSessionId(sessionId);
        const nextDocument = normalizeComposerDocument(document);
        const currentDocument = state.documentBySessionId[key] ?? EMPTY_COMPOSER_DOCUMENT;
        if (areComposerDocumentsEqual(currentDocument, nextDocument)) return state;
        const nextDocuments = { ...state.documentBySessionId };
        if (isComposerDocumentEmpty(nextDocument)) delete nextDocuments[key];
        else nextDocuments[key] = nextDocument;
        return { documentBySessionId: nextDocuments };
      }),
    setText: (sessionId, text) =>
      set((state) => {
        const key = getComposerSessionId(sessionId);
        const nextDocument = createComposerTextDocument(text);
        const currentDocument = state.documentBySessionId[key] ?? EMPTY_COMPOSER_DOCUMENT;
        if (areComposerDocumentsEqual(currentDocument, nextDocument)) return state;
        const nextDocuments = { ...state.documentBySessionId };
        if (isComposerDocumentEmpty(nextDocument)) delete nextDocuments[key];
        else nextDocuments[key] = nextDocument;
        return { documentBySessionId: nextDocuments };
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
              document: cloneComposerDocument(draft.document),
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
        const currentDocument = state.documentBySessionId[key] ?? EMPTY_COMPOSER_DOCUMENT;
        const currentImages = state.imagesBySessionId[key] ?? [];
        if (!isComposerDocumentEmpty(currentDocument) || currentImages.length > 0) {
          releaseComposerImageDescriptors(pendingDraft.images);
          return { pendingDraftBySessionId: nextPendingDrafts };
        }
        const nextDocuments = { ...state.documentBySessionId };
        const nextImagesBySessionId = { ...state.imagesBySessionId };
        if (pendingDraft.images?.length) nextImagesBySessionId[key] = [...pendingDraft.images];
        else delete nextImagesBySessionId[key];
        if (isComposerDocumentEmpty(pendingDraft.document)) delete nextDocuments[key];
        else nextDocuments[key] = cloneComposerDocument(pendingDraft.document);
        return {
          documentBySessionId: nextDocuments,
          imagesBySessionId: nextImagesBySessionId,
          pendingDraftBySessionId: nextPendingDrafts,
        };
      }),
    discardPendingDraft: (sessionId) =>
      set((state) => {
        const key = getComposerSessionId(sessionId);
        const pendingDraft = state.pendingDraftBySessionId[key];
        if (!pendingDraft) return state;
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
          state.documentBySessionId[key] === undefined
        ) {
          return state;
        }
        const nextDocuments = { ...state.documentBySessionId };
        const nextImagesBySessionId = { ...state.imagesBySessionId };
        releaseComposerImageDescriptors(nextImagesBySessionId[key]);
        delete nextDocuments[key];
        delete nextImagesBySessionId[key];
        return {
          documentBySessionId: nextDocuments,
          imagesBySessionId: nextImagesBySessionId,
        };
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

export const useComposerDocument = (sessionId: string) =>
  useComposerStore(
    (state) =>
      state.documentBySessionId[getComposerSessionId(sessionId)] ?? EMPTY_COMPOSER_DOCUMENT,
  );

export function getComposerDraftSnapshot(sessionId: string): ComposerDraft {
  const key = getComposerSessionId(sessionId);
  const state = useComposerStore.getState();
  return {
    document: state.documentBySessionId[key] ?? EMPTY_COMPOSER_DOCUMENT,
    images: state.imagesBySessionId[key],
  };
}

export const useComposerActions = () => useComposerStore((state) => state.actions);

export const usePendingComposerCommandEffect = () =>
  useComposerStore((state) => state.pendingCommandEffect);
