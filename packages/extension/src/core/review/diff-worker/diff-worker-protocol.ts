// ============================================================
// Diff Worker protocol — Extension Host 与 Diff Worker 的内部消息契约
// 负责：定义可结构化克隆的请求与 ready/unavailable/error 响应。
// ============================================================

import type { DiffDocument, DiffUnavailableReason } from '../diff-document.ts';

// ---------- 请求 ----------

export interface DiffWorkerRequest {
  requestId: string;
  ownerId: string;
  turnId: string;
  fileId: string;
  revision: number;
  filePath: string;
  originalContent: string | null;
  modifiedContent: string | null;
  unavailableReason?: DiffUnavailableReason;
  maxBytes: number;
  contextLines: number;
}

// ---------- 响应 ----------

export type DiffWorkerResponse =
  | {
      requestId: string;
      fileId: string;
      revision: number;
      status: 'settled';
      document: DiffDocument;
    }
  | {
      requestId: string;
      fileId: string;
      revision: number;
      status: 'error';
      reason: Extract<DiffUnavailableReason, 'generation_failed'>;
      message?: string;
    };
