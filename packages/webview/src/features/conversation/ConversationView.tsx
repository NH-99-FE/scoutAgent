// ============================================================
// Conversation View — 会话 turn 与 assistant 过程渲染
// ============================================================

import { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import {
  Archive,
  ArrowDown,
  CircleAlert,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  LoaderCircle,
  Split,
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
import type { ToolCallPreviewState, ToolExecutionState } from '@/store/conversation-store';
import {
  createConversationRowsProjector,
  type AssistantContentEntry,
  type AssistantConversationRow,
  type AssistantOutcomeConversationRow,
  type AssistantVisibleContent,
  type ConversationRow,
  type ConversationViewItem,
  type SystemConversationRow,
} from './conversation-view-model';
import { AssistantProcessBlock } from './AssistantProcessBlock';
import { useRegisterConversationExpansionNode } from './conversation-expansion-node';
import {
  useConversationVirtualRows,
  type ConversationRowVirtualizer,
} from './use-conversation-virtual-rows';
import { MarkdownContent } from './MarkdownContent';
import { contentToText } from './tool-display';
import { useConversationAutoScroll } from './use-conversation-auto-scroll';

interface ConversationViewProps {
  busyState: ScoutBusyState;
  expansionScope?: string;
  items: ConversationViewItem[];
  isStreaming: boolean;
  toolExecutionsById: Record<string, ToolExecutionState>;
  toolPreviewsById?: Record<string, ToolCallPreviewState>;
  className?: string;
  forceScrollToBottomKey?: unknown;
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
  forceScrollToBottomKey,
  showScrollToBottomButton = false,
}: ConversationViewProps) {
  const projector = useMemo(() => createConversationRowsProjector(), []);
  const rows = useMemo(() => {
    return projector.project({
      items,
      isStreaming,
      busyState,
      toolExecutionsById,
      toolPreviewsById,
    });
  }, [projector, items, isStreaming, busyState, toolExecutionsById, toolPreviewsById]);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const virtualRows = useConversationVirtualRows({
    isStreaming,
    rows,
    scrollContainerRef,
  });
  const runtimeStatusKey = getRuntimeStatusKey(busyState);
  const { isScrollToBottomVisible, scrollToBottom, viewportHandlers, viewportRef } =
    useConversationAutoScroll({
      contentKey: rows,
      contentLayoutKey: virtualRows.scrollLayoutKey,
      forceScrollToBottomKey,
      getScrollMetrics: virtualRows.getScrollMetrics,
      runtimeStatusKey,
      scrollToBottomOverride: virtualRows.scrollToBottomOverride,
      showScrollToBottomButton,
      viewportRef: scrollContainerRef,
    });

  return (
    <div className={cn('relative min-h-0 w-full min-w-0 flex-1', className)}>
      <ScrollArea
        className="h-full min-h-0 w-full min-w-0"
        type="always"
        viewportClassName="scout-conversation-viewport"
        viewportRef={viewportRef}
        viewportProps={{
          'aria-label': '会话滚动区域',
          ...viewportHandlers,
        }}
      >
        {virtualRows.enabled ? (
          <VirtualConversationRows
            busyState={busyState}
            expansionScope={expansionScope}
            rowVirtualizer={virtualRows.rowVirtualizer}
            rows={rows}
          />
        ) : (
          <StaticConversationRows
            busyState={busyState}
            expansionScope={expansionScope}
            rows={rows}
          />
        )}
      </ScrollArea>
      {showScrollToBottomButton && isScrollToBottomVisible ? (
        <ScrollToBottomButton onClick={scrollToBottom} />
      ) : null}
    </div>
  );
}

function StaticConversationRows({
  busyState,
  expansionScope,
  rows,
}: {
  busyState: ScoutBusyState;
  expansionScope: string;
  rows: ConversationRow[];
}) {
  return (
    <div
      className="scout-conversation-content flex w-full max-w-full min-w-0 flex-col gap-3 overflow-x-hidden px-2.5 py-2 pb-2 sm:px-3 md:px-4 md:py-3 md:pb-2"
      data-scout-conversation-virtualized="false"
    >
      {rows.map((row) => (
        <ConversationRowItem expansionScope={expansionScope} key={row.key} row={row} />
      ))}
      <RuntimeInlineStatus busyState={busyState} />
      <div aria-hidden="true" className="scout-conversation-bottom-anchor h-px shrink-0" />
    </div>
  );
}

function VirtualConversationRows({
  busyState,
  expansionScope,
  rows,
  rowVirtualizer,
}: {
  busyState: ScoutBusyState;
  expansionScope: string;
  rows: ConversationRow[];
  rowVirtualizer: ConversationRowVirtualizer;
}) {
  return (
    <div
      className="scout-conversation-content w-full max-w-full min-w-0 overflow-x-hidden px-2.5 py-2 pb-2 sm:px-3 md:px-4 md:py-3 md:pb-2"
      data-scout-conversation-virtualized="true"
    >
      <div
        className="relative w-full max-w-full min-w-0"
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;

          return (
            <div
              className="absolute top-0 left-0 w-full max-w-full min-w-0 pb-3"
              data-index={virtualRow.index}
              data-scout-conversation-virtual-row="true"
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <ConversationRowItem expansionScope={expansionScope} row={row} />
            </div>
          );
        })}
      </div>
      <RuntimeInlineStatus busyState={busyState} />
      <div aria-hidden="true" className="scout-conversation-bottom-anchor h-px shrink-0" />
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

function getRuntimeStatusKey(busyState: ScoutBusyState): string {
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

  if (row.type === 'assistant_outcome') {
    return <AssistantOutcomeRow row={row} />;
  }
  return <SystemBlock row={row} />;
}

const UserMessage = memo(function UserMessage({
  message,
}: {
  message: Extract<ScoutMessage, { role: 'user' }>;
}) {
  return (
    <article className="flex w-full max-w-full min-w-0 justify-end">
      <div className="scout-user-message bg-foreground/[0.06] max-w-[77%] min-w-0 rounded-2xl px-3 py-2 text-left text-sm leading-5 [overflow-wrap:anywhere] break-words whitespace-pre-wrap shadow-sm">
        {contentToText(message.content)}
      </div>
    </article>
  );
});

interface AssistantOutcomeRenderer {
  render: (row: AssistantOutcomeConversationRow) => ReactElement;
}

// 把需要独立视觉策略的 assistant outcome 放在这里；新增 kind 时仅接入终止结果或压缩分隔提示，过程明细继续留在 process/tool 投影中。
const ASSISTANT_OUTCOME_RENDERERS: Record<
  AssistantOutcomeConversationRow['kind'],
  AssistantOutcomeRenderer
> = {
  aborted: { render: renderAssistantAbortedOutcomeRow },
  compacted: { render: renderAssistantCompactedOutcomeRow },
  compacting: { render: renderAssistantCompactingOutcomeRow },
  error: { render: renderAssistantErrorOutcomeRow },
  forked: { render: renderAssistantForkedOutcomeRow },
};

function AssistantOutcomeRow({ row }: { row: AssistantOutcomeConversationRow }) {
  return ASSISTANT_OUTCOME_RENDERERS[row.kind].render(row);
}

// 派生（fork）会话来源提示：与压缩提示同款分隔行，仅展示来源，不含动作。
function renderAssistantForkedOutcomeRow(row: AssistantOutcomeConversationRow): ReactElement {
  return (
    <article className="max-w-full min-w-0 px-1 py-2.5" data-assistant-outcome-kind={row.kind}>
      <AssistantOutcomeDivider row={row} icon={<Split className="size-3.5 shrink-0" />} />
    </article>
  );
}

function renderAssistantAbortedOutcomeRow(row: AssistantOutcomeConversationRow): ReactElement {
  return (
    <article
      className="border-border/70 flex w-full max-w-full min-w-0 justify-end border-b pb-2"
      data-assistant-outcome-kind={row.kind}
      data-manual-abort-notice="true"
    >
      <span className="text-muted-foreground max-w-[77%] min-w-0 text-right text-xs leading-5 [overflow-wrap:anywhere] break-words">
        {row.text}
      </span>
    </article>
  );
}

function renderAssistantCompactingOutcomeRow(row: AssistantOutcomeConversationRow): ReactElement {
  return (
    <article className="max-w-full min-w-0 px-1 py-2.5" data-assistant-outcome-kind={row.kind}>
      <AssistantOutcomeDivider
        row={row}
        icon={<LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin" />}
      />
    </article>
  );
}

function renderAssistantCompactedOutcomeRow(row: AssistantOutcomeConversationRow): ReactElement {
  if (row.kind !== 'compacted') return renderAssistantCompactingOutcomeRow(row);
  const markdown = row.markdown.trim();

  return (
    <article
      className="flex max-w-full min-w-0 flex-col gap-2 px-1 py-2.5"
      data-assistant-outcome-kind={row.kind}
    >
      <AssistantOutcomeDivider row={row} icon={<Archive className="size-3.5 shrink-0" />} />
      {markdown ? (
        <MarkdownContent className="text-foreground/90 text-[13px] leading-5">
          {row.markdown}
        </MarkdownContent>
      ) : null}
    </article>
  );
}

function AssistantOutcomeDivider({
  row,
  icon,
}: {
  row: AssistantOutcomeConversationRow;
  icon?: ReactElement;
}): ReactElement {
  return (
    <div className="text-muted-foreground flex max-w-full min-w-0 items-center gap-3 text-center">
      <span className="bg-border/80 h-px min-w-0 flex-1" />
      <span className="inline-flex min-w-0 shrink-0 items-center gap-1.5 text-[13px] leading-5 font-medium">
        {icon}
        <span className="min-w-0 truncate">{row.text}</span>
      </span>
      <span className="bg-border/80 h-px min-w-0 flex-1" />
    </div>
  );
}

function renderAssistantErrorOutcomeRow(row: AssistantOutcomeConversationRow): ReactElement {
  return (
    <article
      className="border-border/70 text-muted-foreground flex w-full max-w-full min-w-0 items-center gap-2 rounded-2xl border px-3 py-2.5 text-xs leading-5 [overflow-wrap:anywhere] break-words"
      data-assistant-error-notice="true"
      data-assistant-outcome-kind={row.kind}
    >
      <CircleAlert className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{row.text}</span>
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
        <div className="text-muted-foreground/80 mb-1 inline-flex min-h-5 max-w-full min-w-0 items-center gap-1.5 rounded text-left text-xs leading-5">
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
          'text-muted-foreground/80 hover:text-muted-foreground focus-visible:text-muted-foreground mb-1 inline-flex min-h-5 max-w-full min-w-0 items-center gap-1.5 rounded text-left text-xs leading-5 transition-colors',
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
        ) : (
          <Collapsible key={entry.key} open={showProcessEntries}>
            <CollapsibleContent className="scout-process-collapse-content">
              <AssistantProcessBlock
                entry={entry}
                expansionScope={expansionScope}
                parentExpansionId={parentExpansionId}
                suppressLifecycleOnlyProcess={row.isStreaming}
              />
            </CollapsibleContent>
          </Collapsible>
        ),
      )}
    </>
  );
}

const AssistantContentSegment = memo(function AssistantContentSegment({
  entry,
}: {
  entry: AssistantContentEntry;
}) {
  return (
    <div className="scout-assistant-content-segment w-full max-w-full min-w-0">
      {entry.blocks.map((content, index) => (
        <MemoizedVisibleContentBlock
          content={content}
          key={`${entry.key}:${content.type}:${index}`}
        />
      ))}
    </div>
  );
});

function VisibleContentBlock({ content }: { content: AssistantVisibleContent }) {
  if (content.type === 'text') {
    return <MarkdownContent>{content.text}</MarkdownContent>;
  }

  return <ImageBlock content={content} />;
}

const MemoizedVisibleContentBlock = memo(
  VisibleContentBlock,
  (previous, next) => previous.content === next.content,
);

function ImageBlock({ content }: { content: Extract<ScoutContent, { type: 'image' }> }) {
  return (
    <img
      alt="Assistant image"
      className="border-border/70 my-3 max-h-64 max-w-full rounded-xl border object-contain sm:max-h-80"
      src={toImageSource(content)}
    />
  );
}

const SystemBlock = memo(function SystemBlock({ row }: { row: SystemConversationRow }) {
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
});

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
