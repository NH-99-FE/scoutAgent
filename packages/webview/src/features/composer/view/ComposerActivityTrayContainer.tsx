// ============================================================
// Composer Activity Tray Container — Composer 托盘状态订阅边界
// ============================================================

import { memo, useMemo } from 'react';
import { useActiveChangesReview } from '@/store/conversation-store';
import { ComposerActivityTray } from './ComposerActivityTray';
import { createComposerChangesReviewSummary } from '../model/composer-changes-review-summary';

// ---------- Component ----------

export const ComposerActivityTrayContainer = memo(function ComposerActivityTrayContainer() {
  const activeChangesReview = useActiveChangesReview();
  const composerChangesReview = useMemo(
    () => createComposerChangesReviewSummary(activeChangesReview),
    [activeChangesReview],
  );

  return <ComposerActivityTray changesReview={composerChangesReview} />;
});
