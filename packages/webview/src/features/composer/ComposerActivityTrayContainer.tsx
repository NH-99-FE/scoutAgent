// ============================================================
// Composer Activity Tray Container — Composer 托盘状态订阅边界
// ============================================================

import { memo, useMemo } from 'react';
import { useActiveChangesReview, useToolPreviewsById } from '@/store/conversation-store';
import { ComposerActivityTray } from './ComposerActivityTray';
import { createComposerChangesReviewSummary } from './composer-changes-review-summary';

// ---------- Component ----------

export const ComposerActivityTrayContainer = memo(function ComposerActivityTrayContainer() {
  const activeChangesReview = useActiveChangesReview();
  const toolPreviewsById = useToolPreviewsById();
  const composerChangesReview = useMemo(
    () => createComposerChangesReviewSummary(activeChangesReview, toolPreviewsById),
    [activeChangesReview, toolPreviewsById],
  );

  return <ComposerActivityTray changesReview={composerChangesReview} />;
});
