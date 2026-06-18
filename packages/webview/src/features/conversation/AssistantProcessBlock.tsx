// ============================================================
// Assistant Process Block — assistant 过程与工具活动渲染
// ============================================================

import { type CSSProperties, useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  EyeOff,
  FileText,
  FolderOpen,
  PencilLine,
  Search,
  SquareTerminal,
  Wrench,
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type {
  AssistantProcessActivity,
  AssistantProcessEntry,
  AssistantProcessPhase,
  AssistantThinkingActivity,
  AssistantToolActivity,
} from './conversation-view-model';
import { hasExpandableToolDisplayDetail, hasToolDisplaySummary } from './tool-display';
import type {
  DiffToolDisplayDetail,
  TextToolDisplayDetail,
  ToolDisplayDetail,
  ToolDisplayIcon,
  ToolDisplayMetric,
  ToolDisplayResult,
  WriteContentToolDisplayDetail,
} from './tool-display';

export function AssistantProcessBlock({ entry }: { entry: AssistantProcessEntry }) {
  const [manualOpen, setManualOpen] = useState<boolean | undefined>(undefined);
  const open = manualOpen ?? entry.defaultOpen;
  const hasProcessContent = entry.phases.some(hasPhaseContent);
  const summary = entry.summary;
  const tone = summary.tone;
  const firstActivity = getFirstProcessActivity(entry.phases);
  const shimmerSummary = shouldShimmerSummary(summary);
  const showDisclosureIcon = shouldShowDisclosureIcon(summary, hasProcessContent);

  return (
    <Collapsible open={open} onOpenChange={setManualOpen}>
      <div
        className={cn(
          'text-muted-foreground/70 py-0.5 text-xs leading-5',
          tone === 'error' && 'text-destructive',
        )}
      >
        <CollapsibleTrigger
          aria-label={`${open ? '收起' : '展开'}过程 ${summary.label}`}
          className={cn(
            '-ml-1 inline-flex min-h-5 max-w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors disabled:pointer-events-none',
            summary.label === '已处理' && 'border-border/55 w-full border-b pb-1.5',
            tone === 'error'
              ? 'hover:text-destructive focus-visible:text-destructive'
              : 'hover:text-muted-foreground focus-visible:text-muted-foreground',
          )}
          disabled={!hasProcessContent}
          type="button"
        >
          <ProcessSummaryIcon activity={firstActivity} />
          <span className={cn('min-w-0 truncate', shimmerSummary && 'scout-running-text-shimmer')}>
            {summary.label}
          </span>
          {showDisclosureIcon ? (
            open ? (
              <ChevronDown className="size-3.5 shrink-0" data-process-disclosure-icon />
            ) : (
              <ChevronRight className="size-3.5 shrink-0" data-process-disclosure-icon />
            )
          ) : null}
        </CollapsibleTrigger>
        {hasProcessContent ? (
          <CollapsibleContent className="scout-process-collapse-content">
            <div className="mt-1.5 max-w-full min-w-0 space-y-2 overflow-hidden">
              {entry.phases.map((phase) => (
                <AssistantPhaseItem key={phase.key} phase={phase} />
              ))}
            </div>
          </CollapsibleContent>
        ) : null}
      </div>
    </Collapsible>
  );
}

function AssistantPhaseItem({ phase }: { phase: AssistantProcessPhase }) {
  const activities = phase.activities.filter(hasVisibleActivity);
  if (activities.length === 0) return null;

  return (
    <div className="max-w-full min-w-0 space-y-1.5" data-assistant-process-phase={phase.kind}>
      {activities.map((activity) => (
        <AssistantActivityItem activity={activity} key={activity.key} />
      ))}
    </div>
  );
}

function AssistantActivityItem({ activity }: { activity: AssistantProcessActivity }) {
  if (activity.type === 'tool') {
    return <ToolActivityItem activity={activity} />;
  }

  if (activity.type === 'thinking') {
    return <ThinkingActivityItem activity={activity} />;
  }

  return (
    <InlineStatus running={activity.running ?? true} text={activity.text} tone={activity.tone} />
  );
}

function ToolActivityItem({ activity }: { activity: AssistantToolActivity }) {
  const { display } = activity;
  const [open, setOpen] = useState(false);
  const hasDetail = hasExpandableToolDisplayDetail(display);

  if (!hasDetail) {
    return (
      <div className="flex min-h-5 w-full min-w-0 items-center gap-1.5 px-1 py-0.5 text-left">
        <ToolActivitySummary display={display} hasDetail={false} />
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        aria-label={formatToolDetailAriaLabel(open, display)}
        className="group/tool-action flex min-h-5 w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left disabled:pointer-events-none"
        disabled={!hasDetail}
        type="button"
      >
        <ToolActivitySummary display={display} hasDetail />
      </CollapsibleTrigger>
      {display.detail ? (
        <CollapsibleContent className="scout-process-collapse-content mt-2">
          <ToolDetailPanel detail={display.detail} status={display.status} />
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

function ToolActivitySummary({
  display,
  hasDetail,
}: {
  display: ToolDisplayResult;
  hasDetail: boolean;
}) {
  return (
    <>
      <ToolDisplayIconView icon={display.icon} />
      <span
        className={cn(
          'group-hover/tool-action:text-foreground group-focus-visible/tool-action:text-foreground min-w-0 truncate transition-colors',
          (display.status === 'pending' || display.status === 'running') &&
            'scout-running-text-shimmer',
        )}
      >
        {display.summaryTitle}
      </span>
      <ToolDisplayMetrics metrics={display.metrics} placement={display.metricsPlacement} />
      {hasDetail ? (
        <ChevronRight className="size-3.5 shrink-0 opacity-0 transition-[opacity,transform] duration-220 ease-out group-hover/tool-action:opacity-100 group-focus-visible/tool-action:opacity-100 group-data-[state=open]/tool-action:rotate-90 group-data-[state=open]/tool-action:opacity-100" />
      ) : null}
    </>
  );
}

function ToolDisplayMetrics({
  metrics,
  placement = 'inline',
}: {
  metrics: ToolDisplayMetric[] | undefined;
  placement?: ToolDisplayResult['metricsPlacement'];
}) {
  if (!metrics?.length) return null;

  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 font-mono text-[11px] leading-4',
        placement === 'end' && 'ml-auto',
      )}
    >
      {metrics.map((metric) => (
        <span key={metric.key} style={getMetricStyle(metric)}>
          {`${metric.prefix ?? ''}${metric.value}${metric.label ? ` ${metric.label}` : ''}`}
        </span>
      ))}
    </span>
  );
}

function getMetricStyle(metric: ToolDisplayMetric): CSSProperties | undefined {
  if (metric.tone === 'added') return ADDED_TEXT_STYLE;
  if (metric.tone === 'deleted') return DELETED_TEXT_STYLE;
  return undefined;
}

function ToolDetailPanel({
  detail,
  status,
}: {
  detail: ToolDisplayDetail;
  status: ToolDisplayResult['status'];
}) {
  if (detail.kind === 'diff') return <FileEditDiffPanel detail={detail} />;
  if (detail.kind === 'write_content') return <FileWriteContentPanel detail={detail} />;
  return <TextToolDetailPanel detail={detail} status={status} />;
}

function FileEditDiffPanel({ detail }: { detail: DiffToolDisplayDetail }) {
  if (detail.previewError) {
    return <FileEditPreviewErrorPanel message={detail.previewError} />;
  }

  const lines = detail.diffText.split('\n');
  return (
    <div className="border-border/60 bg-muted/15 max-w-full min-w-0 overflow-hidden rounded-md border-l">
      <ScrollArea
        className="max-h-44 max-w-full min-w-0 sm:max-h-56"
        scrollbars="vertical"
        type="always"
        viewportClassName="max-h-44 sm:max-h-56"
      >
        <pre className="max-w-full py-1 font-mono text-[12px] leading-5">
          {lines.map((line, index) => (
            <span
              className="block min-h-5 max-w-full px-2.5 [overflow-wrap:anywhere] break-words whitespace-pre-wrap"
              key={`${index}:${line.slice(0, 16)}`}
              style={getDiffLineStyle(line)}
            >
              {line || ' '}
            </span>
          ))}
        </pre>
      </ScrollArea>
    </div>
  );
}

function FileWriteContentPanel({ detail }: { detail: WriteContentToolDisplayDetail }) {
  const lines = detail.lines;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);

  const updateStickiness = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    shouldStickToBottomRef.current = getIsNearScrollBottom(element);
  }, []);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element || !shouldStickToBottomRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [detail.contentText, lines.length]);

  return (
    <div
      className="border-border/60 max-w-full min-w-0 overflow-hidden rounded-md border-l"
      style={WRITE_PANEL_STYLE}
    >
      {detail.errorText ? (
        <pre className="text-destructive/90 border-border/40 max-w-full border-b px-2.5 py-1.5 font-mono text-[12px] leading-5 [overflow-wrap:anywhere] break-words whitespace-pre-wrap">
          {detail.errorText}
        </pre>
      ) : null}
      {lines.length > 0 ? (
        <ScrollArea
          className="max-h-44 max-w-full min-w-0 sm:max-h-56"
          scrollbars="vertical"
          type="always"
          viewportClassName="max-h-44 sm:max-h-56"
          viewportProps={{ onScroll: updateStickiness }}
          viewportRef={viewportRef}
        >
          <pre className="max-w-full py-1 font-mono text-[12px] leading-5">
            {lines.map((line, index) => (
              <span
                className="grid min-h-5 max-w-full grid-cols-[2rem_minmax(0,1fr)]"
                key={`${index}:${line.slice(0, 16)}`}
              >
                <span className="pr-1.5 text-right select-none" style={ADDED_TEXT_STYLE}>
                  {index + 1}
                </span>
                <span
                  className="text-foreground/85 [overflow-wrap:anywhere] break-words whitespace-pre-wrap"
                  data-write-line-content
                >
                  {line || ' '}
                </span>
              </span>
            ))}
          </pre>
        </ScrollArea>
      ) : (
        <div className="text-muted-foreground/75 border-border/40 border-t px-2.5 py-2 text-[12px]">
          等待内容
        </div>
      )}
    </div>
  );
}

function FileEditPreviewErrorPanel({ message }: { message: string }) {
  return (
    <div className="border-border/60 bg-muted/15 max-w-full min-w-0 overflow-hidden rounded-md border-l">
      <div className="text-muted-foreground/80 px-2.5 py-1 text-[11px] leading-4">预览错误</div>
      <pre className="text-destructive/90 max-w-full px-2.5 pb-2 font-mono text-[12px] leading-5 [overflow-wrap:anywhere] break-words whitespace-pre-wrap">
        {message}
      </pre>
    </div>
  );
}

function TextToolDetailPanel({
  detail,
  status,
}: {
  detail: TextToolDisplayDetail;
  status: ToolDisplayResult['status'];
}) {
  return (
    <div className="border-border/60 bg-muted/15 max-w-full min-w-0 overflow-hidden rounded-md border-l">
      <div className="text-muted-foreground/80 px-2.5 py-1 text-[11px] leading-4">
        {detail.title}
      </div>
      <ScrollArea
        className="max-h-44 max-w-full min-w-0 sm:max-h-56"
        scrollbars="vertical"
        type="always"
        viewportClassName="max-h-44 sm:max-h-56"
      >
        <pre className="text-foreground/80 max-w-full px-2.5 pb-2 font-mono text-[12px] leading-5 [overflow-wrap:anywhere] break-words whitespace-pre-wrap">
          {detail.text}
        </pre>
      </ScrollArea>
      {detail.completionLabel ? (
        <div
          className={cn(
            'text-muted-foreground/75 px-2.5 pb-1.5 text-right text-[11px]',
            status === 'error' && 'text-destructive',
          )}
        >
          {status === 'error' ? '×' : '✓'} {detail.completionLabel}
        </div>
      ) : null}
    </div>
  );
}

function ThinkingActivityItem({ activity }: { activity: AssistantThinkingActivity }) {
  const text = activity.content.thinking.trim();

  if (activity.content.redacted) {
    return (
      <div className="flex min-h-5 items-center gap-1.5 px-1 py-0.5">
        <EyeOff className="size-3.5 shrink-0" />
        <span>思考内容已隐藏</span>
      </div>
    );
  }

  if (!text) {
    return null;
  }

  return (
    <div
      aria-label={`思考过程 ${activity.messageKey}`}
      className="text-foreground max-w-full min-w-0 px-1 py-0.5 text-xs leading-5 [overflow-wrap:anywhere] break-words whitespace-pre-wrap"
    >
      {text}
    </div>
  );
}

function InlineStatus({
  text,
  tone = 'default',
  running = true,
}: {
  text: string;
  tone?: 'default' | 'error';
  running?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex min-h-5 items-center px-1 py-0.5',
        tone === 'error' && 'text-destructive',
      )}
    >
      <span className={cn(running && 'scout-running-text-shimmer')}>{text}</span>
    </div>
  );
}

function ProcessSummaryIcon({ activity }: { activity: AssistantProcessActivity | undefined }) {
  if (!activity) return null;
  if (activity.type === 'tool') return <ToolDisplayIconView icon={activity.display.icon} />;
  return null;
}

function ToolDisplayIconView({ icon }: { icon: ToolDisplayIcon }) {
  const className = 'size-3.5 shrink-0';
  switch (icon) {
    case 'terminal':
      return <SquareTerminal className={className} />;
    case 'search':
      return <Search className={className} />;
    case 'file':
      return <FileText className={className} />;
    case 'edit':
      return <PencilLine className={className} />;
    case 'folder':
      return <FolderOpen className={className} />;
    default:
      return <Wrench className={className} />;
  }
}

const ADDED_TEXT_STYLE: CSSProperties = {
  color: '#6fba7c',
};

const DELETED_TEXT_STYLE: CSSProperties = {
  color: '#df7b7b',
};

const WRITE_PANEL_STYLE: CSSProperties = {
  backgroundColor: 'rgba(111, 186, 124, 0.08)',
  borderLeftColor: '#6fba7c',
};

function getIsNearScrollBottom(element: HTMLElement): boolean {
  const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
  return distanceToBottom <= 24;
}

function getDiffLineStyle(line: string): CSSProperties | undefined {
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return {
      ...ADDED_TEXT_STYLE,
      backgroundColor: 'rgba(111, 186, 124, 0.08)',
      borderLeft: '2px solid currentColor',
    };
  }

  if (line.startsWith('-') && !line.startsWith('---')) {
    return {
      ...DELETED_TEXT_STYLE,
      backgroundColor: 'rgba(223, 123, 123, 0.08)',
      borderLeft: '2px solid currentColor',
    };
  }

  return undefined;
}

function hasVisibleActivity(activity: AssistantProcessActivity): boolean {
  if (activity.type === 'status') return activity.text.trim().length > 0;
  if (activity.type === 'thinking') {
    return activity.content.redacted || activity.content.thinking.trim().length > 0;
  }
  return (
    hasToolDisplaySummary(activity.display) || hasExpandableToolDisplayDetail(activity.display)
  );
}

function hasPhaseContent(phase: AssistantProcessPhase): boolean {
  return phase.activities.some(hasVisibleActivity);
}

function formatToolDetailAriaLabel(open: boolean, display: ToolDisplayResult): string {
  const label = display.detailLabel ?? '工具输出';
  const target = display.detailTarget ?? display.toolName;
  return `${open ? '收起' : '展开'}${label} ${target}`;
}

function shouldShimmerSummary(summary: AssistantProcessEntry['summary']): boolean {
  return summary.running && summary.label === '正在思考';
}

function shouldShowDisclosureIcon(
  summary: AssistantProcessEntry['summary'],
  hasProcessContent: boolean,
): boolean {
  return hasProcessContent && summary.label === '已处理';
}

function getFirstProcessActivity(
  phases: AssistantProcessPhase[],
): AssistantProcessActivity | undefined {
  for (const phase of phases) {
    const activity = phase.activities[0];
    if (activity) return activity;
  }
  return undefined;
}
