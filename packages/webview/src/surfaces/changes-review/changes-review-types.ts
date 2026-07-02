// ============================================================
// Changes Review Surface — 局部类型
// ============================================================

import type { ScoutChangesReviewViewMode } from '@scout-agent/shared';

export interface ChangesReviewActions {
  openFile: (path: string) => void;
  setViewMode: (mode: ScoutChangesReviewViewMode) => void;
  toggleFile: (id: string) => void;
  expandFold: (id: string, total: number) => void;
}
