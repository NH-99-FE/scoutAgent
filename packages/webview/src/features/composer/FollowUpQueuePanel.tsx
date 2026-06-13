// ============================================================
// FollowUp Queue Panel — 流式跟进队列展示
// ============================================================

import { CornerDownRight, MoreHorizontal, Trash2 } from 'lucide-react';
import { protocolClient } from '@/bridge/protocol-client';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/common/IconButton';
import { useQueueState } from '@/store/conversation-store';

export function FollowUpQueuePanel() {
  const queueState = useQueueState();
  const followUps = queueState.followUps;

  if (followUps.length === 0) return null;

  const promoteFollowUp = (id: string) => {
    if (queueState.paused) {
      protocolClient.promoteFollowUp(id, { resume: true, preserveFollowUpQueue: true });
      return;
    }
    protocolClient.promoteFollowUp(id);
  };

  return (
    <div className="border-border bg-background rounded-t-2xl border border-b-0 px-3 pt-3 pb-2 shadow-sm">
      {queueState.paused ? (
        <div className="text-muted-foreground mb-2 flex min-h-6 items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate">由于你中断了当前响应，队列已暂停</span>
          <Button
            className="text-muted-foreground hover:text-foreground shrink-0"
            size="xs"
            type="button"
            variant="ghost"
            onClick={() => protocolClient.continueSession()}
          >
            继续
          </Button>
        </div>
      ) : null}

      <div className="grid gap-1">
        {followUps.map((item) => (
          <div key={item.id} className="flex min-h-7 items-center gap-2 text-sm">
            <CornerDownRight className="text-muted-foreground/80 size-3.5 shrink-0" />
            <span className="text-foreground/85 min-w-0 flex-1 truncate">{item.text}</span>
            <Button
              className="text-muted-foreground hover:text-foreground shrink-0"
              size="xs"
              type="button"
              variant="ghost"
              onClick={() => promoteFollowUp(item.id)}
            >
              <CornerDownRight className="size-3" />
              引导
            </Button>
            <IconButton label="删除跟进" onClick={() => protocolClient.cancelFollowUp(item.id)}>
              <Trash2 />
            </IconButton>
            <IconButton label="更多操作">
              <MoreHorizontal />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}
