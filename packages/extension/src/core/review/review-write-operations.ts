// ============================================================
// Write Operations Review 装饰 — 在 mkdir 边界读取 baseline，在 write 成功时提交
// ============================================================

import type { WriteOperations } from '../tools/write.ts';
import type { MutationCaptureCoordinatorPort } from './mutation-capture-coordinator.ts';
import type { ReviewSnapshotProvider } from './review-snapshot-provider.ts';

export function withWriteReviewCapture(
  operations: WriteOperations,
  capture: MutationCaptureCoordinatorPort,
  snapshotProvider?: ReviewSnapshotProvider,
): WriteOperations {
  return {
    ...operations,
    async mkdir(dir): Promise<void> {
      try {
        if (snapshotProvider) {
          await capture.captureBeforeFrom(() =>
            snapshotProvider.readBefore(capture.getCurrentAbsolutePath?.() ?? ''),
          );
        } else {
          // 无 provider 明确表示不可读取；绝不回退到本地 fs。
          capture.captureUnavailableBefore();
        }
      } catch {
        // Snapshot capture 失败不能改变 Pi mkdir/write 的原始执行。
      }
      await operations.mkdir(dir);
    },
    async writeFile(absolutePath, content): Promise<void> {
      await operations.writeFile(absolutePath, content);
      try {
        capture.captureAfter(content);
      } catch {
        // after 直接来自 write 入参，不做额外读取。
      } finally {
        try {
          capture.markWriteCommitted();
        } catch {
          // delegate 已成功，commit 标记故障也不能反转写入事实。
        }
      }
    },
  };
}
