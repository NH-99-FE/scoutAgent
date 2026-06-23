// ============================================================
// Chat App — 常驻侧栏主界面
// ============================================================

import { useEffect } from 'react';
import { toast } from 'sonner';
import type { ScoutNotificationMessage, ScoutTaskItem } from '@scout-agent/shared';
import { protocolClient } from '@/bridge/protocol-client';
import { Toaster } from '@/components/ui/sonner';
import { HOME_COMPOSER_SESSION_ID, useComposerActions } from '@/store/composer-store';
import { useConversationMessages } from '@/store/conversation-store';
import { useSessionFile } from '@/store/session-store';
import {
  useChatView,
  useNewSessionPending,
  useNotification,
  useOpeningTaskSessionPath,
  useUiActions,
} from '@/store/ui-store';
import { ChatWorkspace } from '@/features/chat/ChatWorkspace';
import { TaskHome } from '@/features/tasks/TaskHome';

export function ChatApp() {
  const messages = useConversationMessages();
  const sessionFile = useSessionFile();
  const chatView = useChatView();
  const newSessionPending = useNewSessionPending();
  const openingTaskSessionPath = useOpeningTaskSessionPath();
  const uiActions = useUiActions();
  const composerActions = useComposerActions();
  const hasConversation = messages.length > 0;
  const isOpeningTask =
    openingTaskSessionPath !== undefined && openingTaskSessionPath !== sessionFile;
  const shouldShowHome =
    isOpeningTask || chatView === 'home' || (chatView === 'auto' && !hasConversation);

  const openTask = (task: ScoutTaskItem) => {
    if (task.isCurrent) {
      uiActions.setChatView('detail');
      return;
    }
    composerActions.restorePendingDraft(HOME_COMPOSER_SESSION_ID);
    uiActions.beginOpenTask(task.sessionPath);
    protocolClient.openTask(task);
  };

  const startFreshNewSession = () => {
    composerActions.clearDraft(HOME_COMPOSER_SESSION_ID);
    uiActions.setChatView('home');
  };

  const content = shouldShowHome ? (
    <TaskHome
      newSessionPending={newSessionPending}
      onOpenTask={openTask}
      onBeginNewSessionRequest={uiActions.beginNewSessionRequest}
    />
  ) : (
    <ChatWorkspace
      onBack={() => uiActions.setChatView('home')}
      onNewSession={startFreshNewSession}
      onOpenTask={openTask}
    />
  );

  return (
    <>
      {content}
      <ChatNotificationToaster />
    </>
  );
}

function ChatNotificationToaster() {
  const notification = useNotification();
  const uiActions = useUiActions();

  useEffect(() => {
    if (!notification) return;
    showNotificationToast(notification);
    uiActions.setNotification(undefined);
  }, [notification, uiActions]);

  return <Toaster position="top-center" />;
}

function showNotificationToast(notification: ScoutNotificationMessage): void {
  const options = {
    id: `${notification.level}:${notification.message}`,
  };
  if (notification.level === 'error') {
    toast.error(notification.message, options);
    return;
  }
  if (notification.level === 'warning') {
    toast.warning(notification.message, options);
    return;
  }
  toast.info(notification.message, options);
}
