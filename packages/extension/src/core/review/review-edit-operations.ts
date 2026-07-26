// ============================================================
// Edit Operations Review 装饰 — 复用 Pi 实际 read/write，不增加文件读取
// ============================================================

import type { EditOperations } from '../tools/edit.ts';
import type { MutationCaptureCoordinatorPort } from './mutation-capture-coordinator.ts';

export function withEditReviewCapture(
  operations: EditOperations,
  capture: MutationCaptureCoordinatorPort,
): EditOperations {
  return {
    access: (absolutePath) => operations.access(absolutePath),
    async readFile(absolutePath): Promise<Buffer> {
      const buffer = await operations.readFile(absolutePath);
      try {
        // 必须把 delegate 返回的同一个 Buffer 交给 capture，再原样返回给 Pi。
        capture.captureBefore(buffer);
      } catch {
        // Capture 仅观察实际 I/O，不能改变 edit 的原始执行结果。
      }
      return buffer;
    },
    async writeFile(absolutePath, content): Promise<void> {
      await operations.writeFile(absolutePath, content);
      try {
        capture.captureAfter(content);
      } catch {
        // after 使用入参引用；capture 故障不改变 delegate 成功语义。
      } finally {
        try {
          capture.markWriteCommitted();
        } catch {
          // delegate 已成功，commit 标记故障也不能反转文件写入结果。
        }
      }
    },
  };
}
