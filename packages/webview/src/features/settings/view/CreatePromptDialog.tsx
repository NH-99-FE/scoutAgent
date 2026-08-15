import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export function CreatePromptDialog({
  open,
  name,
  disabled,
  onOpenChange,
  onNameChange,
  onCreate,
}: {
  open: boolean;
  name: string;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onNameChange: (name: string) => void;
  onCreate: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建 Prompt</DialogTitle>
          <DialogDescription>在全局 Prompts 目录创建 Markdown 模板。</DialogDescription>
        </DialogHeader>
        <label className="grid gap-1.5 text-xs font-medium">
          名称
          <Input
            aria-label="新 Prompt 名称"
            autoFocus
            disabled={disabled}
            placeholder="例如 review"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onCreate();
            }}
          />
        </label>
        <DialogFooter className="mx-0 mb-0 rounded-none border-0 bg-transparent p-0">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              取消
            </Button>
          </DialogClose>
          <Button type="button" disabled={disabled || !name.trim()} onClick={onCreate}>
            创建并打开
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
