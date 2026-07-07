// ============================================================
// Chat Workspace — 会话中页面布局
// ============================================================

import { memo, useMemo, useState } from 'react';
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
  useConversationItems,
  useConversationTitle,
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
import { useExtensionUIRequests, useUiActions } from '@/store/ui-store';
import { ChatComposer, ComposerActivityTrayContainer } from '@/features/composer';
import {
  applyForkOriginNotice,
  ConversationView,
  createExtensionRequestsTranscriptAddon,
} from '@/features/conversation';
import { SettingsActionsMenu } from '@/features/settings';
import { TaskSearchPanel, useTaskHistoryPanel } from '@/features/tasks';
import { RenameSessionDialog } from './RenameSessionDialog';

interface ChatWorkspaceProps {
  onBack: () => void;
  onNewSession: () => void;
  onOpenTask: (task: ScoutTaskItem) => void;
}

export function ChatWorkspace({ onBack, onNewSession, onOpenTask }: ChatWorkspaceProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const busyState = useVisualBusyState();
  const sessionName = useSessionName();
  const parentSessionPath = useParentSessionPath();
  const fallbackTitle = useConversationTitle();
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
  const title = sessionName || fallbackTitle || '当前会话';
  const handleOpenTask = (task: ScoutTaskItem) => {
    if (task.isCurrent) {
      closeTaskHistory();
      return;
    }
    closeTaskHistory();
    onOpenTask(task);
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
              <ConversationMoreMenu
                onRename={() => setRenameOpen(true)}
                parentSessionPath={parentSessionPath}
              />
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
        <RenameSessionDialog currentTitle={title} open={renameOpen} onOpenChange={setRenameOpen} />
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

      <ConversationPanel />

      <footer className="bg-background max-w-full min-w-0 shrink-0 px-3 pt-1 pb-3">
        <ComposerActivityTrayContainer />
        <ChatComposer placeholder="要求后续变更" />
      </footer>
    </main>
  );
}

const ConversationPanel = memo(function ConversationPanel() {
  const conversationItems = useConversationItems();
  const isStreaming = useVisualIsStreaming();
  const busyState = useVisualBusyState();
  const toolExecutionsById = useToolExecutionsById();
  const toolPreviewsById = useToolPreviewsById();
  const extensionUIRequests = useExtensionUIRequests();
  const sessionFile = useSessionFile();
  const sessionId = useSessionId();
  const parentSessionPath = useParentSessionPath();
  const forkPointEntryId = useForkPointEntryId();
  const conversationViewItems = useMemo(
    () =>
      applyForkOriginNotice({
        forkPointEntryId,
        hasParentSession: Boolean(parentSessionPath),
        items: conversationItems,
      }),
    [conversationItems, forkPointEntryId, parentSessionPath],
  );
  const transcriptAddons = useMemo(() => {
    const extensionRequestsAddon = createExtensionRequestsTranscriptAddon(extensionUIRequests);
    return extensionRequestsAddon ? [extensionRequestsAddon] : [];
  }, [extensionUIRequests]);

  return (
    <ConversationView
      busyState={busyState}
      className="min-h-0 flex-1"
      expansionScope={getConversationExpansionScope({ sessionFile, sessionId })}
      isStreaming={isStreaming}
      items={conversationViewItems}
      showScrollToBottomButton
      transcriptAddons={transcriptAddons}
      toolExecutionsById={toolExecutionsById}
      toolPreviewsById={toolPreviewsById}
    />
  );
});

function ConversationMoreMenu({
  onRename,
  parentSessionPath,
}: {
  onRename: () => void;
  parentSessionPath: string;
}) {
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
        <DropdownMenuItem className="text-[12px]" onSelect={onRename}>
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
        <DropdownMenuItem className="text-[12px]" onSelect={protocolClient.exportSession}>
          <Download />
          <span>导出会话</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
