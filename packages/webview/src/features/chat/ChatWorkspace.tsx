// ============================================================
// Chat Workspace — 会话中页面布局
// ============================================================

import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Download,
  GitBranch,
  History,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  SquarePen,
  Undo2,
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
import {
  useConversationMessages,
  useConversationItems,
  useToolExecutionsById,
  useToolPreviewsById,
} from '@/store/conversation-store';
import { getConversationExpansionScope } from '@/store/conversation-expansion-store';
import { useVisualBusyState, useVisualIsStreaming } from '@/store/runtime-overlay-store';
import {
  useForkPointEntryId,
  useParentSessionPath,
  useSessionFile,
  useSessionId,
  useSessionName,
} from '@/store/session-store';
import { useUiActions } from '@/store/ui-store';
import { ChatComposer } from '@/features/composer/ChatComposer';
import { ConversationView } from '@/features/conversation/ConversationView';
import { applyForkOriginNotice } from '@/features/conversation/conversation-notices';
import { SettingsActionsMenu } from '@/features/settings/SettingsActionsMenu';
import { TaskSearchPanel } from '@/features/tasks/TaskSearchPanel';
import { useTaskHistoryPanel } from '@/features/tasks/use-task-history-panel';

interface ChatWorkspaceProps {
  onBack: () => void;
  onNewSession: () => void;
  onOpenTask: (task: ScoutTaskItem) => void;
}

export function ChatWorkspace({ onBack, onNewSession, onOpenTask }: ChatWorkspaceProps) {
  const [pendingScrollToBottomKey, setPendingScrollToBottomKey] = useState(0);
  const messages = useConversationMessages();
  const conversationItems = useConversationItems();
  const isStreaming = useVisualIsStreaming();
  const toolExecutionsById = useToolExecutionsById();
  const toolPreviewsById = useToolPreviewsById();
  const busyState = useVisualBusyState();
  const sessionFile = useSessionFile();
  const sessionId = useSessionId();
  const sessionName = useSessionName();
  const parentSessionPath = useParentSessionPath();
  const forkPointEntryId = useForkPointEntryId();
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
    triggerRef: taskHistoryTriggerRef,
    close: closeTaskHistory,
    toggle: toggleTaskHistory,
    setQuery: setTaskHistoryQuery,
  } = useTaskHistoryPanel();
  const title = sessionName || getConversationTitle(messages) || '当前会话';
  const conversationViewItems = useMemo(
    () =>
      applyForkOriginNotice({
        forkPointEntryId,
        hasParentSession: Boolean(parentSessionPath),
        items: conversationItems,
      }),
    [conversationItems, forkPointEntryId, parentSessionPath],
  );
  const handleOpenTask = (task: ScoutTaskItem) => {
    if (task.isCurrent) {
      closeTaskHistory();
      return;
    }
    closeTaskHistory();
    onOpenTask(task);
  };
  const requestScrollToBottom = () => {
    setPendingScrollToBottomKey((key) => key + 1);
  };
  const isAgentRunning = busyState.kind === 'agent';

  return (
    <main className="bg-background text-foreground relative flex h-screen min-h-screen max-w-full min-w-0 flex-col overflow-hidden">
      <header className="h-auto max-w-full min-w-0 shrink-0 px-2">
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
              <ConversationMoreMenu parentSessionPath={parentSessionPath} />
              <span ref={taskHistoryTriggerRef} className="inline-flex">
                <IconButton
                  label={isAgentRunning ? '正在回复' : '历史任务'}
                  size="icon-xs"
                  onClick={toggleTaskHistory}
                >
                  {isAgentRunning ? <LoaderCircle className="animate-spin" /> : <History />}
                </IconButton>
              </span>
              <SettingsActionsMenu />
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

      <ConversationView
        busyState={busyState}
        className="min-h-0 flex-1"
        expansionScope={getConversationExpansionScope({ sessionFile, sessionId })}
        forceScrollToBottomKey={pendingScrollToBottomKey}
        isStreaming={isStreaming}
        items={conversationViewItems}
        showScrollToBottomButton
        toolExecutionsById={toolExecutionsById}
        toolPreviewsById={toolPreviewsById}
      />

      <footer className="bg-background max-w-full min-w-0 shrink-0 px-3 pt-1 pb-3">
        <ChatComposer placeholder="要求后续变更" onMessageSent={requestScrollToBottom} />
      </footer>
    </main>
  );
}

function ConversationMoreMenu({ parentSessionPath }: { parentSessionPath: string }) {
  const uiActions = useUiActions();

  const openParentSession = () => {
    if (!parentSessionPath) return;
    uiActions.beginOpenTask(parentSessionPath);
    protocolClient.restoreSession(parentSessionPath);
  };

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
        {parentSessionPath ? (
          <DropdownMenuItem className="text-[12px]" onSelect={openParentSession}>
            <Undo2 />
            <span>返回原会话</span>
          </DropdownMenuItem>
        ) : null}
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
