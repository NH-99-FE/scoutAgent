// ============================================================
// Mutation Capture 上下文 — 关联一次真实文件突变的异步作用域与文本快照
// ============================================================

import { MAX_REVIEW_TEXT_BYTES } from '../text-size.ts';
import type { DiffUnavailableReason } from './diff-document.ts';

// ---------- 类型 ----------

export type MutationOperation = 'edit' | 'write';

export interface MutationCaptureScope {
  ownerId: string;
  toolCallId: string;
  operation: MutationOperation;
  path: string;
  absolutePath: string;
  displayPath?: string;
}

export type SnapshotUnavailableReason = Extract<
  DiffUnavailableReason,
  | 'original_unavailable'
  | 'modified_unavailable'
  | 'binary_or_unsupported'
  | 'content_too_large'
  | 'content_released'
>;

export interface CapturedTextSnapshot {
  content: string | null;
  byteLength: number;
  sha256?: string;
  unavailableReason?: SnapshotUnavailableReason;
}

export interface MutationCaptureState {
  scope: MutationCaptureScope;
  /** 在 run 开始时冻结，避免工具执行期间 turn 切换导致串线。 */
  turnId?: string;
  before?: CapturedTextSnapshot;
  after?: CapturedTextSnapshot;
  writeCommitted: boolean;
}

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

// ---------- Snapshot ----------

/**
 * 从实际 readFile Buffer 创建 before 快照。Buffer 本身只被解码，不复制到运行态。
 */
export function captureTextSnapshot(buffer: Buffer): CapturedTextSnapshot {
  const byteLength = buffer.byteLength;
  if (byteLength > MAX_REVIEW_TEXT_BYTES) {
    return {
      content: null,
      byteLength,
      unavailableReason: 'content_too_large',
    };
  }

  try {
    const content = UTF8_DECODER.decode(buffer);
    if (content.includes(String.fromCharCode(0))) {
      return { content: null, byteLength, unavailableReason: 'binary_or_unsupported' };
    }
    return { content, byteLength };
  } catch {
    return { content: null, byteLength, unavailableReason: 'binary_or_unsupported' };
  }
}

/**
 * 从 write/edit 的字符串参数创建 after 快照。字符串内容直接引用入参，不主动复制。
 */
export function captureStringSnapshot(content: string): CapturedTextSnapshot {
  const byteLength = Buffer.byteLength(content, 'utf8');
  if (byteLength > MAX_REVIEW_TEXT_BYTES) {
    return {
      content: null,
      byteLength,
      unavailableReason: 'content_too_large',
    };
  }
  if (content.includes(String.fromCharCode(0))) {
    return { content: null, byteLength, unavailableReason: 'binary_or_unsupported' };
  }
  return { content, byteLength };
}

export function createUnavailableSnapshot(
  reason: Extract<
    SnapshotUnavailableReason,
    'original_unavailable' | 'modified_unavailable' | 'content_released'
  >,
): CapturedTextSnapshot {
  return { content: null, byteLength: 0, unavailableReason: reason };
}
