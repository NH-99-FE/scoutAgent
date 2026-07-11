// ============================================================
// Conversation Transcript — 可滚动 transcript 行渲染
// ============================================================

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import {
  Archive,
  Box,
  CircleAlert,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileDiff,
  LoaderCircle,
  Split,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import type { ScoutContent, ScoutMessage } from '@scout-agent/shared';
import { ImagePreviewDialog } from '@/components/common/ImagePreviewDialog';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { protocolClient } from '@/bridge/protocol-client';
import { cn } from '@/lib/utils';
import {
  getAssistantTurnExpansionId,
  useConversationExpansionOpen,
  useConversationExpansionStore,
} from '@/store/conversation-expansion-store';
import {
  type AssistantChangesReview,
  type AssistantContentEntry,
  type AssistantConversationRow,
  type AssistantOutcomeConversationRow,
  type AssistantVisibleContent,
  type SystemConversationRow,
} from '../render-model/conversation-view-model';
import { AssistantProcessBlock } from './AssistantProcessBlock';
import { ConversationScrollerContent, ConversationScrollerItem } from './ConversationScroller';
import {
  type ConversationExtensionRequestsTranscriptRow,
  type ConversationRuntimeStatusTranscriptRow,
  type ConversationTranscriptRow,
} from '../render-model/conversation-transcript-rows';
import { ConversationExtensionRequestsPanel } from './ConversationExtensionRequestsPanel';
import { useRegisterConversationExpansionNode } from './conversation-expansion-node';
import { MarkdownContent } from './MarkdownContent';
import { adaptUserMessageImagePreviewItems } from './user-message-image-adapter';
import { contentToText } from '../tool-display';

const CHANGES_REVIEW_VISIBLE_FILE_LIMIT = 3;

interface ConversationTranscriptProps {
  expansionScope: string;
  isStreaming: boolean;
  rows: ConversationTranscriptRow[];
}

export function ConversationTranscript({
  expansionScope,
  isStreaming,
  rows,
}: ConversationTranscriptProps) {
  return (
    <ConversationScrollerContent aria-busy={isStreaming}>
      {rows.map((row) => (
        <MemoizedConversationTranscriptRow
          expansionScope={expansionScope}
          key={row.key}
          row={row}
        />
      ))}
    </ConversationScrollerContent>
  );
}

function ConversationTranscriptRowView({
  expansionScope,
  row,
}: {
  expansionScope: string;
  row: ConversationTranscriptRow;
}) {
  return (
    <ConversationScrollerItem className={getScrollerItemClassName(row)} messageId={row.key}>
      <ConversationRowItem expansionScope={expansionScope} row={row} />
    </ConversationScrollerItem>
  );
}

// 依赖投影层复用未变化 row 的对象引用；把 item 与 body 放在同一 memo 边界内，避免新的 children identity 击穿 memo。
const MemoizedConversationTranscriptRow = memo(
  ConversationTranscriptRowView,
  (previous, next) => previous.row === next.row && previous.expansionScope === next.expansionScope,
);

function getScrollerItemClassName(row: ConversationTranscriptRow): string | undefined {
  if (row.type === 'extension_requests' || row.type === 'runtime_status') {
    return 'w-full max-w-full min-w-0';
  }
  return undefined;
}

function RuntimeInlineStatus({ row }: { row: ConversationRuntimeStatusTranscriptRow }) {
  return (
    <div
      className="text-muted-foreground flex max-w-full min-w-0 flex-col items-center gap-1 px-9 py-2.5 text-center"
      data-runtime-inline-status={row.statusKind}
    >
      <div className="flex w-full min-w-0 items-center gap-3">
        <span className="bg-border/80 h-px min-w-0 flex-1" />
        <span className="shrink-0 text-[13px] leading-5 font-medium">{row.label}</span>
        <span className="bg-border/80 h-px min-w-0 flex-1" />
      </div>
      {row.detail ? (
        <span className="max-w-full text-[11px] leading-4 [overflow-wrap:anywhere] break-words">
          {row.detail}
        </span>
      ) : null}
    </div>
  );
}

function ConversationRowItem({
  expansionScope,
  row,
}: {
  expansionScope: string;
  row: ConversationTranscriptRow;
}) {
  if (row.type === 'extension_requests') {
    return <ExtensionRequestsRow row={row} />;
  }

  if (row.type === 'runtime_status') {
    return <RuntimeInlineStatus row={row} />;
  }

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

function ExtensionRequestsRow({ row }: { row: ConversationExtensionRequestsTranscriptRow }) {
  return <ConversationExtensionRequestsPanel requests={row.requests} />;
}

const UserMessage = memo(function UserMessage({
  message,
}: {
  message: Extract<ScoutMessage, { role: 'user' }>;
}) {
  const structuredContent = Array.isArray(message.content) ? message.content : null;
  const images = structuredContent?.filter(isImageContent) ?? [];
  const bubbleContent = structuredContent?.filter((item) => item.type !== 'image') ?? null;
  const text = contentToText(bubbleContent ?? message.content);
  const hasBubbleContent = bubbleContent
    ? bubbleContent.some(hasRenderableUserContent)
    : typeof message.content === 'string' && message.content.trim().length > 0;
  return (
    <article className="group/message flex w-full max-w-full min-w-0 flex-col items-end">
      {images.length > 0 ? <UserMessageImageTray images={images} /> : null}
      {hasBubbleContent ? (
        <div className="scout-user-message bg-user-message max-w-[77%] min-w-0 rounded-2xl px-3 py-2 text-left text-sm leading-5 [overflow-wrap:anywhere] break-words whitespace-pre-wrap shadow-sm">
          {bubbleContent ? <UserStructuredContent content={bubbleContent} /> : text}
        </div>
      ) : null}
      <UserMessageActions text={text} timestamp={message.timestamp} />
    </article>
  );
});

function UserMessageImageTray({ images }: { images: Extract<ScoutContent, { type: 'image' }>[] }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null);
  const previewItems = adaptUserMessageImagePreviewItems(images);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollLeft = viewport.scrollWidth;
  }, [images.length]);

  return (
    <>
      <ScrollArea
        className="scout-user-image-tray mb-1 w-full max-w-full min-w-0 [&_[data-slot=scroll-area-scrollbar]]:hidden"
        scrollbars="horizontal"
        viewportClassName="overflow-x-auto overflow-y-hidden"
        viewportRef={viewportRef}
      >
        <div className="flex w-max min-w-full flex-nowrap justify-end gap-2 px-1 pt-1 pb-1">
          {previewItems.map((item, index) => (
            <button
              aria-label={item.previewButtonLabel}
              className="border-border bg-muted focus-visible:border-ring focus-visible:ring-ring/40 block size-20 shrink-0 cursor-pointer overflow-hidden rounded-xl border text-left transition-colors outline-none focus-visible:ring-2"
              key={item.key}
              type="button"
              onClick={() => setPreviewImageIndex(index)}
            >
              <img
                alt={item.thumbnailAlt}
                className="size-full object-cover"
                draggable={false}
                src={item.source}
              />
            </button>
          ))}
        </div>
      </ScrollArea>

      {previewImageIndex !== null ? (
        <ImagePreviewDialog
          imageIndex={previewImageIndex}
          images={previewItems}
          onClose={() => setPreviewImageIndex(null)}
          onDownload={(index) => {
            const image = images[index];
            const previewItem = previewItems[index];
            if (!image || !previewItem) return;
            protocolClient.downloadImage(image, previewItem.downloadName);
          }}
          onImageIndexChange={setPreviewImageIndex}
        />
      ) : null}
    </>
  );
}

function isImageContent(
  content: ScoutContent,
): content is Extract<ScoutContent, { type: 'image' }> {
  return content.type === 'image';
}

function hasRenderableUserContent(content: ScoutContent): boolean {
  if (content.type === 'text') return content.text.trim().length > 0;
  return content.type !== 'image' && contentToText([content]).trim().length > 0;
}

function UserStructuredContent({ content }: { content: ScoutContent[] }) {
  return (
    <div className="flex max-w-full min-w-0 flex-col gap-2">
      {content.map((item, index) => {
        if (item.type === 'skillInvocation') {
          return <SkillInvocationBlock key={`skill-${index}-${item.name}`} skill={item} />;
        }
        if (item.type === 'text' && item.text.trim()) {
          return (
            <div key={`text-${index}`} className="whitespace-pre-wrap">
              {item.text}
            </div>
          );
        }
        const fallbackText = contentToText([item]);
        if (fallbackText) {
          return (
            <div key={`fallback-${index}`} className="whitespace-pre-wrap">
              {fallbackText}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function SkillInvocationBlock({
  skill,
}: {
  skill: Extract<ScoutContent, { type: 'skillInvocation' }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-primary/15 bg-background/75 text-foreground max-w-full min-w-0 overflow-hidden rounded-md border shadow-sm">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            className="hover:bg-muted/70 flex w-full min-w-0 items-center gap-2 px-2.5 py-2 text-left"
            type="button"
          >
            {open ? (
              <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
            ) : (
              <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
            )}
            <Box className="text-primary size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold">{skill.name}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-border/70 border-t px-2.5 py-2">
            <div className="text-muted-foreground mb-2 max-w-full truncate text-[11px]">
              {skill.location}
            </div>
            <pre className="bg-muted/70 max-h-64 overflow-auto rounded p-2 text-[11px] leading-4 whitespace-pre-wrap">
              {skill.content}
            </pre>
          </div>
        </CollapsibleContent>
      </Collapsible>
      {skill.userMessage ? (
        <div className="border-border/70 border-t px-2.5 py-2 text-sm leading-5 whitespace-pre-wrap">
          {skill.userMessage}
        </div>
      ) : null}
    </div>
  );
}

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
  const open = useConversationExpansionOpen(expansionId, getAssistantTurnDefaultOpen(row));
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
        <AssistantChangesReviewList reviews={row.changesReviews} />
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
      <div className="border-border/60 mb-2 border-b pb-1.5">
        <button
          aria-expanded={open}
          aria-label={`${open ? '收起' : '展开'}回复 ${turnSummary.label}`}
          className={cn(
            'text-muted-foreground/80 hover:text-muted-foreground focus-visible:text-muted-foreground inline-flex min-h-5 max-w-full min-w-0 items-center gap-1.5 rounded text-left text-xs leading-5 transition-colors',
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
      </div>
      {content}
    </article>
  );
}

function getAssistantTurnDefaultOpen(row: AssistantConversationRow): boolean {
  const summary = row.turnSummary;
  if (!summary) return true;
  if (summary.running) return true;
  if (summary.status === 'failed' || summary.status === 'stopped') return true;
  return row.entries.some((entry) => entry.type === 'process' && entry.defaultOpen);
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

function AssistantChangesReviewList({ reviews }: { reviews: AssistantChangesReview[] }) {
  if (reviews.length === 0) return null;
  return (
    <div className="flex max-w-full min-w-0 flex-col gap-2 pt-1" data-changes-review-list="true">
      {reviews.map((review) => (
        <AssistantChangesReviewCard key={review.key} review={review} />
      ))}
    </div>
  );
}

function AssistantChangesReviewCard({ review }: { review: AssistantChangesReview }) {
  const [expanded, setExpanded] = useState(false);
  const hiddenFileCount = Math.max(0, review.files.length - CHANGES_REVIEW_VISIBLE_FILE_LIMIT);
  const visibleFiles = expanded
    ? review.files
    : review.files.slice(0, CHANGES_REVIEW_VISIBLE_FILE_LIMIT);

  return (
    <div className="border-border/80 bg-surface-subtle max-w-[32rem] overflow-hidden rounded-lg border shadow-sm">
      <div className="border-border/70 flex min-h-11 items-center gap-2.5 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 text-[13px] leading-5 font-semibold">
            <FileDiff
              aria-hidden="true"
              className="text-muted-foreground size-3.5 shrink-0"
              strokeWidth={2}
            />
            <span className="min-w-0 truncate">已编辑 {review.fileCount} 个文件</span>
            <span className="text-diff-added shrink-0 font-mono">+{review.additions}</span>
            {review.deletions > 0 ? (
              <span className="text-diff-removed shrink-0 font-mono">-{review.deletions}</span>
            ) : null}
          </div>
        </div>
        <Button
          aria-label="Review Changes"
          className="text-foreground hover:text-foreground h-7 rounded-md px-2.5 text-xs font-medium shadow-none"
          data-changes-review-button="true"
          type="button"
          variant="ghost"
          onClick={() => protocolClient.openChangesReview(review.turnId)}
        >
          审核
        </Button>
      </div>
      <div className="flex flex-col gap-0.5 px-3 py-2">
        {visibleFiles.map((file) => (
          <AssistantChangesReviewFileRow file={file} key={file.path} />
        ))}
        {!expanded && hiddenFileCount > 0 ? (
          <button
            className="text-foreground hover:text-foreground/80 flex min-h-7 w-fit cursor-pointer items-center gap-1 border-0 bg-transparent px-0 pt-1 text-sm font-medium"
            onClick={() => setExpanded(true)}
            type="button"
          >
            <span>再显示 {hiddenFileCount} 个文件</span>
            <ChevronDown className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AssistantChangesReviewFileRow({
  file,
}: {
  file: AssistantChangesReview['files'][number];
}) {
  const displayPath = file.displayPath ?? file.path;
  const pathParts = getReviewPathParts(displayPath);
  return (
    <div className="flex min-h-6 items-center gap-2 text-xs leading-5">
      <span className="flex min-w-0 flex-1 items-baseline">
        {pathParts.directoryPrefix ? (
          <span className="text-muted-foreground min-w-0 truncate">
            {pathParts.directoryPrefix}
          </span>
        ) : null}
        <span
          className={cn(
            'text-foreground min-w-0 truncate font-medium',
            pathParts.directoryPrefix ? 'max-w-[70%] shrink-0' : 'flex-1',
          )}
        >
          {pathParts.fileName}
        </span>
      </span>
      <span className="text-diff-added shrink-0 font-mono text-xs font-semibold">
        +{file.additions}
      </span>
      {file.deletions > 0 ? (
        <span className="text-diff-removed shrink-0 font-mono text-xs font-semibold">
          -{file.deletions}
        </span>
      ) : null}
    </div>
  );
}

function getReviewPathParts(path: string): { directoryPrefix: string; fileName: string } {
  const normalized = path.replace(/\\/g, '/');
  const lastSeparatorIndex = normalized.lastIndexOf('/');
  if (lastSeparatorIndex < 0) {
    return { directoryPrefix: '', fileName: path };
  }
  return {
    directoryPrefix: normalized.slice(0, lastSeparatorIndex + 1),
    fileName: normalized.slice(lastSeparatorIndex + 1) || path,
  };
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

function ImageBlock({
  alt = 'Assistant image',
  content,
}: {
  alt?: string;
  content: Extract<ScoutContent, { type: 'image' }>;
}) {
  return (
    <img
      alt={alt}
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

function CopyActionButton({ text }: { text: string }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const copyResetTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== undefined) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  const setTemporaryCopyState = useCallback((state: 'copied' | 'failed') => {
    setCopyState(state);
    setTooltipOpen(true);
    if (copyResetTimerRef.current !== undefined) {
      window.clearTimeout(copyResetTimerRef.current);
    }
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopyState('idle');
      copyResetTimerRef.current = undefined;
    }, 1600);
  }, []);

  const handleCopy = useCallback(() => {
    protocolClient.copyText(
      text,
      (payload) => {
        setTemporaryCopyState(payload.success ? 'copied' : 'failed');
      },
      () => {
        setTemporaryCopyState('failed');
      },
    );
  }, [setTemporaryCopyState, text]);

  const copyLabel =
    copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制';

  return (
    <TooltipProvider>
      <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <Button
            aria-label={copyLabel}
            className="rounded-full text-current"
            size="icon-xs"
            type="button"
            variant="ghost"
            onClick={handleCopy}
          >
            {copyState === 'copied' ? (
              <Check />
            ) : copyState === 'failed' ? (
              <CircleAlert />
            ) : (
              <Copy />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copyLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function UserMessageActions({ text, timestamp }: { text: string; timestamp: number }) {
  return (
    <div
      className="text-muted-foreground/70 mt-1 flex items-center gap-0.5 text-[11px] opacity-0 transition-opacity group-hover/message:opacity-100 has-[:focus-visible]:opacity-100"
      data-message-actions="user"
    >
      <span className="mr-1">{formatTime(timestamp)}</span>
      {text ? <CopyActionButton text={text} /> : null}
    </div>
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
          : 'opacity-0 group-hover/message:opacity-100 has-[:focus-visible]:opacity-100',
      )}
      data-message-actions="assistant"
      data-latest-assistant-actions={persistent ? 'true' : undefined}
    >
      <CopyActionButton text={text} />
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
