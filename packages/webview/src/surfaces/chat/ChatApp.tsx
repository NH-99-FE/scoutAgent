// ============================================================
// Chat App — 常驻侧栏主界面
// ============================================================

import { useState } from 'react';
import { useConversationMessages } from '@/store/conversation-store';
import { ChatWorkspace } from '@/features/chat/ChatWorkspace';
import { TaskHome } from '@/features/tasks/TaskHome';

export function ChatApp() {
  const [showTaskHome, setShowTaskHome] = useState(false);
  const messages = useConversationMessages();
  const hasConversation = messages.length > 0;

  if (!hasConversation || showTaskHome) {
    return <TaskHome onLeaveHome={() => setShowTaskHome(false)} />;
  }

  return <ChatWorkspace onBack={() => setShowTaskHome(true)} />;
}
