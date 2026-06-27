// ============================================================
// Tree Types — 会话树视图内部类型
// ============================================================

import type { ScoutSessionTreeNode } from '@scout-agent/shared';

export type FilterMode = 'default' | 'no-tools' | 'user-only' | 'labeled-only';
export type SummaryMode = 'none' | 'summary' | 'custom';

export interface FlatTreeNode {
  node: ScoutSessionTreeNode;
  parentId: string | null;
  searchableText: string;
}

export interface VisibleTreeNode extends FlatTreeNode {
  foldable: boolean;
  graph: TreeGraphState;
  indent: number;
  isLast: boolean;
}

export interface TreeGraphState {
  activeLanes: number[];
  hasVisibleChildren: boolean;
  isBranchPoint: boolean;
  parentIndent: number | null;
}

export interface LabelDraftState {
  nodeId: string;
  value: string;
}

export interface SummaryDraftState {
  nodeId: string;
  mode: SummaryMode;
  customInstructions: string;
}

export const FILTERS: Array<{ label: string; mode: FilterMode }> = [
  { label: '默认', mode: 'default' },
  { label: '无工具', mode: 'no-tools' },
  { label: '用户', mode: 'user-only' },
  { label: '已标记', mode: 'labeled-only' },
];
