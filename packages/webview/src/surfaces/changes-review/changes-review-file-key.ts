// ============================================================
// Changes Review Surface — 文件稳定键
// ============================================================

import type { ScoutChangesReviewFile } from '@scout-agent/shared';

// absolutePath 是跨热更新稳定的文件 identity；file.id 只用于 DOM/scroll anchor。
export function getChangesReviewFileKey(file: ScoutChangesReviewFile): string {
  return file.absolutePath || file.path || file.recordIds[0] || file.id;
}
