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
  /** UI-only DOM/scroll anchor，不能作为文件业务 identity；跨热更新状态请使用 absolutePath。 */
  id: string;
  /** review 业务 path，用于 host 打开/定位文件；展示优先使用 displayPath。 */
  path: string;
  /** UI-only 展示路径，由 host 根据 cwd/path 规则生成。 */
  displayPath?: string;
  /** 跨热更新稳定的文件业务 identity，webview 状态应优先用它做 key。 */
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

export interface ScoutChangesReviewSummaryFile {
  /** review summary 的业务 path，用于标识文件；展示优先使用 displayPath。 */
  path: string;
  /** UI-only 展示路径，由 host 根据 cwd/path 规则生成。 */
  displayPath?: string;
  additions: number;
  deletions: number;
}

export interface ScoutChangesReviewSummary {
  /** 同一套摘要契约同时用于 composer active review 与 assistant settled review 卡片。 */
  turnId: string;
  fileCount: number;
  additions: number;
  deletions: number;
  files: ScoutChangesReviewSummaryFile[];
}

export type ScoutChangesReviewWebviewMessage =
  | { type: 'changes_review_set_view_mode'; mode: ScoutChangesReviewViewMode }
  | { type: 'changes_review_open_file'; path: string };

export type ScoutChangesReviewHostMessage =
  | { type: 'changes_review_model_update'; model?: ScoutChangesReviewModel }
  | { type: 'changes_review_scroll_to_record'; recordId: string };
