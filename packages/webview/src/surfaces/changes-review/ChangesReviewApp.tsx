// ============================================================
// Changes Review Surface — Scout Diff 多文件审查面板
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ScoutChangesReviewHostMessage,
  ScoutChangesReviewModel,
  ScoutChangesReviewViewMode,
  ScoutChangesReviewWebviewMessage,
} from '@scout-agent/shared';
import { getVsCodeApi } from '@/bridge/vscode-api';
import { ChangesReviewPanel, getChangesReviewFileKey } from '@/features/changes-review';
import type { ChangesReviewActions } from '@/features/changes-review';

declare global {
  interface Window {
    __SCOUT_CHANGES_REVIEW__?: ScoutChangesReviewModel;
  }
}

const FOLD_EXPAND_STEP = 10;

export function ChangesReviewApp() {
  const initialModel = window.__SCOUT_CHANGES_REVIEW__;
  const [model, setModel] = useState<ScoutChangesReviewModel | undefined>(initialModel);
  const [viewMode, setViewMode] = useState<ScoutChangesReviewViewMode>(
    initialModel?.viewMode === 'split' ? 'split' : 'unified',
  );
  const [expandedFileKeys, setExpandedFileKeys] = useState<Set<string>>(
    () => new Set(initialModel?.files.map((file) => getChangesReviewFileKey(file)) ?? []),
  );
  const [foldRevealCounts, setFoldRevealCounts] = useState<Record<string, number>>({});
  const seenFileKeysRef = useRef<Set<string>>(
    new Set(initialModel?.files.map((file) => getChangesReviewFileKey(file)) ?? []),
  );

  const postPanelMessage = useCallback((message: ScoutChangesReviewWebviewMessage) => {
    getVsCodeApi().postMessage(message);
  }, []);

  const scrollToRecord = useCallback(
    (recordId: string) => {
      const file = model?.files.find((candidate) => candidate.recordIds.includes(recordId));
      if (!file) return;
      setExpandedFileKeys((current) => new Set(current).add(getChangesReviewFileKey(file)));
      setTimeout(() => document.getElementById(file.id)?.scrollIntoView({ block: 'start' }), 0);
    },
    [model],
  );

  const applyModelUpdate = useCallback((nextModel: ScoutChangesReviewModel | undefined) => {
    setModel(nextModel);
    if (!nextModel) {
      seenFileKeysRef.current = new Set();
      setExpandedFileKeys(new Set());
      setFoldRevealCounts({});
      return;
    }

    const previousFileKeys = seenFileKeysRef.current;
    const validFileKeys = new Set(nextModel.files.map((file) => getChangesReviewFileKey(file)));
    if (previousFileKeys.size === 0) {
      setViewMode(nextModel.viewMode === 'split' ? 'split' : 'unified');
    }
    setExpandedFileKeys((current) => {
      const next = new Set<string>();
      for (const key of current) {
        if (validFileKeys.has(key)) next.add(key);
      }
      for (const file of nextModel.files) {
        const fileKey = getChangesReviewFileKey(file);
        if (!previousFileKeys.has(fileKey)) next.add(fileKey);
      }
      return next;
    });
    setFoldRevealCounts((current) => {
      const entries = Object.entries(current).filter(([id]) =>
        nextModel.files.some((file) => id.startsWith(`${getChangesReviewFileKey(file)}:`)),
      );
      return Object.fromEntries(entries);
    });
    seenFileKeysRef.current = validFileKeys;
  }, []);

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
      const data = event.data as Partial<ScoutChangesReviewHostMessage> | undefined;
      if (data?.type === 'changes_review_model_update') {
        applyModelUpdate(data.model);
        return;
      }
      if (data?.type === 'changes_review_scroll_to_record' && typeof data.recordId === 'string') {
        scrollToRecord(data.recordId);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [applyModelUpdate, scrollToRecord]);

  const actions = useMemo<ChangesReviewActions>(
    () => ({
      openFile: (path: string) => postPanelMessage({ type: 'changes_review_open_file', path }),
      setViewMode: (mode: ScoutChangesReviewViewMode) => {
        setViewMode(mode);
        postPanelMessage({ type: 'changes_review_set_view_mode', mode });
      },
      toggleFile: (key: string) => {
        setExpandedFileKeys((current) => {
          const next = new Set(current);
          if (next.has(key)) next.delete(key);
          else next.add(key);
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
      expandedFileKeys={expandedFileKeys}
      foldRevealCounts={foldRevealCounts}
      model={model}
      viewMode={viewMode}
    />
  );
}
