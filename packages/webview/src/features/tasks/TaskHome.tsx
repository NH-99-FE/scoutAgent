// ============================================================
// Task Home — 空会话任务入口
// ============================================================

import { History, Settings, SquarePen } from 'lucide-react';
import { useState } from 'react';
import type { ScoutTaskItem } from '@scout-agent/shared';
import { Button } from '@/components/ui/button';
import { protocolClient } from '@/bridge/protocol-client';
import { HeaderBar } from '@/components/common/HeaderBar';
import { IconButton } from '@/components/common/IconButton';
import { cn } from '@/lib/utils';
import { HOME_COMPOSER_SESSION_ID } from '@/store/composer-store';
import { useTaskCount, useTaskPending, useTasks } from '@/store/task-store';
import { ChatComposer } from '@/features/composer/ChatComposer';

interface TaskHomeProps {
  newSessionPending: boolean;
  onOpenTask: (task: ScoutTaskItem) => void;
  onBeginNewSessionRequest: () => void;
}

export function TaskHome({
  newSessionPending,
  onOpenTask,
  onBeginNewSessionRequest,
}: TaskHomeProps) {
  const [showAllTasks, setShowAllTasks] = useState(false);
  const tasks = useTasks();
  const taskCount = useTaskCount();
  const pending = useTaskPending();
  const visibleTasks = showAllTasks ? tasks : tasks.slice(0, 3);

  const toggleAllTasks = () => {
    if (showAllTasks) {
      setShowAllTasks(false);
      return;
    }
    setShowAllTasks(true);
    protocolClient.requestTasks(50);
  };

  return (
    <main className="bg-background text-foreground flex h-screen min-h-screen flex-col overflow-hidden">
      <header className="h-9 shrink-0 px-2">
        <HeaderBar
          className="h-full gap-2"
          title="任务"
          titleClassName="text-muted-foreground"
          actionsClassName="text-muted-foreground"
          actions={
            <>
              <IconButton
                label="刷新任务"
                size="icon-xs"
                onClick={() => protocolClient.requestTasks(50)}
              >
                <History />
              </IconButton>
              <IconButton label="打开设置" size="icon-xs" onClick={protocolClient.openSettingsPanel}>
                <Settings />
              </IconButton>
              {/* TODO: 明确首页新会话动作后再接入，当前首页 composer 已承载新会话输入。 */}
              <IconButton label="新会话" size="icon-xs">
                <SquarePen />
              </IconButton>
            </>
          }
        />
      </header>

      <div className="shrink-0 px-2">
        {!showAllTasks ? (
          <div className="mt-1 space-y-0.5">
            {visibleTasks.map((task) => (
              <TaskRow key={`${task.sessionPath}:${task.id}`} task={task} onOpen={onOpenTask} />
            ))}
          </div>
        ) : null}

        <Button
          className={cn(
            'text-muted-foreground/75 hover:text-muted-foreground mt-0.5 h-5 px-0 text-[11px] hover:bg-transparent dark:hover:bg-transparent',
            pending && 'opacity-70',
          )}
          size="xs"
          type="button"
          variant="ghost"
          onClick={toggleAllTasks}
        >
          {pending ? '加载中' : showAllTasks ? '收起' : `查看全部（${taskCount} 个）`}
        </Button>
      </div>

      <section
        className={cn(
          'min-h-0 flex-1 px-3',
          showAllTasks ? 'overflow-y-auto px-2 py-1' : 'grid place-items-center',
        )}
      >
        {showAllTasks ? (
          <div className="space-y-0.5">
            {visibleTasks.map((task) => (
              <TaskRow key={`${task.sessionPath}:${task.id}`} task={task} onOpen={onOpenTask} />
            ))}
          </div>
        ) : (
          <div
            aria-hidden="true"
            className="border-muted-foreground/25 text-muted-foreground/50 grid size-12 place-items-center rounded-full border"
          >
            <span className="text-sm font-semibold">S</span>
          </div>
        )}
      </section>

      <footer className="shrink-0 px-3 pb-3">
        <ChatComposer
          draftSessionId={HOME_COMPOSER_SESSION_ID}
          mode="newSession"
          placeholder="随心输入"
          submitDisabled={newSessionPending}
          onBeginNewSessionRequest={onBeginNewSessionRequest}
        />
      </footer>
    </main>
  );
}

function TaskRow({ task, onOpen }: { task: ScoutTaskItem; onOpen: (task: ScoutTaskItem) => void }) {
  return (
    <button
      className="hover:bg-muted dark:hover:bg-muted/50 flex w-full items-baseline gap-2 rounded-md px-0.5 py-0.5 text-left outline-none"
      type="button"
      onClick={() => {
        onOpen(task);
      }}
    >
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{task.title}</span>
      <span className="text-muted-foreground shrink-0 text-[11px]">{formatRelativeTime(task)}</span>
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

  if (diffMs < hour) return `${Math.max(1, Math.round(diffMs / minute))} 分钟`;
  if (diffMs < day) return `${Math.round(diffMs / hour)} 小时`;
  return `${Math.round(diffMs / day)} 天`;
}
