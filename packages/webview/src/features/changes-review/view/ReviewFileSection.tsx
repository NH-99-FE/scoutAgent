// ============================================================
// Changes Review Feature — 文件区块
// ============================================================

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { ScoutChangesReviewFile, ScoutChangesReviewViewMode } from '@scout-agent/shared';
import { useFileDiff } from '../model/use-file-diff';
import { ReviewDiff } from './ReviewDiff';
import { ReviewPath } from './ReviewPath';

export function ReviewFileSection({
  expanded,
  file,
  fileKey,
  foldRevealCounts,
  onExpandFold,
  onOpenFile,
  onToggleFile,
  turnId,
  viewMode,
}: {
  expanded: boolean;
  file: ScoutChangesReviewFile;
  fileKey: string;
  foldRevealCounts: Record<string, number>;
  onExpandFold: (id: string, total: number) => void;
  onOpenFile: (path: string) => void;
  onToggleFile: (key: string) => void;
  turnId: string;
  viewMode: ScoutChangesReviewViewMode;
}) {
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;
  const displayPath = file.displayPath ?? file.path;

  return (
    <article
      className="overflow-visible bg-transparent [&+&]:mt-2"
      data-record-ids={file.recordIds.join(' ')}
      id={file.id}
    >
      <header className="bg-tree-background sticky top-10 z-20 w-full">
        <div className="group/file-row hover:bg-control-hover focus-within:bg-control-hover grid min-h-9 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2.5 rounded-md px-2 py-1 transition-colors sm:px-[22px]">
          <button
            className="flex min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden border-0 bg-transparent p-0 text-left font-[inherit] text-inherit focus-visible:outline-none"
            onClick={() => onToggleFile(fileKey)}
            onDoubleClick={() => onOpenFile(file.absolutePath)}
            title={displayPath}
            type="button"
          >
            <ReviewPath path={displayPath} />
            {file.external ? (
              <span className="border-border bg-muted text-muted-foreground rounded-[3px] border px-[5px] py-px text-[11px]">
                External
              </span>
            ) : null}
          </button>
          <span className="inline-flex items-center gap-[5px] text-sm font-normal">
            <span className="text-diff-added">+{file.additions}</span>
            <span className="text-diff-removed">-{file.deletions}</span>
          </span>
          <button
            aria-label="Toggle file diff"
            className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-[22px] cursor-pointer place-items-center rounded-md border-0 bg-transparent text-center font-[inherit]"
            onClick={() => onToggleFile(fileKey)}
            type="button"
          >
            <ChevronIcon className="size-4" />
          </button>
        </div>
      </header>
      {expanded ? (
        <LazyReviewDiff
          file={file}
          fileKey={fileKey}
          foldRevealCounts={foldRevealCounts}
          onExpandFold={onExpandFold}
          turnId={turnId}
          viewMode={viewMode}
        />
      ) : null}
    </article>
  );
}

function LazyReviewDiff({
  file,
  fileKey,
  foldRevealCounts,
  onExpandFold,
  turnId,
  viewMode,
}: {
  file: ScoutChangesReviewFile;
  fileKey: string;
  foldRevealCounts: Record<string, number>;
  onExpandFold: (id: string, total: number) => void;
  turnId: string;
  viewMode: ScoutChangesReviewViewMode;
}) {
  const [hunkLimit, setHunkLimit] = useState(50);
  const canRequest =
    Boolean(file.sessionId && file.fileId && file.revision) &&
    file.projectionStatus !== 'unavailable';
  const state = useFileDiff({
    enabled: canRequest,
    sessionId: file.sessionId ?? '',
    turnId,
    fileId: file.fileId ?? '',
    revision: file.revision ?? 0,
    view: 'panel',
    mode: viewMode,
    includeTokens: true,
    range: { hunkOffset: 0, hunkLimit },
  });

  if (file.unavailableReason || file.projectionStatus === 'unavailable') {
    return (
      <ReviewStatus
        message={formatUnavailableReason(file.unavailableReason ?? 'generation_failed')}
      />
    );
  }
  if (!canRequest) {
    return <ReviewStatus message="Changes are no longer available" />;
  }
  if (state.status === 'idle' || state.status === 'loading' || state.status === 'pending') {
    return (
      <ReviewStatus
        message={state.status === 'pending' ? '正在生成文件变更' : '正在加载文件变更'}
      />
    );
  }
  if (state.status === 'error' || state.status === 'unavailable') {
    return <ReviewStatus message={formatUnavailableReason(state.message ?? 'generation_failed')} />;
  }
  if (state.status !== 'ready') return null;

  const projectedFile: ScoutChangesReviewFile = {
    ...file,
    additions: state.diff.additions,
    deletions: state.diff.deletions,
    rows: state.diff.rows,
  };
  const canLoadMore = Boolean(state.diff.truncated) && hunkLimit < 200;
  return (
    <>
      <ReviewDiff
        file={projectedFile}
        fileKey={fileKey}
        foldRevealCounts={foldRevealCounts}
        onExpandFold={onExpandFold}
        viewMode={viewMode}
      />
      {canLoadMore ? (
        <div className="px-[22px] py-2">
          <button
            className="border-border bg-control hover:bg-control-hover cursor-pointer rounded border px-2 py-1"
            onClick={() => setHunkLimit((value) => Math.min(200, value + 50))}
            type="button"
          >
            加载更多变更
          </button>
        </div>
      ) : null}
      {state.diff.truncated && !canLoadMore ? (
        <ReviewStatus message="变更过长，仅显示前 200 个 hunk" />
      ) : null}
    </>
  );
}

const UNAVAILABLE_REASON_LABELS: Record<string, string> = {
  original_unavailable: '无法读取修改前内容',
  modified_unavailable: '无法读取修改后内容',
  binary_or_unsupported: '二进制文件或不支持的编码',
  content_too_large: '文件内容过大，无法审查',
  diff_too_large: '文件变更过大，无法展示',
  generation_failed: '文件变更生成失败',
  content_released: '文件变更内容已释放',
};

function formatUnavailableReason(reason: string): string {
  return UNAVAILABLE_REASON_LABELS[reason] ?? reason;
}

function ReviewStatus({ message }: { message: string }) {
  return (
    <div className="border-l-status-warning text-muted-foreground bg-status-warning-muted mx-2 mt-2 mb-2.5 border-l-[3px] px-2.5 py-2">
      {message}
    </div>
  );
}
