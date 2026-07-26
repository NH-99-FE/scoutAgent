// ============================================================
// File review contracts — Journal 到 host 的稳定审查投影
// 负责：声明 runtime review snapshot 与 projection 更新契约。
// ============================================================

import type { DiffDocument, DiffUnavailableReason } from './diff-document.ts';

// ---------- 类型 ----------

export type FileReviewOperation = 'edit' | 'write';
export type FileReviewProjectionStatus = 'pending' | 'ready' | 'unavailable';
export type FileReviewUnavailableReason = DiffUnavailableReason;

export interface FileReviewRecord {
  recordId: string;
  turnId: string;
  toolCallId: string;
  operation: FileReviewOperation;
  path: string;
  absolutePath: string;
  displayPath?: string;
  sequence: number;
  toolOutcome?: 'success' | 'error_after_write';
  unavailableReason?: FileReviewUnavailableReason;
}

export interface FileReviewFile {
  absolutePath: string;
  path: string;
  displayPath?: string;
  originalContent: string | null;
  modifiedContent: string | null;
  document?: DiffDocument;
  fileId?: string;
  revision?: number;
  projectionStatus?: FileReviewProjectionStatus;
  projectionError?: string;
  recordIds: string[];
  latestRecordId: string;
  latestSequence: number;
  additions: number;
  deletions: number;
  firstChangedLine?: number;
  unavailableReason?: FileReviewUnavailableReason;
}

export interface FileReviewTurnSnapshot {
  turnId: string;
  files: FileReviewFile[];
  records: FileReviewRecord[];
  contentReleased?: boolean;
}

export interface FileReviewProjectionUpdate {
  ownerId: string;
  turnId: string;
  fileId: string;
  revision: number;
  status: Exclude<FileReviewProjectionStatus, 'pending'>;
}

export type FileReviewProjectionListener = (update: FileReviewProjectionUpdate) => void;
