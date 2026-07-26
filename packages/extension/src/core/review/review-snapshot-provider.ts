// ============================================================
// Review Snapshot Provider — 为 write capture 提供显式的 baseline 读取边界
// ============================================================

import { open as fsOpen } from 'node:fs/promises';
import { MAX_REVIEW_TEXT_BYTES } from '../text-size.ts';
import {
  captureTextSnapshot,
  type CapturedTextSnapshot,
  type SnapshotUnavailableReason,
} from './mutation-capture-context.ts';

// ---------- 领域结果 ----------

export type ReviewBaselineResult =
  | { kind: 'captured'; snapshot: CapturedTextSnapshot }
  | { kind: 'missing' }
  | { kind: 'unavailable'; reason: SnapshotUnavailableReason };

export interface ReviewSnapshotProvider {
  /** 返回已分类的 baseline 结果，不向协调器泄漏本地文件系统错误语义。 */
  readBefore(absolutePath: string): Promise<ReviewBaselineResult>;
}

export interface ReviewFileHandle {
  stat(): Promise<{ size: number; isFile(): boolean }>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export interface ReviewSnapshotProviderOptions {
  maxBytes?: number;
  open?: (absolutePath: string, flags: 'r') => Promise<ReviewFileHandle>;
  onError?: (error: unknown) => void;
}

/**
 * 本地 provider 通过 open → fstat → 有界 read 捕获 baseline。
 * write decorator 没有 provider 时绝不调用此实现，避免远程 Operations
 * 因 review 意外读取本地同名路径。
 */
export function createLocalReviewSnapshotProvider(
  options: ReviewSnapshotProviderOptions = {},
): ReviewSnapshotProvider {
  const maxBytes = options.maxBytes ?? MAX_REVIEW_TEXT_BYTES;
  const open = options.open ?? ((absolutePath: string, flags: 'r') => fsOpen(absolutePath, flags));

  return {
    async readBefore(absolutePath: string): Promise<ReviewBaselineResult> {
      let handle: ReviewFileHandle | undefined;
      try {
        handle = await open(absolutePath, 'r');
        const stats = await handle.stat();
        if (!stats.isFile()) {
          return { kind: 'unavailable', reason: 'original_unavailable' };
        }
        if (stats.size > maxBytes) {
          return { kind: 'unavailable', reason: 'content_too_large' };
        }

        const limit = maxBytes + 1;
        const buffer = Buffer.allocUnsafe(limit);
        let bytesRead = 0;
        while (bytesRead < limit) {
          const result = await handle.read(buffer, bytesRead, limit - bytesRead, bytesRead);
          if (result.bytesRead === 0) break;
          bytesRead += result.bytesRead;
        }

        if (bytesRead > maxBytes) {
          return { kind: 'unavailable', reason: 'content_too_large' };
        }
        return {
          kind: 'captured',
          snapshot: captureTextSnapshot(buffer.subarray(0, bytesRead)),
        };
      } catch (error) {
        if (isErrnoCode(error, 'ENOENT')) return { kind: 'missing' };
        reportProviderError(
          options.onError,
          new Error(`读取 review baseline 失败: ${absolutePath}`, { cause: error }),
        );
        return { kind: 'unavailable', reason: 'original_unavailable' };
      } finally {
        if (handle) {
          try {
            await handle.close();
          } catch (error) {
            reportProviderError(
              options.onError,
              new Error(`关闭 review baseline 句柄失败: ${absolutePath}`, { cause: error }),
            );
          }
        }
      }
    },
  };
}

export function isErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function reportProviderError(
  onError: ReviewSnapshotProviderOptions['onError'],
  error: unknown,
): void {
  try {
    onError?.(error);
  } catch {
    // 诊断回调属于观察路径，不得影响 write。
  }
}
