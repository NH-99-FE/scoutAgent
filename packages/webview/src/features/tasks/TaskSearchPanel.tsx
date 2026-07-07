// ============================================================
// Task Search Panel — 任务历史搜索面板
// ============================================================

import { LoaderCircle, Search, Split } from 'lucide-react';
import type { ScoutTaskItem } from '@scout-agent/shared';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useVisualBusyState, useVisualIsStreaming } from '@/store/runtime-overlay-store';
import { useSessionFile } from '@/store/session-store';
import { cn } from '@/lib/utils';

interface TaskSearchPanelProps {
  tasks: ScoutTaskItem[];
  query: string;
  pending: boolean;
  className?: string;
  loadingMore?: boolean;
  hasMore?: boolean;
  showCurrentState?: boolean;
  loadMoreRef?: (node: HTMLDivElement | null) => void;
  onQueryChange: (query: string) => void;
  onOpenTask: (task: ScoutTaskItem) => void;
}

export function TaskSearchPanel({
  tasks,
  query,
  pending,
  className,
  loadingMore = false,
  hasMore = false,
  showCurrentState = false,
  loadMoreRef,
  onQueryChange,
  onOpenTask,
}: TaskSearchPanelProps) {
  return (
    <section
      className={cn(
        'border-border/70 bg-background flex max-h-[min(260px,calc(100vh-120px))] min-h-0 flex-col overflow-hidden rounded-xl border',
        className,
      )}
      aria-label="任务历史"
    >
      <div className="task-search-field flex h-8 shrink-0 items-center gap-2 px-3">
        <Search className="text-muted-foreground pointer-events-none size-3 shrink-0" />
        <Input
          aria-label="搜索历史任务"
          className="h-7 flex-1 rounded-none border-0 bg-transparent px-0 py-0 text-xs shadow-none"
          placeholder="搜索历史任务"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>

      <div className="px-3">
        <Separator />
      </div>

      <ScrollArea
        className="max-h-[min(220px,calc(100vh-160px))] min-h-0"
        viewportClassName="max-h-[min(220px,calc(100vh-160px))]"
      >
        <div className="px-3 py-1.5">
          {tasks.length > 0 ? (
            <div className="space-y-px">
              {tasks.map((task) => (
                <TaskRow
                  key={`${task.sessionPath}:${task.id}`}
                  task={task}
                  showCurrentState={showCurrentState}
                  onOpen={onOpenTask}
                />
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground px-2 py-8 text-center text-[13px]">
              {pending ? '搜索中' : '没有匹配的任务'}
            </div>
          )}
          {hasMore || loadingMore ? (
            <div
              ref={loadMoreRef}
              className="text-muted-foreground flex h-7 items-center justify-center text-[12px]"
            >
              {loadingMore ? '加载中' : null}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </section>
  );
}

export function TaskRow({
  task,
  showCurrentState = false,
  onOpen,
}: {
  task: ScoutTaskItem;
  showCurrentState?: boolean;
  onOpen: (task: ScoutTaskItem) => void;
}) {
  const isCurrent = showCurrentState && task.isCurrent === true;
  const isForked = Boolean(task.parentSessionPath);
  const sessionFile = useSessionFile();
  const isStreaming = useVisualIsStreaming();
  const busyState = useVisualBusyState();
  const isCurrentTask = task.isCurrent === true || task.sessionPath === sessionFile;
  const isReplying = isCurrentTask && isStreaming && busyState.kind === 'agent';

  return (
    <button
      aria-current={isCurrent ? 'page' : undefined}
      data-forked={isForked ? 'true' : undefined}
      className={cn(
        'task-row grid h-6.5 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded px-2 text-left outline-none',
        isCurrent ? 'bg-control-selected' : 'hover:bg-control-hover',
      )}
      type="button"
      onClick={() => {
        onOpen(task);
      }}
    >
      <span className="text-foreground/90 min-w-0 flex-1 truncate text-[13px] font-medium">
        {task.title}
      </span>
      <span className="relative inline-flex h-full shrink-0 items-center justify-end">
        {isForked ? (
          <span
            aria-hidden="true"
            className="task-row-fork-marker text-muted-foreground pointer-events-none absolute top-1/2 right-0 flex size-3.5 -translate-y-1/2 items-center justify-center transition-opacity"
            title="分叉会话"
          >
            <Split className="size-3" />
          </span>
        ) : null}
        <span className="task-row-metadata inline-flex shrink-0 items-center gap-1 transition-opacity">
          <span className="text-muted-foreground shrink-0 text-[12px]">
            {formatRelativeTime(task)}
          </span>
          {isReplying ? (
            <LoaderCircle
              aria-label="当前会话正在回复"
              className="text-muted-foreground size-3 shrink-0 animate-spin"
            />
          ) : null}
        </span>
      </span>
    </button>
  );
}

function formatRelativeTime(task: ScoutTaskItem): string {
  const source = task.modifiedAt ?? task.createdAt;
  const timestamp = Date.parse(source);
  if (!Number.isFinite(timestamp)) return '';

  const diffMs = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < hour) return `${Math.max(1, Math.round(diffMs / minute))} 分`;
  if (diffMs < day) return `${Math.round(diffMs / hour)} 小时`;
  return `${Math.round(diffMs / day)} 天`;
}
