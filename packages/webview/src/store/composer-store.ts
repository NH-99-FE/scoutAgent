// ============================================================
// Composer Store — 按会话隔离输入草稿
// ============================================================

import { create } from 'zustand';
import type { ScoutSessionIdentity } from '@scout-agent/shared';
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

export interface RecoverableComposerDraft extends ComposerDraft {
  id: string;
}

export interface ComposerReplaceTextEffect {
  kind: 'replace_text';
  source: 'fork';
  targetSession: ScoutSessionIdentity;
  text: string;
}

export type ComposerCommandEffect = ComposerReplaceTextEffect;

interface ComposerActions {
  addImages: (sessionId: string, images: ComposerImageDescriptor[]) => void;
  removeImage: (sessionId: string, index: number) => void;
  setDocument: (sessionId: string, document: ComposerDocument) => void;
  setText: (sessionId: string, text: string) => void;
  stagePendingDraft: (sessionId: string, draft: ComposerDraft, requestId?: string) => void;
  restorePendingDraft: (sessionId: string, requestId?: string) => void;
  discardPendingDraft: (sessionId: string, requestId?: string) => void;
  recoverFailedDraft: (sessionId: string, draftId: string) => void;
  discardFailedDraft: (sessionId: string, draftId: string) => void;
  clearDraft: (sessionId: string) => void;
  applyComposerIntent: (sessionId: string, version: string, text: string) => boolean;
  setCommandEffect: (effect: ComposerCommandEffect) => void;
  consumeCommandEffect: () => void;
  reset: () => void;
}

interface ComposerStore {
  documentBySessionId: Record<string, ComposerDocument>;
  imagesBySessionId: Record<string, ComposerImageDescriptor[]>;
  pendingDraftByRequestId: Record<string, ComposerDraft>;
  recoverableDraftsBySessionId: Record<string, RecoverableComposerDraft[]>;
  appliedComposerIntentVersionBySessionId: Record<string, string>;
  // 协议命令完成后要作用到 composer 的一次性 UI effect；由匹配的 composer 消费后清空
  pendingCommandEffect: ComposerCommandEffect | null;
  actions: ComposerActions;
}

const EMPTY_SESSION_ID = '__empty_session__';
const EMPTY_IMAGES: ComposerImageDescriptor[] = [];
const EMPTY_RECOVERABLE_DRAFTS: RecoverableComposerDraft[] = [];
export const HOME_COMPOSER_SESSION_ID = '__task_home__';

export function createComposerDraftKey(sessionId: string, sessionPath: string): string {
  return `${sessionId}\u0000${sessionPath}`;
}

const initialState = {
  documentBySessionId: {} as Record<string, ComposerDocument>,
  imagesBySessionId: {} as Record<string, ComposerImageDescriptor[]>,
  pendingDraftByRequestId: {} as Record<string, ComposerDraft>,
  recoverableDraftsBySessionId: {} as Record<string, RecoverableComposerDraft[]>,
  appliedComposerIntentVersionBySessionId: {} as Record<string, string>,
  pendingCommandEffect: null as ComposerCommandEffect | null,
};

function getComposerSessionId(sessionId: string): string {
  return sessionId || EMPTY_SESSION_ID;
}

function getPendingDraftId(sessionId: string, requestId?: string): string {
  return requestId ?? `session:${sessionId}`;
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
    stagePendingDraft: (sessionId, draft, requestId) =>
      set((state) => {
        const key = getComposerSessionId(sessionId);
        const pendingId = getPendingDraftId(key, requestId);
        releaseComposerImageDescriptors(state.pendingDraftByRequestId[pendingId]?.images);
        retainComposerImageDescriptors(draft.images);
        return {
          pendingDraftByRequestId: {
            ...state.pendingDraftByRequestId,
            [pendingId]: {
              document: cloneComposerDocument(draft.document),
              images: draft.images ? [...draft.images] : undefined,
            },
          },
        };
      }),
    restorePendingDraft: (sessionId, requestId) =>
      set((state) => {
        const key = getComposerSessionId(sessionId);
        const pendingId = getPendingDraftId(key, requestId);
        const pendingDraft = state.pendingDraftByRequestId[pendingId];
        if (!pendingDraft) return state;
        const nextPendingDrafts = { ...state.pendingDraftByRequestId };
        delete nextPendingDrafts[pendingId];
        const currentDocument = state.documentBySessionId[key] ?? EMPTY_COMPOSER_DOCUMENT;
        const currentImages = state.imagesBySessionId[key] ?? [];
        if (!isComposerDocumentEmpty(currentDocument) || currentImages.length > 0) {
          const currentRecoverableDrafts = state.recoverableDraftsBySessionId[key] ?? [];
          const replacedDraft = currentRecoverableDrafts.find((draft) => draft.id === pendingId);
          releaseComposerImageDescriptors(replacedDraft?.images);
          return {
            pendingDraftByRequestId: nextPendingDrafts,
            recoverableDraftsBySessionId: {
              ...state.recoverableDraftsBySessionId,
              [key]: [
                ...currentRecoverableDrafts.filter((draft) => draft.id !== pendingId),
                {
                  id: pendingId,
                  document: pendingDraft.document,
                  images: pendingDraft.images,
                },
              ],
            },
          };
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
          pendingDraftByRequestId: nextPendingDrafts,
        };
      }),
    discardPendingDraft: (sessionId, requestId) =>
      set((state) => {
        const key = getComposerSessionId(sessionId);
        const pendingId = getPendingDraftId(key, requestId);
        const pendingDraft = state.pendingDraftByRequestId[pendingId];
        if (!pendingDraft) return state;
        releaseComposerImageDescriptors(pendingDraft.images);
        const nextPendingDrafts = { ...state.pendingDraftByRequestId };
        delete nextPendingDrafts[pendingId];
        return { pendingDraftByRequestId: nextPendingDrafts };
      }),
    recoverFailedDraft: (sessionId, draftId) =>
      set((state) => {
        const key = getComposerSessionId(sessionId);
        const recoverableDrafts = state.recoverableDraftsBySessionId[key] ?? [];
        const draft = recoverableDrafts.find((candidate) => candidate.id === draftId);
        if (!draft) return state;
        const currentDocument = state.documentBySessionId[key] ?? EMPTY_COMPOSER_DOCUMENT;
        const currentImages = state.imagesBySessionId[key] ?? [];
        if (!isComposerDocumentEmpty(currentDocument) || currentImages.length > 0) return state;

        const nextRecoverableDrafts = recoverableDrafts.filter(
          (candidate) => candidate.id !== draftId,
        );
        const nextRecoverableBySessionId = { ...state.recoverableDraftsBySessionId };
        if (nextRecoverableDrafts.length > 0) {
          nextRecoverableBySessionId[key] = nextRecoverableDrafts;
        } else {
          delete nextRecoverableBySessionId[key];
        }
        const nextDocuments = { ...state.documentBySessionId };
        const nextImagesBySessionId = { ...state.imagesBySessionId };
        if (isComposerDocumentEmpty(draft.document)) delete nextDocuments[key];
        else nextDocuments[key] = cloneComposerDocument(draft.document);
        if (draft.images?.length) nextImagesBySessionId[key] = [...draft.images];
        else delete nextImagesBySessionId[key];
        return {
          documentBySessionId: nextDocuments,
          imagesBySessionId: nextImagesBySessionId,
          recoverableDraftsBySessionId: nextRecoverableBySessionId,
        };
      }),
    discardFailedDraft: (sessionId, draftId) =>
      set((state) => {
        const key = getComposerSessionId(sessionId);
        const recoverableDrafts = state.recoverableDraftsBySessionId[key] ?? [];
        const discardedDraft = recoverableDrafts.find((draft) => draft.id === draftId);
        if (!discardedDraft) return state;
        releaseComposerImageDescriptors(discardedDraft.images);
        const nextRecoverableDrafts = recoverableDrafts.filter((draft) => draft.id !== draftId);
        const nextRecoverableBySessionId = { ...state.recoverableDraftsBySessionId };
        if (nextRecoverableDrafts.length > 0) {
          nextRecoverableBySessionId[key] = nextRecoverableDrafts;
        } else {
          delete nextRecoverableBySessionId[key];
        }
        return { recoverableDraftsBySessionId: nextRecoverableBySessionId };
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
    applyComposerIntent: (sessionId, version, text) => {
      let applied = false;
      set((state) => {
        const key = getComposerSessionId(sessionId);
        if (state.appliedComposerIntentVersionBySessionId[key] === version) return state;
        applied = true;
        const nextDocuments = { ...state.documentBySessionId };
        const nextImagesBySessionId = { ...state.imagesBySessionId };
        releaseComposerImageDescriptors(nextImagesBySessionId[key]);
        delete nextImagesBySessionId[key];
        const nextDocument = createComposerTextDocument(text);
        if (isComposerDocumentEmpty(nextDocument)) delete nextDocuments[key];
        else nextDocuments[key] = nextDocument;
        return {
          documentBySessionId: nextDocuments,
          imagesBySessionId: nextImagesBySessionId,
          appliedComposerIntentVersionBySessionId: {
            ...state.appliedComposerIntentVersionBySessionId,
            [key]: version,
          },
        };
      });
      return applied;
    },
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

export const useRecoverableComposerDrafts = (sessionId: string) =>
  useComposerStore(
    (state) =>
      state.recoverableDraftsBySessionId[getComposerSessionId(sessionId)] ??
      EMPTY_RECOVERABLE_DRAFTS,
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
