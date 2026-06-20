// ============================================================
// Task Search Panel — 任务历史搜索面板
// ============================================================

import { Search } from 'lucide-react';
import type { ScoutTaskItem } from '@scout-agent/shared';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
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
          className="h-7 flex-1 rounded-none border-0 bg-transparent px-0 py-0 text-xs shadow-none dark:bg-transparent"
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

  return (
    <button
      aria-current={isCurrent ? 'page' : undefined}
      className={cn(
        'flex h-6.5 w-full items-center gap-2 rounded px-2 text-left outline-none',
        isCurrent ? 'bg-muted dark:bg-muted/50' : 'hover:bg-muted dark:hover:bg-muted/50',
      )}
      type="button"
      onClick={() => {
        onOpen(task);
      }}
    >
      <span className="text-foreground/90 min-w-0 flex-1 truncate text-[13px] font-medium">
        {task.title}
      </span>
      <span className="text-muted-foreground shrink-0 text-[12px]">{formatRelativeTime(task)}</span>
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
