// ============================================================
// Conversation Expansion Store — 会话折叠层级状态
// ============================================================

import { create } from 'zustand';

export type ConversationExpansionNodeKind = 'assistant_turn' | 'process' | 'tool_detail';

export interface ConversationExpansionNode {
  id: string;
  kind: ConversationExpansionNodeKind;
  parentId?: string;
}

interface ConversationExpansionActions {
  registerNode: (node: ConversationExpansionNode) => void;
  unregisterNode: (id: string) => void;
  setExpanded: (id: string, open: boolean) => void;
  reset: () => void;
}

interface ConversationExpansionStore {
  expandedById: Record<string, boolean>;
  nodesById: Record<string, ConversationExpansionNode>;
  actions: ConversationExpansionActions;
}

const initialState = {
  expandedById: {} as Record<string, boolean>,
  nodesById: {} as Record<string, ConversationExpansionNode>,
};

const EMPTY_SCOPE = 'empty-session';

export const useConversationExpansionStore = create<ConversationExpansionStore>((set) => ({
  ...initialState,
  actions: {
    registerNode: (node) =>
      set((state) => {
        const existing = state.nodesById[node.id];
        if (existing?.kind === node.kind && existing.parentId === node.parentId) {
          return state;
        }
        return {
          nodesById: {
            ...state.nodesById,
            [node.id]: node,
          },
        };
      }),
    unregisterNode: (id) =>
      set((state) => {
        const idsToRemove = new Set([id, ...collectDescendantIds(state.nodesById, id)]);
        if (!Array.from(idsToRemove).some((itemId) => state.nodesById[itemId])) return state;
        return {
          expandedById: omitIds(state.expandedById, idsToRemove, { keepClosed: true }),
          nodesById: omitIds(state.nodesById, idsToRemove),
        };
      }),
    setExpanded: (id, open) =>
      set((state) => {
        const idsToUpdate = open ? [id] : [id, ...collectDescendantIds(state.nodesById, id)];
        if (idsToUpdate.every((itemId) => state.expandedById[itemId] === open)) {
          return state;
        }
        const expandedById = { ...state.expandedById };
        for (const itemId of idsToUpdate) {
          expandedById[itemId] = open;
        }
        return { expandedById };
      }),
    reset: () => set(initialState),
  },
}));

export const useConversationExpansionOpen = (id: string, defaultOpen: boolean) =>
  useConversationExpansionStore((state) => state.expandedById[id] ?? defaultOpen);

export const useConversationExpansionActions = () =>
  useConversationExpansionStore((state) => state.actions);

export function getConversationExpansionScope({
  sessionFile,
  sessionId,
}: {
  sessionFile?: string;
  sessionId?: string;
}): string {
  return sessionId || sessionFile || EMPTY_SCOPE;
}

export function getAssistantTurnExpansionId(rowKey: string, scope = EMPTY_SCOPE): string {
  return getScopedExpansionId(scope, `assistant-turn:${rowKey}`);
}

export function getProcessExpansionId(entryKey: string, scope = EMPTY_SCOPE): string {
  return getScopedExpansionId(scope, `process:${entryKey}`);
}

export function getToolDetailExpansionId(activityKey: string, scope = EMPTY_SCOPE): string {
  return getScopedExpansionId(scope, `tool-detail:${activityKey}`);
}

function getScopedExpansionId(scope: string, id: string): string {
  return `${scope}::${id}`;
}

function collectDescendantIds(
  nodesById: Record<string, ConversationExpansionNode>,
  parentId: string,
): string[] {
  const descendants: string[] = [];
  const queue = [parentId];
  for (let index = 0; index < queue.length; index += 1) {
    const currentId = queue[index];
    for (const node of Object.values(nodesById)) {
      if (node.parentId !== currentId) continue;
      descendants.push(node.id);
      queue.push(node.id);
    }
  }
  return descendants;
}

function omitIds<T>(
  itemsById: Record<string, T>,
  idsToRemove: Set<string>,
  options: { keepClosed?: boolean } = {},
): Record<string, T> {
  const nextItemsById = { ...itemsById };
  for (const id of idsToRemove) {
    if (options.keepClosed && nextItemsById[id] === false) continue;
    delete nextItemsById[id];
  }
  return nextItemsById;
}
