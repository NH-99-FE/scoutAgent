// ============================================================
// Rename Session Dialog — 当前会话标题编辑
// ============================================================

import { type ComponentProps, useState } from 'react';
import { protocolClient } from '@/bridge/protocol-client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface RenameSessionDialogProps {
  open: boolean;
  currentTitle: string;
  onOpenChange: (open: boolean) => void;
}

export function RenameSessionDialog({
  open,
  currentTitle,
  onOpenChange,
}: RenameSessionDialogProps) {
  if (!open) return null;
  return <OpenRenameSessionDialog currentTitle={currentTitle} onOpenChange={onOpenChange} />;
}

function OpenRenameSessionDialog({
  currentTitle,
  onOpenChange,
}: Omit<RenameSessionDialogProps, 'open'>) {
  const [draft, setDraft] = useState(currentTitle);
  const [pending, setPending] = useState(false);

  const submitRename: NonNullable<ComponentProps<'form'>['onSubmit']> = (event) => {
    event.preventDefault();
    setPending(true);
    protocolClient.setSessionName(
      draft.trim(),
      (payload) => {
        setPending(false);
        if (payload.success) {
          onOpenChange(false);
        }
      },
      () => {
        setPending(false);
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (pending) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="w-[420px] max-w-[calc(100%-40px)] gap-0 rounded-[16px] p-6 sm:max-w-[420px]">
        <form className="flex flex-col" onSubmit={submitRename}>
          <DialogHeader className="gap-2 pr-8">
            <DialogTitle className="text-[16px] leading-5 font-semibold">重命名对话</DialogTitle>
            <DialogDescription className="text-[13px]">保持简短且易于识别</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            aria-label="对话标题"
            className="scout-subtle-input-focus mt-5 h-9 rounded-[10px] text-[13px]"
            disabled={pending}
            placeholder="添加标题..."
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <DialogFooter className="mx-0 mt-3 mb-0 flex flex-row justify-end gap-3 rounded-none border-0 bg-transparent p-0">
            <Button
              className="h-8 rounded-[10px] px-3 text-[13px]"
              disabled={pending}
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              className="h-8 rounded-[10px] px-3 text-[13px]"
              disabled={pending}
              type="submit"
            >
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
