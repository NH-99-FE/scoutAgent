// ============================================================
// Diff Worker runtime — 无线程依赖的 canonical diff 计算入口
// 负责：校验请求预算、生成 DiffDocument，并投影为 Worker 响应。
// ============================================================

import { getUtf8ByteLength } from '../../text-size.ts';
import {
  createDiffDocument,
  createUnavailableDiffDocument,
  type DiffUnavailableReason,
} from '../diff-document.ts';
import type { DiffWorkerRequest, DiffWorkerResponse } from './diff-worker-protocol.ts';

// ---------- Runtime ----------

export function runDiffWorkerRequest(request: DiffWorkerRequest): DiffWorkerResponse {
  try {
    validateRequest(request);

    const unavailableReason = resolveUnavailableReason(request);
    const document = createDiffDocument(request.originalContent, request.modifiedContent, {
      contextLines: request.contextLines,
      unavailableReason,
    });

    return {
      requestId: request.requestId,
      fileId: request.fileId,
      revision: request.revision,
      status: 'settled',
      document,
    };
  } catch {
    return {
      requestId: request.requestId,
      fileId: request.fileId,
      revision: request.revision,
      status: 'settled',
      document: createUnavailableDiffDocument('generation_failed'),
    };
  }
}

// ---------- 校验 ----------

function validateRequest(request: DiffWorkerRequest): void {
  if (!Number.isSafeInteger(request.revision) || request.revision < 1) {
    throw new Error(`revision 非法: ${request.revision}`);
  }
  if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 0) {
    throw new Error(`maxBytes 非法: ${request.maxBytes}`);
  }
  if (!Number.isSafeInteger(request.contextLines) || request.contextLines < 0) {
    throw new Error(`contextLines 非法: ${request.contextLines}`);
  }
}

function resolveUnavailableReason(request: DiffWorkerRequest): DiffUnavailableReason | undefined {
  if (request.unavailableReason) return request.unavailableReason;
  if (
    getUtf8ByteLength(request.originalContent) > request.maxBytes ||
    getUtf8ByteLength(request.modifiedContent) > request.maxBytes
  ) {
    return 'content_too_large';
  }
  return undefined;
}
