// ============================================================
// Changes Review Surface — Scout Diff 多文件审查面板
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ScoutChangesReviewModel,
  ScoutChangesReviewViewMode,
  ScoutChangesReviewWebviewMessage,
} from '@scout-agent/shared';
import { getVsCodeApi } from '@/bridge/vscode-api';
import { ChangesReviewPanel } from '@/surfaces/changes-review/ChangesReviewPanel';
import type { ChangesReviewActions } from '@/surfaces/changes-review/changes-review-types';

declare global {
  interface Window {
    __SCOUT_CHANGES_REVIEW__?: ScoutChangesReviewModel;
  }
}

const FOLD_EXPAND_STEP = 10;

export function ChangesReviewApp() {
  const model = window.__SCOUT_CHANGES_REVIEW__;
  const [viewMode, setViewMode] = useState<ScoutChangesReviewViewMode>(
    model?.viewMode === 'split' ? 'split' : 'unified',
  );
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(model?.files.map((file) => file.id) ?? []),
  );
  const [foldRevealCounts, setFoldRevealCounts] = useState<Record<string, number>>({});

  const postPanelMessage = useCallback((message: ScoutChangesReviewWebviewMessage) => {
    getVsCodeApi().postMessage(message);
  }, []);

  const scrollToRecord = useCallback(
    (recordId: string) => {
      const file = model?.files.find((candidate) => candidate.recordIds.includes(recordId));
      if (!file) return;
      setExpanded((current) => new Set(current).add(file.id));
      setTimeout(() => document.getElementById(file.id)?.scrollIntoView({ block: 'start' }), 0);
    },
    [model],
  );

  useEffect(() => {
    const recordId = model?.scrollToRecordId;
    if (!recordId) return;
    const file = model?.files.find((candidate) => candidate.recordIds.includes(recordId));
    if (!file) return;
    const timer = window.setTimeout(
      () => document.getElementById(file.id)?.scrollIntoView({ block: 'start' }),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [model]);

  useEffect(() => {
    const handler = (event: MessageEvent<unknown>) => {
      const data = event.data as { type?: unknown; recordId?: unknown } | undefined;
      if (data?.type === 'scroll_to_record' && typeof data.recordId === 'string') {
        scrollToRecord(data.recordId);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [scrollToRecord]);

  const actions = useMemo<ChangesReviewActions>(
    () => ({
      openFile: (path: string) => postPanelMessage({ type: 'changes_review_open_file', path }),
      setViewMode: (mode: ScoutChangesReviewViewMode) => {
        setViewMode(mode);
        postPanelMessage({ type: 'changes_review_set_view_mode', mode });
      },
      toggleFile: (id: string) => {
        setExpanded((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      },
      expandFold: (id: string, total: number) => {
        setFoldRevealCounts((current) => ({
          ...current,
          [id]: Math.min(total, (current[id] ?? 0) + FOLD_EXPAND_STEP),
        }));
      },
    }),
    [postPanelMessage],
  );

  return (
    <ChangesReviewPanel
      actions={actions}
      expandedFileIds={expanded}
      foldRevealCounts={foldRevealCounts}
      model={model}
      viewMode={viewMode}
    />
  );
}
