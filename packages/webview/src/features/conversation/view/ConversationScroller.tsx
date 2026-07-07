// ============================================================
// Conversation Scroller — 会话滚动边界
// ============================================================

import type { ComponentProps, ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerScrollable,
} from '@/components/ui/message-scroller';
import { cn } from '@/lib/utils';
import { useLiveTailController } from './use-live-tail-controller';

const MESSAGE_SCROLL_EDGE_THRESHOLD_PX = 48;

interface ConversationScrollerProps {
  children: ReactNode;
  className?: string;
  preserveScrollOnPrepend?: boolean;
  showScrollToBottomButton?: boolean;
}

type ConversationScrollerContentProps = ComponentProps<typeof MessageScrollerContent>;

type ConversationScrollerItemProps = Omit<
  ComponentProps<typeof MessageScrollerItem>,
  'messageId' | 'scrollAnchor'
> & {
  messageId: string;
};

export function ConversationScroller({
  children,
  className,
  preserveScrollOnPrepend = false,
  showScrollToBottomButton = false,
}: ConversationScrollerProps) {
  // 当前会话详情是 transcript 阅读模型，默认不启用 prepend 保位；
  // 未来向上加载历史时，应由专门的 history pagination owner 显式打开。
  return (
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition="end"
      scrollEdgeThreshold={MESSAGE_SCROLL_EDGE_THRESHOLD_PX}
    >
      <MessageScroller className={cn('min-h-0 w-full min-w-0 flex-1', className)}>
        <ConversationScrollerViewport preserveScrollOnPrepend={preserveScrollOnPrepend}>
          {children}
        </ConversationScrollerViewport>
        {showScrollToBottomButton ? <ConversationScrollToBottomButton /> : null}
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

export function ConversationScrollerContent({
  className,
  ...props
}: ConversationScrollerContentProps) {
  return (
    <MessageScrollerContent
      className={cn(
        'scout-conversation-content flex w-full max-w-full min-w-0 flex-col gap-3 overflow-x-hidden py-2 pr-0.5 pb-2 pl-3 md:py-3 md:pr-1.5 md:pb-2 md:pl-4',
        className,
      )}
      data-scout-conversation-rendering="full"
      {...props}
    />
  );
}

export function ConversationScrollerItem({
  children,
  messageId,
  ...props
}: ConversationScrollerItemProps) {
  // 只注册 messageId，不启用 scrollAnchor；发送新问题不应把正在读历史的用户拉回底部。
  return (
    <MessageScrollerItem messageId={messageId} {...props}>
      {children}
    </MessageScrollerItem>
  );
}

function ConversationScrollerViewport({
  children,
  preserveScrollOnPrepend,
}: {
  children: ReactNode;
  preserveScrollOnPrepend: boolean;
}) {
  const { scrollToEnd } = useMessageScroller();
  const { end: canScrollToEnd } = useMessageScrollerScrollable();
  const isAtEnd = !canScrollToEnd;
  const { viewportHandlers } = useLiveTailController({
    isAtEnd,
    scrollToEnd,
  });

  return (
    <MessageScrollerViewport
      aria-label="会话滚动区域"
      className="scout-conversation-viewport"
      preserveScrollOnPrepend={preserveScrollOnPrepend}
      {...viewportHandlers}
    >
      {children}
    </MessageScrollerViewport>
  );
}

function ConversationScrollToBottomButton() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <MessageScrollerButton
            aria-label="滚动到底部"
            behavior="auto"
            className="border-border/70 bg-background/95 text-muted-foreground hover:bg-muted hover:text-foreground shadow-md backdrop-blur"
            direction="end"
            size="icon-sm"
            variant="outline"
          />
        </TooltipTrigger>
        <TooltipContent>滚动到底部</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
