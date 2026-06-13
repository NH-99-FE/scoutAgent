// ============================================================
// Pending Queue Send Dialog — 暂停队列下发送确认
// ============================================================

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PendingQueueSendDialogProps {
  open: boolean;
  queuedCount: number;
  onClose: () => void;
  onClearQueueAndSend: () => void;
  onSend: () => void;
}

export function PendingQueueSendDialog({
  open,
  queuedCount,
  onClose,
  onClearQueueAndSend,
  onSend,
}: PendingQueueSendDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        className="top-auto bottom-4 max-w-[650px] translate-y-0 gap-0 rounded-3xl p-6 sm:max-w-[650px]"
        showCloseButton
      >
        <DialogHeader className="gap-3 pr-8">
          <DialogTitle className="text-2xl leading-8 font-semibold">发送消息？</DialogTitle>
          <DialogDescription className="text-base">
            你即将发送一条消息。要清除之前已排队的 {queuedCount} 条消息吗？
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="-mx-0 mt-5 -mb-0 flex-row justify-end border-0 bg-transparent p-0">
          <Button
            className="bg-destructive/10 text-destructive hover:bg-destructive/15 rounded-full px-6 text-base"
            type="button"
            variant="destructive"
            onClick={onClearQueueAndSend}
          >
            清空队列
          </Button>
          <Button className="rounded-full px-6 text-base" type="button" onClick={onSend}>
            发送消息
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
