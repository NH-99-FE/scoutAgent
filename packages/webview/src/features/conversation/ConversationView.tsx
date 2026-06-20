// ============================================================
// Conversation View — 会话 turn 与 assistant 过程渲染
// ============================================================

import { useCallback, useMemo, useState } from 'react';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  getAssistantTurnExpansionId,
  getConversationExpansionScope,
  useConversationExpansionOpen,
  useConversationExpansionStore,
} from '@/store/conversation-expansion-store';
import type {
  ConversationItem,
  ToolCallPreviewState,
  ToolExecutionState,
} from '@/store/conversation-store';
import {
  buildConversationRows,
  type AssistantContentEntry,
  type AssistantConversationRow,
  type AssistantVisibleContent,
  type ConversationRow,
  type SystemConversationRow,
} from './conversation-view-model';
import { AssistantProcessBlock } from './AssistantProcessBlock';
import { useRegisterConversationExpansionNode } from './conversation-expansion-node';
import { MarkdownContent } from './MarkdownContent';
import { contentToText } from './tool-display';
import { useConversationAutoScroll } from './use-conversation-auto-scroll';

interface ConversationViewProps {
  busyState: ScoutBusyState;
  expansionScope?: string;
  items: ConversationItem[];
  isStreaming: boolean;
  toolExecutionsById: Record<string, ToolExecutionState>;
  toolPreviewsById?: Record<string, ToolCallPreviewState>;
  className?: string;
  showScrollToBottomButton?: boolean;
}

const EMPTY_TOOL_PREVIEWS: Record<string, ToolCallPreviewState> = {};

export function ConversationView({
  busyState,
  expansionScope = getConversationExpansionScope({}),
  items,
  isStreaming,
  toolExecutionsById,
  toolPreviewsById = EMPTY_TOOL_PREVIEWS,
  className,
  showScrollToBottomButton = false,
}: ConversationViewProps) {
  const rows = useMemo(
    () =>
      buildConversationRows({
        items,
        isStreaming,
        busyState,
        toolExecutionsById,
        toolPreviewsById,
      }),
    [items, isStreaming, busyState, toolExecutionsById, toolPreviewsById],
  );
  const runtimeStatusKey = getRuntimeStatusKey(busyState);
  const {
    isScrollToBottomVisible,
    scrollToBottom,
    viewportHandlers,
    viewportRef: scrollContainerRef,
  } = useConversationAutoScroll({
    contentKey: rows,
    runtimeStatusKey,
    showScrollToBottomButton,
  });

  return (
    <div className={cn('relative min-h-0 w-full min-w-0 flex-1', className)}>
      <ScrollArea
        className="h-full min-h-0 w-full min-w-0"
        type="always"
        viewportClassName="scout-conversation-viewport"
        viewportRef={scrollContainerRef}
        viewportProps={{
          'aria-label': '会话滚动区域',
          ...viewportHandlers,
        }}
      >
        <div className="scout-conversation-content flex w-full max-w-full min-w-0 flex-col gap-3 overflow-x-hidden px-2.5 py-2 pb-2 sm:px-3 md:px-4 md:py-3 md:pb-2">
          {rows.map((row) => (
            <ConversationRowItem expansionScope={expansionScope} key={row.key} row={row} />
          ))}
          <RuntimeInlineStatus busyState={busyState} />
          <div aria-hidden="true" className="scout-conversation-bottom-anchor h-px shrink-0" />
        </div>
      </ScrollArea>
      {showScrollToBottomButton && isScrollToBottomVisible ? (
        <ScrollToBottomButton onClick={scrollToBottom} />
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
              className="border-border/70 bg-background/95 text-muted-foreground hover:bg-muted hover:text-foreground pointer-events-auto rounded-full shadow-md backdrop-blur"
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

function RuntimeInlineStatus({ busyState }: { busyState: ScoutBusyState }) {
  const display = getRuntimeInlineDisplay(busyState);
  if (!display) return null;

  return (
    <div
      className="text-muted-foreground flex max-w-full min-w-0 flex-col items-center gap-1 px-9 py-2.5 text-center"
      data-runtime-inline-status={busyState.kind}
    >
      <div className="flex w-full min-w-0 items-center gap-3">
        <span className="bg-border/80 h-px min-w-0 flex-1" />
        <span className="shrink-0 text-[13px] leading-5 font-medium">{display.label}</span>
        <span className="bg-border/80 h-px min-w-0 flex-1" />
      </div>
      {display.detail ? (
        <span className="max-w-full text-[11px] leading-4 [overflow-wrap:anywhere] break-words">
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
      label: '压缩中',
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

function ConversationRowItem({
  expansionScope,
  row,
}: {
  expansionScope: string;
  row: ConversationRow;
}) {
  if (row.type === 'user') {
    return <UserMessage message={row.message} />;
  }

  if (row.type === 'assistant') {
    return <AssistantTurn expansionScope={expansionScope} row={row} />;
  }

  if (row.type === 'manual_abort') {
    return <ManualAbortNotice label={row.label} />;
  }

  return <SystemBlock row={row} />;
}

function UserMessage({ message }: { message: Extract<ScoutMessage, { role: 'user' }> }) {
  return (
    <article className="flex w-full max-w-full min-w-0 justify-end">
      <div className="scout-user-message bg-foreground/[0.06] max-w-[77%] min-w-0 rounded-2xl px-3 py-2 text-left text-sm leading-5 [overflow-wrap:anywhere] break-words whitespace-pre-wrap shadow-sm">
        {contentToText(message.content)}
      </div>
    </article>
  );
}

function ManualAbortNotice({ label }: { label: string }) {
  return (
    <article
      className="border-border/70 flex w-full max-w-full min-w-0 justify-end border-b pb-2"
      data-manual-abort-notice="true"
    >
      <span className="text-muted-foreground max-w-[77%] min-w-0 text-right text-xs leading-5 [overflow-wrap:anywhere] break-words">
        {label}
      </span>
    </article>
  );
}

function AssistantTurn({
  expansionScope,
  row,
}: {
  expansionScope: string;
  row: AssistantConversationRow;
}) {
  const shouldShowActions = !row.isLatestAssistant || !row.isStreaming;
  const expansionId = getAssistantTurnExpansionId(row.key, expansionScope);
  const open = useConversationExpansionOpen(expansionId, true);
  const turnSummary = row.turnSummary;

  useRegisterConversationExpansionNode({
    id: expansionId,
    kind: 'assistant_turn',
  });

  const handleToggleProcessVisibility = useCallback(() => {
    const { actions } = useConversationExpansionStore.getState();
    actions.setExpanded(expansionId, !open);
  }, [expansionId, open]);

  const content = (
    <>
      <div className="scout-assistant-content w-full max-w-full min-w-0 space-y-2 text-sm leading-5">
        <AssistantTurnEntries
          parentExpansionId={expansionId}
          row={row}
          expansionScope={expansionScope}
          showProcessEntries={!turnSummary || turnSummary.running || open}
        />
      </div>
      {shouldShowActions ? (
        <MessageActions
          persistent={row.isLatestAssistant}
          text={row.actionText}
          timestamp={row.timestamp}
        />
      ) : null}
    </>
  );

  if (!turnSummary) {
    return (
      <article className="scout-assistant-turn group/message flex w-full max-w-full min-w-0 flex-col">
        {content}
      </article>
    );
  }

  if (turnSummary.running) {
    return (
      <article className="scout-assistant-turn group/message flex w-full max-w-full min-w-0 flex-col">
        <div className="text-muted-foreground/80 mb-1 -ml-1 inline-flex min-h-5 max-w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs leading-5">
          <span className="min-w-0 truncate">{turnSummary.label}</span>
        </div>
        {content}
      </article>
    );
  }

  return (
    <article className="scout-assistant-turn group/message flex w-full max-w-full min-w-0 flex-col">
      <button
        aria-expanded={open}
        aria-label={`${open ? '收起' : '展开'}回复 ${turnSummary.label}`}
        className={cn(
          'text-muted-foreground/80 hover:text-muted-foreground focus-visible:text-muted-foreground mb-1 -ml-1 inline-flex min-h-5 max-w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs leading-5 transition-colors',
          turnSummary.tone === 'error' && 'text-destructive hover:text-destructive',
        )}
        type="button"
        onClick={handleToggleProcessVisibility}
      >
        <span className="min-w-0 truncate">{turnSummary.label}</span>
        {open ? (
          <ChevronDown className="size-3.5 shrink-0" data-assistant-turn-disclosure-icon />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" data-assistant-turn-disclosure-icon />
        )}
      </button>
      {content}
    </article>
  );
}

function AssistantTurnEntries({
  expansionScope,
  parentExpansionId,
  row,
  showProcessEntries,
}: {
  expansionScope: string;
  parentExpansionId: string;
  row: AssistantConversationRow;
  showProcessEntries: boolean;
}) {
  return (
    <>
      {row.entries.map((entry) =>
        entry.type === 'content' ? (
          <AssistantContentSegment entry={entry} key={entry.key} />
        ) : showProcessEntries ? (
          <AssistantProcessBlock
            entry={entry}
            expansionScope={expansionScope}
            key={entry.key}
            parentExpansionId={parentExpansionId}
            suppressLifecycleOnlyProcess={row.isStreaming}
          />
        ) : null,
      )}
    </>
  );
}

function AssistantContentSegment({ entry }: { entry: AssistantContentEntry }) {
  return (
    <div className="scout-assistant-content-segment w-full max-w-full min-w-0">
      {entry.blocks.map((content, index) => (
        <VisibleContentBlock content={content} key={`${entry.key}:${content.type}:${index}`} />
      ))}
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
            <p className="mt-1 max-w-full min-w-0 leading-5 [overflow-wrap:anywhere] break-words whitespace-pre-wrap">
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
