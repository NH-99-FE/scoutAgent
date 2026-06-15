// ============================================================
// Task Home — 空会话任务入口
// ============================================================

import { History, Settings, SquarePen } from 'lucide-react';
import type { ScoutTaskItem } from '@scout-agent/shared';
import { Button } from '@/components/ui/button';
import { protocolClient } from '@/bridge/protocol-client';
import { HeaderBar } from '@/components/common/HeaderBar';
import { IconButton } from '@/components/common/IconButton';
import { cn } from '@/lib/utils';
import { HOME_COMPOSER_SESSION_ID } from '@/store/composer-store';
import { useRecentTasks } from '@/store/task-store';
import { ChatComposer } from '@/features/composer/ChatComposer';
import { TaskRow, TaskSearchPanel } from './TaskSearchPanel';
import { useTaskHistoryPanel } from './use-task-history-panel';

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
  const {
    isRendered: taskHistoryRendered,
    isOpen: taskHistoryOpen,
    panelRef: taskHistoryPanelRef,
    tasks,
    query: taskQuery,
    pending: taskPending,
    loadingMore: taskLoadingMore,
    hasMore: taskHasMore,
    sentinelRef: taskHistorySentinelRef,
    open: openTaskHistory,
    setQuery: setTaskHistoryQuery,
  } = useTaskHistoryPanel();
  const recentTasks = useRecentTasks();
  const visibleTasks = taskHistoryRendered ? tasks : recentTasks.slice(0, 3);

  return (
    <main className="bg-background text-foreground flex h-screen min-h-screen flex-col overflow-hidden">
      <header className="h-auto shrink-0 px-2">
        <HeaderBar
          className="h-full gap-2"
          title="任务"
          titleClassName="text-muted-foreground"
          actionsClassName="text-muted-foreground"
          actions={
            <>
              <IconButton label="历史任务" size="icon-xs" onClick={openTaskHistory}>
                <History />
              </IconButton>
              <IconButton
                label="打开设置"
                size="icon-xs"
                onClick={protocolClient.openSettingsPanel}
              >
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
        {!taskHistoryRendered ? (
          <div className="mt-1 space-y-0.5">
            {visibleTasks.map((task) => (
              <TaskRow key={`${task.sessionPath}:${task.id}`} task={task} onOpen={onOpenTask} />
            ))}
          </div>
        ) : null}

        {!taskHistoryRendered ? (
          <Button
            className="text-muted-foreground/75 hover:text-muted-foreground mt-1 h-5 px-0 text-[11px] hover:bg-transparent dark:hover:bg-transparent"
            size="xs"
            type="button"
            variant="ghost"
            onClick={openTaskHistory}
          >
            查看全部
          </Button>
        ) : null}
      </div>

      <section
        className={cn(
          'min-h-0 flex-1 px-3',
          taskHistoryRendered ? 'overflow-hidden px-2 py-1' : 'grid place-items-center',
        )}
      >
        {taskHistoryRendered ? (
          <div
            ref={taskHistoryPanelRef}
            className="task-history-panel-shell min-h-0"
            data-state={taskHistoryOpen ? 'open' : 'closed'}
          >
            <TaskSearchPanel
              tasks={visibleTasks}
              query={taskQuery}
              pending={taskPending}
              loadingMore={taskLoadingMore}
              hasMore={taskHasMore}
              loadMoreRef={taskHistorySentinelRef}
              onQueryChange={setTaskHistoryQuery}
              onOpenTask={onOpenTask}
            />
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
