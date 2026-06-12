// ============================================================
// Tree Store — 会话树与导航结果
// ============================================================

import { create } from 'zustand';
import type { ScoutSessionTreeNode, ScoutWebviewState } from '@scout-agent/shared';

interface TreeActions {
  setTreeData: (tree: ScoutSessionTreeNode[], leafId: string | null) => void;
  applyState: (state: ScoutWebviewState) => void;
  setEditorText: (editorText: string | undefined) => void;
  reset: () => void;
}

interface TreeStore {
  tree: ScoutSessionTreeNode[];
  leafId: string | null;
  editorText: string;
  actions: TreeActions;
}

const initialState = {
  tree: [] as ScoutSessionTreeNode[],
  leafId: null as string | null,
  editorText: '',
};

function countNodes(nodes: ScoutSessionTreeNode[]): number {
  return nodes.reduce((count, node) => count + 1 + countNodes(node.children), 0);
}

export const useTreeStore = create<TreeStore>((set) => ({
  ...initialState,
  actions: {
    setTreeData: (tree, leafId) => set({ tree, leafId }),
    applyState: (state) => set({ leafId: state.leafId ?? null }),
    setEditorText: (editorText) => set({ editorText: editorText ?? '' }),
    reset: () => set(initialState),
  },
}));

export const useTree = () => useTreeStore((state) => state.tree);
export const useTreeLeafId = () => useTreeStore((state) => state.leafId);
export const useTreeNodeCount = () => useTreeStore((state) => countNodes(state.tree));
export const useTreeEditorText = () => useTreeStore((state) => state.editorText);
export const useTreeActions = () => useTreeStore((state) => state.actions);
