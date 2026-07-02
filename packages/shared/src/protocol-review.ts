// ============================================================
// Changes review 协议契约：Extension host → Webview 的审查面板快照
// ============================================================

export type ScoutChangesReviewViewMode = 'unified' | 'split';

export type ScoutChangesReviewTokenDiff = 'added' | 'removed';

export interface ScoutChangesReviewToken {
  text: string;
  syntaxScopes?: string[];
  diff?: ScoutChangesReviewTokenDiff;
}

export interface ScoutChangesReviewRow {
  type: 'context' | 'added' | 'removed' | 'fold';
  oldLineNumber?: number;
  newLineNumber?: number;
  oldStartLine?: number;
  newStartLine?: number;
  text?: string;
  tokens?: ScoutChangesReviewToken[];
  count?: number;
  hiddenRows?: ScoutChangesReviewRow[];
}

export interface ScoutChangesReviewFile {
  id: string;
  path: string;
  absolutePath: string;
  external: boolean;
  additions: number;
  deletions: number;
  recordIds: string[];
  unavailableReason?: string;
  statusNote?: string;
  rows: ScoutChangesReviewRow[];
}

export interface ScoutChangesReviewModel {
  turnId: string;
  viewMode: ScoutChangesReviewViewMode;
  scrollToRecordId?: string;
  files: ScoutChangesReviewFile[];
  totals: {
    additions: number;
    deletions: number;
    fileCount: number;
  };
}

export type ScoutChangesReviewWebviewMessage =
  | { type: 'changes_review_set_view_mode'; mode: ScoutChangesReviewViewMode }
  | { type: 'changes_review_open_file'; path: string };
