// ============================================================
// Chat Workspace — 会话中页面布局
// ============================================================

import { ArrowLeft, GitBranch, MoreHorizontal, RotateCcw, Settings, SquarePen } from 'lucide-react';
import { protocolClient } from '@/bridge/protocol-client';
import { HeaderBar } from '@/components/common/HeaderBar';
import { IconButton } from '@/components/common/IconButton';
import { useConversationMessages } from '@/store/conversation-store';
import { useSessionName } from '@/store/session-store';
import { ChatComposer } from '@/features/composer/ChatComposer';
import { ConversationView } from '@/features/conversation/ConversationView';

interface ChatWorkspaceProps {
  onBack: () => void;
  onNewSession: () => void;
}

export function ChatWorkspace({ onBack, onNewSession }: ChatWorkspaceProps) {
  const messages = useConversationMessages();
  const sessionName = useSessionName();
  const title = sessionName || getConversationTitle(messages) || '当前会话';

  return (
    <main className="bg-background text-foreground flex h-screen min-h-screen flex-col overflow-hidden">
      <header className="border-border/70 h-9 shrink-0 border-b px-2">
        <HeaderBar
          className="h-full"
          title={title}
          left={
            <IconButton label="返回" size="icon-xs" onClick={onBack}>
              <ArrowLeft />
            </IconButton>
          }
          actions={
            <>
              <IconButton label="更多操作" size="icon-xs">
                <MoreHorizontal />
              </IconButton>
              <IconButton label="继续会话" size="icon-xs" onClick={protocolClient.continueSession}>
                <RotateCcw />
              </IconButton>
              <IconButton label="打开设置" size="icon-xs" onClick={protocolClient.openSettingsPanel}>
                <Settings />
              </IconButton>
              <IconButton label="打开会话树" size="icon-xs" onClick={protocolClient.openTreePanel}>
                <GitBranch />
              </IconButton>
              <IconButton label="新会话" size="icon-xs" onClick={onNewSession}>
                <SquarePen />
              </IconButton>
            </>
          }
        />
      </header>

      <ConversationView messages={messages} />

      <footer className="border-border/70 shrink-0 border-t px-3 py-3">
        <ChatComposer placeholder="要求后续变更" />
      </footer>
    </main>
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
