// ============================================================
// Task Home — 空会话任务入口
// ============================================================

import { Edit3, History, Settings } from 'lucide-react';
import { useState } from 'react';
import type { ScoutTaskItem } from '@scout-agent/shared';
import { Button } from '@/components/ui/button';
import { protocolClient } from '@/bridge/protocol-client';
import { IconButton } from '@/components/common/IconButton';
import { cn } from '@/lib/utils';
import { useTaskCount, useTaskPending, useTasks } from '@/store/task-store';
import { ChatComposer } from '@/features/composer/ChatComposer';

interface TaskHomeProps {
  onLeaveHome?: () => void;
}

export function TaskHome({ onLeaveHome }: TaskHomeProps) {
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
      <header className="shrink-0 px-2.5 pt-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-muted-foreground text-sm font-medium">任务</h1>
          <div className="flex items-center gap-1">
            <IconButton label="刷新任务" onClick={() => protocolClient.requestTasks(50)}>
              <History />
            </IconButton>
            <IconButton label="打开设置" onClick={protocolClient.openSettingsPanel}>
              <Settings />
            </IconButton>
            <IconButton label="新建会话" onClick={protocolClient.clearConversation}>
              <Edit3 />
            </IconButton>
          </div>
        </div>

        {!showAllTasks ? (
          <div className="mt-2 space-y-0.5">
            {visibleTasks.map((task) => (
              <TaskRow key={`${task.sessionPath}:${task.id}`} task={task} onOpen={onLeaveHome} />
            ))}
          </div>
        ) : null}

        <Button
          className={cn(
            'text-muted-foreground/75 hover:text-muted-foreground mt-1 h-6 px-0 hover:bg-transparent dark:hover:bg-transparent',
            pending && 'opacity-70',
          )}
          size="xs"
          type="button"
          variant="ghost"
          onClick={toggleAllTasks}
        >
          {pending ? '加载中' : showAllTasks ? '收起' : `查看全部（${taskCount} 个）`}
        </Button>
      </header>

      <section
        className={cn(
          'min-h-0 flex-1 px-3',
          showAllTasks ? 'overflow-y-auto py-1' : 'grid place-items-center',
        )}
      >
        {showAllTasks ? (
          <div className="space-y-0.5">
            {visibleTasks.map((task) => (
              <TaskRow key={`${task.sessionPath}:${task.id}`} task={task} onOpen={onLeaveHome} />
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
        <ChatComposer placeholder="随心输入" onSubmitMessage={onLeaveHome} />
      </footer>
    </main>
  );
}

function TaskRow({ task, onOpen }: { task: ScoutTaskItem; onOpen?: () => void }) {
  return (
    <button
      className="hover:bg-muted dark:hover:bg-muted/50 flex w-full items-baseline gap-3 rounded-md px-0.5 py-1 text-left outline-none"
      type="button"
      onClick={() => {
        protocolClient.openTask(task);
        onOpen?.();
      }}
    >
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{task.title}</span>
      <span className="text-muted-foreground shrink-0 text-xs">{formatRelativeTime(task)}</span>
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
