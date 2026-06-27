// ============================================================
// Node Inspector — 会话树节点详情面板
// ============================================================

import { Check, MessageCircleCheck } from 'lucide-react';
import type { ScoutSessionTreeNode } from '@scout-agent/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { TreeNodeIcon } from './TreeNodeIcon';
import { formatNodeKind, formatNodeLine } from './tree-node-format';
import type { SummaryMode } from './tree-types';

export function NodeInspector({
  customInstructions,
  labelSaved,
  labelDraft,
  node,
  summaryMode,
  onCustomInstructionsChange,
  onLabelDraftChange,
  onNavigate,
  onSaveLabel,
  onSummaryModeChange,
}: {
  customInstructions: string;
  labelSaved: boolean;
  labelDraft: string;
  node: ScoutSessionTreeNode | undefined;
  summaryMode: SummaryMode;
  onCustomInstructionsChange: (value: string) => void;
  onLabelDraftChange: (value: string) => void;
  onNavigate: () => void;
  onSaveLabel: () => void;
  onSummaryModeChange: (value: SummaryMode) => void;
}) {
  if (!node) {
    return (
      <div className="border-border bg-card text-muted-foreground flex h-full items-center justify-center rounded-md border p-6 text-sm shadow-sm">
        选择一个会话树节点
      </div>
    );
  }

  return (
    <div className="border-border bg-card flex h-full min-h-0 flex-col overflow-hidden rounded-md border shadow-sm">
      <div className="px-3 pt-3 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="bg-card flex size-7 shrink-0 items-center justify-center rounded-md">
            <TreeNodeIcon className="text-muted-foreground size-4" node={node} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm leading-5 font-medium">{formatNodeKind(node)}</h2>
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 px-3 py-2">
          <section className="space-y-1.5">
            <div className="flex h-3.5 items-center gap-1.5">
              <label
                className="text-muted-foreground text-[11px] leading-none font-medium"
                htmlFor="tree-label"
              >
                标签
              </label>
              {labelSaved ? <MessageCircleCheck className="text-muted-foreground size-3" /> : null}
            </div>
            <div className="flex gap-2">
              <Input
                id="tree-label"
                className="bg-background/70 h-7 rounded-md text-xs"
                placeholder="添加标签"
                value={labelDraft}
                onChange={(event) => onLabelDraftChange(event.target.value)}
              />
              <Button
                className="h-7 px-2 text-xs"
                size="sm"
                type="button"
                variant="outline"
                onClick={onSaveLabel}
              >
                保存
              </Button>
            </div>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-muted-foreground text-[11px] leading-none font-medium">预览</h3>
            <p className="border-border bg-background/70 dark:bg-input/30 min-h-12 rounded-md border px-2.5 py-2 text-xs leading-5 whitespace-pre-wrap">
              {node.preview || formatNodeLine(node)}
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-muted-foreground text-[11px] leading-none font-medium">摘要</h3>
            <RadioGroup
              className="grid gap-1"
              value={summaryMode}
              onValueChange={(value) => onSummaryModeChange(value as SummaryMode)}
            >
              <SummaryOption label="不摘要" value="none" />
              <SummaryOption label="摘要被放弃的分支" value="summary" />
              <SummaryOption label="自定义摘要" value="custom" />
            </RadioGroup>
            {summaryMode === 'custom' ? (
              <Textarea
                className="bg-background/70 dark:bg-input/30 mt-1 min-h-20 rounded-md text-xs"
                placeholder="自定义摘要指令"
                value={customInstructions}
                onChange={(event) => onCustomInstructionsChange(event.target.value)}
              />
            ) : null}
          </section>
        </div>
      </ScrollArea>

      <div className="p-3 pt-2">
        <div className="flex min-h-8 flex-col justify-center">
          <Button className="h-8 w-full text-xs" size="sm" type="button" onClick={onNavigate}>
            切换到此节点
          </Button>
        </div>
      </div>
    </div>
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
