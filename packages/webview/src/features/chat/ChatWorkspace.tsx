// ============================================================
// Chat Workspace — 会话中页面布局
// ============================================================

import {
  ArrowLeft,
  Download,
  GitBranch,
  History,
  MoreHorizontal,
  Pencil,
  Settings,
  SquarePen,
} from 'lucide-react';
import type { ScoutTaskItem } from '@scout-agent/shared';
import { protocolClient } from '@/bridge/protocol-client';
import { HeaderBar } from '@/components/common/HeaderBar';
import { IconButton } from '@/components/common/IconButton';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useConversationMessages } from '@/store/conversation-store';
import { useSessionName } from '@/store/session-store';
import { ChatComposer } from '@/features/composer/ChatComposer';
import { ConversationView } from '@/features/conversation/ConversationView';
import { TaskSearchPanel } from '@/features/tasks/TaskSearchPanel';
import { useTaskHistoryPanel } from '@/features/tasks/use-task-history-panel';

interface ChatWorkspaceProps {
  onBack: () => void;
  onNewSession: () => void;
  onOpenTask: (task: ScoutTaskItem) => void;
}

export function ChatWorkspace({ onBack, onNewSession, onOpenTask }: ChatWorkspaceProps) {
  const messages = useConversationMessages();
  const sessionName = useSessionName();
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
    close: closeTaskHistory,
    setQuery: setTaskHistoryQuery,
  } = useTaskHistoryPanel();
  const title = sessionName || getConversationTitle(messages) || '当前会话';
  const handleOpenTask = (task: ScoutTaskItem) => {
    if (task.isCurrent) {
      closeTaskHistory();
      return;
    }
    closeTaskHistory();
    onOpenTask(task);
  };

  return (
    <main className="bg-background text-foreground relative flex h-screen min-h-screen flex-col overflow-hidden">
      <header className="h-auto shrink-0 px-2">
        <HeaderBar
          className="h-full"
          title={title}
          actionsClassName="text-muted-foreground"
          left={
            <span className="text-muted-foreground">
              <IconButton label="返回" size="icon-xs" onClick={onBack}>
                <ArrowLeft />
              </IconButton>
            </span>
          }
          actions={
            <>
              <ConversationMoreMenu />
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
              <IconButton label="新会话" size="icon-xs" onClick={onNewSession}>
                <SquarePen />
              </IconButton>
            </>
          }
        />
      </header>

      {taskHistoryRendered ? (
        <div
          ref={taskHistoryPanelRef}
          className="task-history-panel-shell absolute top-10 right-2 left-2 z-20"
          data-state={taskHistoryOpen ? 'open' : 'closed'}
        >
          <TaskSearchPanel
            tasks={tasks}
            query={taskQuery}
            pending={taskPending}
            loadingMore={taskLoadingMore}
            hasMore={taskHasMore}
            loadMoreRef={taskHistorySentinelRef}
            showCurrentState
            onQueryChange={setTaskHistoryQuery}
            onOpenTask={handleOpenTask}
          />
        </div>
      ) : null}

      <ConversationView messages={messages} />

      <footer className="border-border/70 shrink-0 border-t px-3 py-3">
        <ChatComposer placeholder="要求后续变更" />
      </footer>
    </main>
  );
}

function ConversationMoreMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="更多操作"
          className="text-current"
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-35">
        <DropdownMenuItem disabled className="text-[12px]">
          <Pencil />
          <span>重命名对话</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="text-[12px]" onSelect={protocolClient.openTreePanel}>
          <GitBranch />
          <span>查看会话树</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled className="text-[12px]">
          <Download />
          <span>导出会话</span>
          <span className="text-muted-foreground ml-auto text-[11px]">Beta</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getConversationTitle(messages: ReturnType<typeof useConversationMessages>): string {
  const firstUserMessage = messages.find((message) => message.role === 'user');
  if (!firstUserMessage) return '';
  const text =
    typeof firstUserMessage.content === 'string'
      ? firstUserMessage.content
      : firstUserMessage.content
          .filter((content) => content.type === 'text')
          .map((content) => content.text)
          .join(' ');
  return text.trim().slice(0, 32);
}
