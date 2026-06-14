// ============================================================
// Conversation View — 会话消息流基础渲染
// ============================================================

import { useEffect, useRef } from 'react';
import { Copy, ExternalLink, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { ScoutContent, ScoutMessage } from '@scout-agent/shared';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface ConversationViewProps {
  messages: ScoutMessage[];
}

export function ConversationView({ messages }: ConversationViewProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof endRef.current?.scrollIntoView !== 'function') return;
    endRef.current.scrollIntoView({ block: 'end' });
  }, [messages]);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-3 px-3 py-2">
        {messages.map((message, index) => (
          <MessageItem
            key={message.entryId ?? `${message.role}:${message.timestamp}:${index}`}
            message={message}
          />
        ))}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}

function MessageItem({ message }: { message: ScoutMessage }) {
  if (message.role === 'user') {
    return (
      <article className="flex justify-end">
        <div className="bg-muted max-w-[88%] rounded-md px-2.5 py-1.5 text-[13px] leading-5 break-words whitespace-pre-wrap">
          {contentToText(message.content)}
        </div>
      </article>
    );
  }

  if (message.role === 'toolResult') {
    return (
      <SystemBlock
        title={message.toolName}
        tone={message.isError ? 'error' : 'default'}
        text={contentToText(message.content)}
      />
    );
  }

  if (message.role === 'branchSummary') {
    return <SystemBlock title="分支摘要" text={message.summary} />;
  }

  if (message.role === 'compactionSummary') {
    return <SystemBlock title="压缩摘要" text={message.summary} />;
  }

  if (message.role === 'custom') {
    return <SystemBlock title={message.customType} text={contentToText(message.content)} />;
  }

  return (
    <article className="group/message">
      <div className="wrap-break-words text-[13px] leading-5 whitespace-pre-wrap">
        {message.content.map((content, index) => (
          <ContentBlock key={`${content.type}:${index}`} content={content} />
        ))}
        {message.errorMessage ? (
          <p className="text-destructive mt-2">{message.errorMessage}</p>
        ) : null}
      </div>
      <MessageActions text={contentToText(message.content)} timestamp={message.timestamp} />
    </article>
  );
}

function ContentBlock({ content }: { content: ScoutContent }) {
  if (content.type === 'text') return <p>{content.text}</p>;
  if (content.type === 'thinking') {
    return (
      <p className="text-muted-foreground border-border my-2 border-l pl-2 text-xs">
        {content.redacted ? 'Thinking redacted' : content.thinking}
      </p>
    );
  }
  if (content.type === 'toolCall') {
    return (
      <pre className="bg-muted border-border my-1.5 overflow-x-auto rounded-md border px-2 py-1 text-xs">
        {content.name}
      </pre>
    );
  }
  return (
    <img
      alt="Assistant image"
      className="border-border my-2 max-h-72 rounded-md border object-contain"
      src={toImageSource(content)}
    />
  );
}

function SystemBlock({
  title,
  text,
  tone = 'default',
}: {
  title: string;
  text: string;
  tone?: 'default' | 'error';
}) {
  return (
    <article
      className={cn(
        'border-border bg-card rounded-md border px-2.5 py-1.5 text-[13px]',
        tone === 'error' && 'border-destructive/30 bg-destructive/10',
      )}
    >
      <p className="text-muted-foreground text-xs font-medium">{title}</p>
      <p className="mt-1 leading-5 break-words whitespace-pre-wrap">{text}</p>
    </article>
  );
}

function MessageActions({ text, timestamp }: { text: string; timestamp: number }) {
  return (
    <div className="text-muted-foreground mt-1 flex items-center gap-0.5 text-[11px]">
      <Button
        aria-label="复制"
        size="icon-xs"
        type="button"
        variant="ghost"
        onClick={() => void navigator.clipboard?.writeText(text)}
      >
        <Copy />
      </Button>
      <Button aria-label="赞同" size="icon-xs" type="button" variant="ghost">
        <ThumbsUp />
      </Button>
      <Button aria-label="反对" size="icon-xs" type="button" variant="ghost">
        <ThumbsDown />
      </Button>
      <Button aria-label="打开" size="icon-xs" type="button" variant="ghost">
        <ExternalLink />
      </Button>
      <span className="ml-1">{formatTime(timestamp)}</span>
    </div>
  );
}

function contentToText(content: string | ScoutContent[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((item) => {
      if (item.type === 'text') return item.text;
      if (item.type === 'thinking') return item.thinking;
      if (item.type === 'toolCall') return item.name;
      return '[image]';
    })
    .join('\n');
}

function toImageSource(content: Extract<ScoutContent, { type: 'image' }>): string {
  if (content.data.startsWith('data:')) return content.data;
  return `data:${content.mimeType};base64,${content.data}`;
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}
