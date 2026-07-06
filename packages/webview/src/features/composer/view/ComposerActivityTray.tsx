// ============================================================
// Composer Activity Tray — Composer 上方运行态托盘
// ============================================================

import { CornerDownRight, FileDiff, ListIndentIncrease, Trash2 } from 'lucide-react';
import { protocolClient } from '@/bridge/protocol-client';
import { IconButton } from '@/components/common/IconButton';
import { Button } from '@/components/ui/button';
import { useQueueState } from '@/store/conversation-store';
import { cn } from '@/lib/utils';
import type { ComposerChangesReviewSummary } from '../model/composer-changes-review-summary';

interface ComposerActivityTrayProps {
  changesReview?: ComposerChangesReviewSummary;
}

// ---------- Component ----------

export function ComposerActivityTray({ changesReview }: ComposerActivityTrayProps) {
  const queueState = useQueueState();
  const followUps = queueState.followUps;

  if (!changesReview && followUps.length === 0) return null;

  const promoteFollowUp = (id: string) => {
    if (queueState.paused) {
      protocolClient.promoteFollowUp(id, { resume: true, preserveFollowUpQueue: true });
      return;
    }
    protocolClient.promoteFollowUp(id);
  };

  return (
    <div className="border-border bg-background mx-4 rounded-t-2xl rounded-b-none border border-b-0 px-3 py-1.5">
      {changesReview ? <ComposerChangesReviewRow review={changesReview} /> : null}

      {queueState.paused ? (
        <div
          className={cn(
            'text-muted-foreground flex min-h-7 items-center justify-between gap-3 text-sm',
            changesReview && 'border-border/70 mt-1 border-t pt-1',
          )}
        >
          <span className="min-w-0 truncate">由于你中断了当前响应，队列已暂停</span>
          <Button
            className="text-muted-foreground hover:text-foreground h-6 shrink-0 px-1.5"
            size="xs"
            type="button"
            variant="ghost"
            onClick={() => protocolClient.continueSession()}
          >
            继续
          </Button>
        </div>
      ) : null}

      {followUps.length > 0 ? (
        <div
          className={cn(
            'grid gap-0.5',
            (changesReview || queueState.paused) && 'border-border/70 mt-1 border-t pt-1',
          )}
          data-composer-follow-up-queue="true"
        >
          {followUps.map((item) => (
            <div key={item.id} className="flex h-7 items-center gap-2 text-sm">
              <ListIndentIncrease className="text-muted-foreground/55 size-3.5 shrink-0" />
              <span className="text-muted-foreground min-w-0 flex-1 truncate">{item.text}</span>
              <Button
                className="text-muted-foreground hover:text-foreground h-6 shrink-0 gap-1 px-1.5"
                size="xs"
                type="button"
                variant="ghost"
                onClick={() => promoteFollowUp(item.id)}
              >
                <CornerDownRight className="size-3" />
                引导
              </Button>
              <IconButton
                label="删除跟进"
                size="icon-xs"
                onClick={() => protocolClient.cancelFollowUp(item.id)}
              >
                <Trash2 />
              </IconButton>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ComposerChangesReviewRow({ review }: { review: ComposerChangesReviewSummary }) {
  return (
    <div
      className="flex h-7 min-w-0 items-center gap-1.5 text-sm"
      data-composer-changes-review-summary="true"
    >
      <FileDiff className="text-muted-foreground/55 size-3.5 shrink-0" strokeWidth={2} />
      <span className="text-muted-foreground min-w-0 truncate">
        {review.fileCount} 个文件已更改
      </span>
      <span className="shrink-0 font-mono text-[var(--chart-2)]">+{review.additions}</span>
      <span className="shrink-0 font-mono text-[var(--chart-5)]">-{review.deletions}</span>
      <Button
        className="text-foreground hover:text-foreground ml-auto h-6 shrink-0 px-1.5"
        size="xs"
        type="button"
        variant="ghost"
        onClick={() => protocolClient.openCurrentChangesReview()}
      >
        审查
      </Button>
    </div>
  );
}
