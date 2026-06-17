// ============================================================
// Conversation View — 会话 turn 与 assistant 过程渲染
// ============================================================

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import type { ScoutBusyState, ScoutContent, ScoutMessage } from '@scout-agent/shared';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ConversationItem, ToolExecutionState } from '@/store/conversation-store';
import {
  buildConversationRows,
  type AssistantContentEntry,
  type AssistantConversationRow,
  type AssistantVisibleContent,
  type ConversationRow,
  type SystemConversationRow,
} from './conversation-view-model';
import { AssistantProcessBlock } from './AssistantProcessBlock';
import { MarkdownContent } from './MarkdownContent';
import { contentToText } from './tool-display';

const STICKY_SCROLL_THRESHOLD_PX = 48;
const MIN_SCROLL_TO_BOTTOM_ANIMATION_MS = 420;
const MAX_SCROLL_TO_BOTTOM_ANIMATION_MS = 720;

interface ConversationViewProps {
  busyState: ScoutBusyState;
  items: ConversationItem[];
  isStreaming: boolean;
  toolExecutionsById: Record<string, ToolExecutionState>;
  className?: string;
  showScrollToBottomButton?: boolean;
}

export function ConversationView({
  busyState,
  items,
  isStreaming,
  toolExecutionsById,
  className,
  showScrollToBottomButton = false,
}: ConversationViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const hasAutoScrolledRef = useRef(false);
  const scheduledScrollRef = useRef<number | null>(null);
  const [isScrollToBottomVisible, setIsScrollToBottomVisible] = useState(false);
  const rows = useMemo(
    () => buildConversationRows({ items, isStreaming, toolExecutionsById }),
    [items, isStreaming, toolExecutionsById],
  );
  const runtimeStatusKey = getRuntimeStatusKey(busyState);

  const cancelScheduledScroll = useCallback(() => {
    if (scheduledScrollRef.current === null) return;
    window.cancelAnimationFrame(scheduledScrollRef.current);
    scheduledScrollRef.current = null;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const element = scrollContainerRef.current;
    if (!element) return;

    if (typeof element.scrollTo === 'function') {
      element.scrollTo({ top: element.scrollHeight, behavior });
    } else {
      element.scrollTop = element.scrollHeight;
    }
    shouldStickToBottomRef.current = true;
    setIsScrollToBottomVisible(false);
  }, []);
  const animateScrollToBottom = useCallback(() => {
    const element = scrollContainerRef.current;
    if (!element || typeof window.requestAnimationFrame !== 'function') {
      scrollToBottom();
      return;
    }

    cancelScheduledScroll();

    const startTop = element.scrollTop;
    const targetTop = getScrollBottomTop(element);
    const distance = targetTop - startTop;
    if (Math.abs(distance) <= STICKY_SCROLL_THRESHOLD_PX) {
      scrollToBottom();
      return;
    }

    let startTime: number | undefined;
    const duration = getScrollToBottomAnimationDuration(Math.abs(distance));
    const step = (timestamp: number) => {
      startTime ??= timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(1, elapsed / duration);
      element.scrollTop = startTop + distance * easeInOutSine(progress);

      if (progress < 1) {
        scheduledScrollRef.current = window.requestAnimationFrame(step);
        return;
      }

      scheduledScrollRef.current = null;
      element.scrollTop = targetTop;
      setIsScrollToBottomVisible(false);
    };

    shouldStickToBottomRef.current = true;
    scheduledScrollRef.current = window.requestAnimationFrame(step);
  }, [cancelScheduledScroll, scrollToBottom]);

  const scheduleScrollToBottom = useCallback(() => {
    cancelScheduledScroll();
    scrollToBottom();

    if (typeof window.requestAnimationFrame !== 'function') return;
    scheduledScrollRef.current = window.requestAnimationFrame(() => {
      scheduledScrollRef.current = null;
      scrollToBottom();
    });
  }, [cancelScheduledScroll, scrollToBottom]);

  const updateStickiness = useCallback(() => {
    const element = scrollContainerRef.current;
    if (!element) return;

    const isNearBottom = getIsNearBottom(element);
    shouldStickToBottomRef.current = isNearBottom;
    setIsScrollToBottomVisible(showScrollToBottomButton && !isNearBottom);
  }, [showScrollToBottomButton]);

  useLayoutEffect(() => {
    const shouldScroll = !hasAutoScrolledRef.current || shouldStickToBottomRef.current;
    hasAutoScrolledRef.current = true;
    if (!shouldScroll) {
      updateStickiness();
      return undefined;
    }

    scheduleScrollToBottom();
    return cancelScheduledScroll;
  }, [cancelScheduledScroll, rows, runtimeStatusKey, scheduleScrollToBottom, updateStickiness]);

  return (
    <div className={cn('relative min-h-0 min-w-0 w-full flex-1', className)}>
      <ScrollArea
        className="h-full min-h-0 min-w-0 w-full"
        type="always"
        viewportClassName="scout-conversation-viewport"
        viewportRef={scrollContainerRef}
        viewportProps={{
          'aria-label': '会话滚动区域',
          onScroll: updateStickiness,
        }}
      >
        <div className="scout-conversation-content flex w-full min-w-0 max-w-full flex-col gap-3 overflow-x-hidden px-2.5 py-2 pb-2 sm:px-3 md:px-4 md:py-3 md:pb-2">
          {rows.map((row) => (
            <ConversationRowItem key={row.key} row={row} />
          ))}
          <RuntimeInlineStatus busyState={busyState} />
        </div>
      </ScrollArea>
      {showScrollToBottomButton && isScrollToBottomVisible ? (
        <ScrollToBottomButton onClick={animateScrollToBottom} />
      ) : null}
    </div>
  );
}

function ScrollToBottomButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="滚动到底部"
              className="border-border/70 bg-background/95 text-muted-foreground pointer-events-auto rounded-full shadow-md backdrop-blur hover:bg-muted hover:text-foreground"
              size="icon-sm"
              type="button"
              variant="outline"
              onClick={onClick}
            >
              <ArrowDown />
            </Button>
          </TooltipTrigger>
          <TooltipContent>滚动到底部</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

function getIsNearBottom(element: HTMLElement): boolean {
  const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
  return distanceToBottom <= STICKY_SCROLL_THRESHOLD_PX;
}

function getScrollBottomTop(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function getScrollToBottomAnimationDuration(distance: number): number {
  return Math.min(
    MAX_SCROLL_TO_BOTTOM_ANIMATION_MS,
    Math.max(MIN_SCROLL_TO_BOTTOM_ANIMATION_MS, 420 + distance / 4),
  );
}

function easeInOutSine(progress: number): number {
  return -(Math.cos(Math.PI * progress) - 1) / 2;
}

function RuntimeInlineStatus({ busyState }: { busyState: ScoutBusyState }) {
  const display = getRuntimeInlineDisplay(busyState);
  if (!display) return null;

  return (
    <div
      className="text-muted-foreground flex min-w-0 max-w-full flex-col items-center gap-1 px-9 py-2.5 text-center"
      data-runtime-inline-status={busyState.kind}
    >
      <div className="flex w-full min-w-0 items-center gap-3">
        <span className="bg-border/80 h-px min-w-0 flex-1" />
        <span className="shrink-0 text-[13px] font-medium leading-5">{display.label}</span>
        <span className="bg-border/80 h-px min-w-0 flex-1" />
      </div>
      {display.detail ? (
        <span className="max-w-full text-[11px] leading-4 break-words [overflow-wrap:anywhere]">
          {display.detail}
        </span>
      ) : null}
    </div>
  );
}

function getRuntimeInlineDisplay(
  busyState: ScoutBusyState,
): { label: string; detail: string } | null {
  if (busyState.kind === 'compaction') {
    return {
      label: '正在压缩上下文',
      detail: formatCompactionReason(busyState.reason),
    };
  }

  if (busyState.kind === 'retry') {
    const attempt =
      busyState.attempt !== undefined && busyState.maxAttempts !== undefined
        ? `${busyState.attempt}/${busyState.maxAttempts}`
        : '';
    return {
      label: attempt ? `正在重试 ${attempt}` : '正在重试',
      detail: busyState.reason ?? '',
    };
  }

  return null;
}

function formatCompactionReason(reason: string | undefined): string {
  if (reason === 'manual') return '手动';
  if (reason === 'threshold') return '上下文接近上限';
  if (reason === 'overflow') return '上下文溢出恢复';
  return reason ?? '';
}

function getRuntimeStatusKey(busyState: ScoutBusyState): string {
  if (busyState.kind === 'compaction') {
    return `compaction:${busyState.reason ?? ''}`;
  }

  if (busyState.kind === 'retry') {
    return [
      'retry',
      busyState.attempt ?? '',
      busyState.maxAttempts ?? '',
      busyState.reason ?? '',
    ].join(':');
  }

  return 'none';
}

function ConversationRowItem({ row }: { row: ConversationRow }) {
  if (row.type === 'user') {
    return <UserMessage message={row.message} />;
  }

  if (row.type === 'assistant') {
    return <AssistantTurn row={row} />;
  }

  return <SystemBlock row={row} />;
}

function UserMessage({ message }: { message: Extract<ScoutMessage, { role: 'user' }> }) {
  return (
    <article className="flex w-full min-w-0 max-w-full justify-end">
      <div className="scout-user-message bg-foreground/[0.06] min-w-0 max-w-[77%] rounded-2xl px-3 py-2 text-left text-sm leading-5 break-words whitespace-pre-wrap shadow-sm [overflow-wrap:anywhere]">
        {contentToText(message.content)}
      </div>
    </article>
  );
}

function AssistantTurn({ row }: { row: AssistantConversationRow }) {
  const shouldShowActions = !row.isLatestAssistant || !row.isStreaming;

  return (
    <article className="scout-assistant-turn group/message flex w-full min-w-0 max-w-full flex-col">
      <div className="scout-assistant-content w-full min-w-0 max-w-full space-y-2 text-sm leading-5">
        {row.entries.map((entry) =>
          entry.type === 'content' ? (
            <AssistantContentSegment entry={entry} key={entry.key} />
          ) : (
            <AssistantProcessBlock entry={entry} key={entry.key} />
          ),
        )}
      </div>
      {shouldShowActions ? (
        <MessageActions
          persistent={row.isLatestAssistant}
          text={row.actionText}
          timestamp={row.timestamp}
        />
      ) : null}
    </article>
  );
}

function AssistantContentSegment({ entry }: { entry: AssistantContentEntry }) {
  return (
    <div className="scout-assistant-content-segment w-full min-w-0 max-w-full">
      {entry.blocks.map((content, index) => (
        <VisibleContentBlock content={content} key={`${entry.key}:${content.type}:${index}`} />
      ))}
      {entry.errorMessage ? (
        <p className="text-destructive min-w-0 max-w-full break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
          {entry.errorMessage}
        </p>
      ) : null}
    </div>
  );
}

function VisibleContentBlock({ content }: { content: AssistantVisibleContent }) {
  if (content.type === 'text') {
    return <MarkdownContent>{content.text}</MarkdownContent>;
  }

  return <ImageBlock content={content} />;
}

function ImageBlock({ content }: { content: Extract<ScoutContent, { type: 'image' }> }) {
  return (
    <img
      alt="Assistant image"
      className="border-border/70 my-3 max-h-64 max-w-full rounded-xl border object-contain sm:max-h-80"
      src={toImageSource(content)}
    />
  );
}

function SystemBlock({ row }: { row: SystemConversationRow }) {
  const [open, setOpen] = useState(row.defaultOpen);
  const hasText = row.text.trim().length > 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <article
        className={cn(
          'border-border bg-muted/30 rounded-md border px-2.5 py-1.5 text-sm',
          row.tone === 'error' && 'border-destructive/30 bg-destructive/10',
        )}
      >
        <CollapsibleTrigger
          aria-label={`${open ? '收起' : '展开'}${row.title}`}
          className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 text-left text-xs font-medium transition-colors"
          disabled={!hasText}
          type="button"
        >
          {hasText ? (
            open ? (
              <ChevronDown className="size-3.5 shrink-0" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0" />
            )
          ) : null}
          <span>{row.title}</span>
        </CollapsibleTrigger>
        {hasText ? (
          <CollapsibleContent>
            <p className="mt-1 min-w-0 max-w-full leading-5 break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
              {row.text}
            </p>
          </CollapsibleContent>
        ) : null}
      </article>
    </Collapsible>
  );
}

function MessageActions({
  persistent,
  text,
  timestamp,
}: {
  persistent: boolean;
  text: string;
  timestamp: number;
}) {
  return (
    <div
      className={cn(
        'text-muted-foreground/70 mt-1 flex flex-wrap items-center gap-0.5 text-[11px] transition-opacity',
        persistent
          ? 'opacity-100'
          : 'opacity-0 group-focus-within/message:opacity-100 group-hover/message:opacity-100',
      )}
      data-message-actions="assistant"
      data-latest-assistant-actions={persistent ? 'true' : undefined}
    >
      <Button
        aria-label="复制"
        className="rounded-full text-current"
        size="icon-xs"
        type="button"
        variant="ghost"
        onClick={() => void navigator.clipboard?.writeText(text)}
      >
        <Copy />
      </Button>
      <Button
        aria-label="赞同"
        className="rounded-full text-current"
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <ThumbsUp />
      </Button>
      <Button
        aria-label="反对"
        className="rounded-full text-current"
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <ThumbsDown />
      </Button>
      <Button
        aria-label="打开"
        className="rounded-full text-current"
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <ExternalLink />
      </Button>
      <span className="ml-1">{formatTime(timestamp)}</span>
    </div>
  );
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
