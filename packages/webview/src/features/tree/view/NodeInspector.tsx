// ============================================================
// Node Inspector — 会话树节点详情面板
// ============================================================

import { LoaderCircle, MessageCircleCheck } from 'lucide-react';
import type { ScoutSessionTreeNode } from '@scout-agent/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TreeNodeIcon } from './TreeNodeIcon';
import { formatNodeKind, formatNodeLine } from '../model/tree-node-format';

export function NodeInspector({
  navigationPending,
  navigationActionDisabled = false,
  interactionLocked,
  isCurrentNode,
  labelSaved,
  labelDraft,
  node,
  onAbortNavigation,
  onOpenSummaryOptions,
  onLabelDraftChange,
  onNavigate,
  onSaveLabel,
}: {
  navigationPending: { summarize: boolean; cancellable: boolean; aborting: boolean } | null;
  navigationActionDisabled?: boolean;
  interactionLocked: boolean;
  isCurrentNode: boolean;
  labelSaved: boolean;
  labelDraft: string;
  node: ScoutSessionTreeNode | undefined;
  onAbortNavigation: () => void;
  onOpenSummaryOptions: () => void;
  onLabelDraftChange: (value: string) => void;
  onNavigate: () => void;
  onSaveLabel: () => void;
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
                disabled={interactionLocked}
                onChange={(event) => onLabelDraftChange(event.target.value)}
              />
              <Button
                className="h-7 px-2 text-xs"
                size="sm"
                type="button"
                variant="outline"
                disabled={interactionLocked}
                onClick={onSaveLabel}
              >
                保存
              </Button>
            </div>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-muted-foreground text-[11px] leading-none font-medium">预览</h3>
            <p className="border-border bg-option-background min-h-12 rounded-md border px-2.5 py-2 text-xs leading-5 whitespace-pre-wrap">
              {node.preview || formatNodeLine(node)}
            </p>
          </section>
        </div>
      </ScrollArea>

      <div className="p-3 pt-2">
        <div className="flex min-h-8 gap-1.5">
          <Button
            className="h-8 min-w-0 flex-1 text-xs"
            size="sm"
            type="button"
            title="右键可选择摘要方式"
            disabled={navigationActionDisabled || isCurrentNode}
            onClick={onNavigate}
            onContextMenu={(event) => {
              event.preventDefault();
              onOpenSummaryOptions();
            }}
          >
            {navigationPending ? (
              <>
                <LoaderCircle className="animate-spin" />
                正在切换…
              </>
            ) : isCurrentNode ? (
              '当前节点'
            ) : node.kind === 'user' || node.kind === 'custom' ? (
              '回到此处编辑'
            ) : (
              '切换到此节点'
            )}
          </Button>
          {navigationPending?.cancellable ? (
            <Button
              className="h-8 text-xs"
              size="sm"
              type="button"
              variant="outline"
              disabled={navigationPending.aborting}
              onClick={onAbortNavigation}
            >
              {navigationPending.aborting
                ? '正在停止…'
                : navigationPending.summarize
                  ? '停止摘要'
                  : '停止切换'}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
