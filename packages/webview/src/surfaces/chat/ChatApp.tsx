// ============================================================
// Chat App — 常驻侧栏主界面
// ============================================================

import type { ScoutTaskItem } from '@scout-agent/shared';
import { protocolClient } from '@/bridge/protocol-client';
import { HOME_COMPOSER_SESSION_ID, useComposerActions } from '@/store/composer-store';
import { useConversationMessages } from '@/store/conversation-store';
import { useSessionFile } from '@/store/session-store';
import {
  useChatView,
  useNewSessionPending,
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
    uiActions.beginOpenTask(task.sessionPath);
    protocolClient.openTask(task);
  };

  const startFreshNewSession = () => {
    composerActions.clearDraft(HOME_COMPOSER_SESSION_ID);
    uiActions.setChatView('home');
  };

  if (shouldShowHome) {
    return (
      <TaskHome
        newSessionPending={newSessionPending}
        onOpenTask={openTask}
        onBeginNewSessionRequest={uiActions.beginNewSessionRequest}
      />
    );
  }

  return (
    <ChatWorkspace
      onBack={() => uiActions.setChatView('home')}
      onNewSession={startFreshNewSession}
      onOpenTask={openTask}
    />
  );
}
