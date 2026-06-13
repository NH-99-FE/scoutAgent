// ============================================================
// Chat Workspace — 会话中页面布局
// ============================================================

import { ArrowLeft, Edit3, GitBranch, MoreHorizontal, RotateCcw, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { protocolClient } from '@/bridge/protocol-client';
import { IconButton } from '@/components/common/IconButton';
import { useConversationMessages } from '@/store/conversation-store';
import { useSessionName } from '@/store/session-store';
import { ChatComposer } from '@/features/composer/ChatComposer';
import { ConversationView } from '@/features/conversation/ConversationView';

interface ChatWorkspaceProps {
  onBack: () => void;
}

export function ChatWorkspace({ onBack }: ChatWorkspaceProps) {
  const messages = useConversationMessages();
  const sessionName = useSessionName();
  const title = sessionName || getConversationTitle(messages) || '当前会话';

  return (
    <main className="bg-background text-foreground flex h-screen min-h-screen flex-col overflow-hidden">
      <header className="border-border/70 flex h-11 shrink-0 items-center justify-between gap-1 border-b px-2">
        <Button
          className="min-w-0 flex-1 justify-start px-1.5 text-left"
          size="sm"
          type="button"
          variant="ghost"
          onClick={onBack}
        >
          <ArrowLeft />
          <span className="truncate">{title}</span>
        </Button>

        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton label="更多操作">
            <MoreHorizontal />
          </IconButton>
          <IconButton label="继续会话" onClick={protocolClient.continueSession}>
            <RotateCcw />
          </IconButton>
          <IconButton label="打开设置" onClick={protocolClient.openSettingsPanel}>
            <Settings />
          </IconButton>
          <IconButton label="打开会话树" onClick={protocolClient.openTreePanel}>
            <GitBranch />
          </IconButton>
          <IconButton label="编辑标题">
            <Edit3 />
          </IconButton>
        </div>
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
