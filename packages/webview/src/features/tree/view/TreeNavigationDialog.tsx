// ============================================================
// Tree Navigation Dialog — 切换分支前的摘要决策
// ============================================================

import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import type { SummaryMode } from '../model/tree-types';

export function TreeNavigationDialog({
  customInstructions,
  mode,
  open,
  reopensComposer,
  showSummaryOptions,
  onConfirm,
  onCustomInstructionsChange,
  onModeChange,
  onOpenChange,
}: {
  customInstructions: string;
  mode: SummaryMode;
  open: boolean;
  reopensComposer: boolean;
  showSummaryOptions: boolean;
  onConfirm: () => void;
  onCustomInstructionsChange: (value: string) => void;
  onModeChange: (mode: SummaryMode) => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>切换分支</DialogTitle>
          <DialogDescription>
            {showSummaryOptions
              ? '是否总结即将离开的分支？摘要会注入切换后的运行上下文。'
              : '确认回到该节点并继续编辑。'}
          </DialogDescription>
        </DialogHeader>
        {reopensComposer ? (
          <p className="border-warning/40 bg-warning/10 text-foreground rounded-md border px-3 py-2 text-xs leading-5">
            继续后，聊天输入框中的现有草稿（包括图片）将被该节点内容替换。
          </p>
        ) : null}
        {showSummaryOptions ? (
          <>
            <RadioGroup
              className="grid gap-1"
              value={mode}
              onValueChange={(value) => onModeChange(value as SummaryMode)}
            >
              <SummaryOption label="不摘要" value="none" />
              <SummaryOption label="摘要被放弃的分支" value="summary" />
              <SummaryOption label="自定义摘要" value="custom" />
            </RadioGroup>
            {mode === 'custom' ? (
              <Textarea
                className="bg-option-background min-h-20 rounded-md text-xs"
                placeholder="自定义摘要指令"
                value={customInstructions}
                onChange={(event) => onCustomInstructionsChange(event.target.value)}
              />
            ) : null}
          </>
        ) : null}
        <DialogFooter className="bg-popover border-t-0 pt-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            disabled={
              showSummaryOptions && mode === 'custom' && customInstructions.trim().length === 0
            }
            onClick={onConfirm}
          >
            {reopensComposer ? '回到此处编辑' : '继续切换'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryOption({ label, value }: { label: string; value: SummaryMode }) {
  return (
    <RadioGroupItem variant="option" value={value}>
      <span
        aria-hidden="true"
        className="group-data-[state=checked]/radio-group-item:text-primary flex size-3.5 shrink-0 items-center justify-center text-transparent transition-colors"
      >
        <Check className="size-3" />
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </RadioGroupItem>
  );
}
