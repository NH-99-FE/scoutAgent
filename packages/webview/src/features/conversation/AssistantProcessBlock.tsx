// ============================================================
// Assistant Process Block — assistant 过程与工具活动渲染
// ============================================================

import { type CSSProperties, useCallback, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ClipboardPen,
  EyeOff,
  FileDiff,
  FileText,
  FolderOpen,
  Search,
  SquareTerminal,
  Wrench,
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  getProcessExpansionId,
  getToolDetailExpansionId,
  useConversationExpansionStore,
  useConversationExpansionOpen,
} from '@/store/conversation-expansion-store';
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
} from './tool-display';
import { useRegisterConversationExpansionNode } from './conversation-expansion-node';

const TOOL_DETAIL_PREVIEW_LINE_LIMIT = 400;

export function AssistantProcessBlock({
  entry,
  expansionScope,
  parentExpansionId,
  suppressLifecycleOnlyProcess = false,
}: {
  entry: AssistantProcessEntry;
  expansionScope: string;
  parentExpansionId?: string;
  suppressLifecycleOnlyProcess?: boolean;
}) {
  const expansionId = getProcessExpansionId(entry.key, expansionScope);
  const open = useConversationExpansionOpen(expansionId, entry.defaultOpen);
  const hasProcessContent = entry.phases.some(hasPhaseContent);
  const hasActivitySummary = Boolean(entry.activitySummary.primary);
  const { detailPhases, leadingThinkingPhases } = splitLeadingThinkingPhases(entry.phases);
  const hasDetailProcessContent = detailPhases.some(hasPhaseContent);
  const summary = entry.summary;
  const tone = summary.tone;
  const firstActivity = getFirstProcessActivity(entry.phases);
  const shimmerSummary = shouldShimmerSummary(summary);
  const showDisclosureIcon = shouldShowDisclosureIcon(summary, hasDetailProcessContent);
  const triggerLabel = getProcessTriggerLabel(entry);

  useRegisterConversationExpansionNode({
    id: expansionId,
    kind: 'process',
    parentId: parentExpansionId,
  });

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      const { actions } = useConversationExpansionStore.getState();
      actions.setExpanded(expansionId, nextOpen);
    },
    [expansionId],
  );

  if (entry.displayMode === 'live' && hasProcessContent) {
    return (
      <div className="text-muted-foreground/70 text-xs leading-5">
        <ProcessPhaseList
          expansionScope={expansionScope}
          parentExpansionId={expansionId}
          phases={entry.phases}
        />
      </div>
    );
  }

  if (!hasActivitySummary) {
    const hasToolProcessContent = hasToolActivity(entry.phases);
    if (!hasProcessContent) {
      if (suppressLifecycleOnlyProcess) return null;
      if (!summary.running) return null;
      return (
        <div className="text-muted-foreground/70 text-xs leading-5">
          <InlineStatus running={summary.running} text={summary.label} tone={tone} />
        </div>
      );
    }
    if (suppressLifecycleOnlyProcess && !summary.running && !hasToolProcessContent) return null;
    return (
      <div className="text-muted-foreground/70 text-xs leading-5">
        <ProcessPhaseList
          expansionScope={expansionScope}
          parentExpansionId={expansionId}
          phases={entry.phases}
        />
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange}>
      <div className="text-muted-foreground/70 text-xs leading-5">
        {leadingThinkingPhases.length > 0 ? (
          <ProcessPhaseList
            className="mb-1"
            expansionScope={expansionScope}
            parentExpansionId={expansionId}
            phases={leadingThinkingPhases}
          />
        ) : null}
        <CollapsibleTrigger
          aria-label={`${open ? '收起' : '展开'}过程 ${triggerLabel}`}
          className={cn(
            'group/process-trigger inline-flex min-h-5 max-w-full min-w-0 items-center gap-1.5 rounded text-left transition-colors disabled:pointer-events-none',
            entry.displayMode === 'compact' && 'w-full',
          )}
          disabled={!hasDetailProcessContent}
          type="button"
        >
          {hasActivitySummary ? (
            <CompactActivitySummary entry={entry} />
          ) : (
            <>
              <ProcessSummaryIcon activity={firstActivity} />
              <span
                className={cn(
                  'group-hover/process-trigger:text-foreground group-focus-visible/process-trigger:text-foreground min-w-0 truncate transition-colors',
                  shimmerSummary && 'scout-running-text-shimmer',
                )}
              >
                {summary.label}
              </span>
            </>
          )}
          {showDisclosureIcon ? (
            open ? (
              <ChevronDown
                className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/process-trigger:opacity-100 group-focus-visible/process-trigger:opacity-100"
                data-process-disclosure-icon
              />
            ) : (
              <ChevronRight
                className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/process-trigger:opacity-100 group-focus-visible/process-trigger:opacity-100"
                data-process-disclosure-icon
              />
            )
          ) : null}
        </CollapsibleTrigger>
        {hasDetailProcessContent ? (
          <CollapsibleContent className="scout-process-collapse-content">
            <ProcessPhaseList
              className="mt-1.5"
              expansionScope={expansionScope}
              hideToolIcons={entry.displayMode === 'compact'}
              parentExpansionId={expansionId}
              phases={detailPhases}
            />
          </CollapsibleContent>
        ) : null}
      </div>
    </Collapsible>
  );
}

function ProcessPhaseList({
  className,
  expansionScope,
  hideToolIcons = false,
  parentExpansionId,
  phases,
}: {
  className?: string;
  expansionScope: string;
  hideToolIcons?: boolean;
  parentExpansionId?: string;
  phases: AssistantProcessPhase[];
}) {
  return (
    <div className={cn('max-w-full min-w-0 space-y-2 overflow-hidden', className)}>
      {phases.map((phase) => (
        <AssistantPhaseItem
          expansionScope={expansionScope}
          hideToolIcons={hideToolIcons}
          key={phase.key}
          parentExpansionId={parentExpansionId}
          phase={phase}
        />
      ))}
    </div>
  );
}

function splitLeadingThinkingPhases(phases: AssistantProcessPhase[]): {
  detailPhases: AssistantProcessPhase[];
  leadingThinkingPhases: AssistantProcessPhase[];
} {
  const firstToolPhaseIndex = phases.findIndex((phase) =>
    phase.activities.some((activity) => activity.type === 'tool'),
  );
  if (firstToolPhaseIndex <= 0) {
    return { detailPhases: phases, leadingThinkingPhases: [] };
  }

  const leadingActivityKeys = new Set<string>();
  const leadingThinkingPhases = phases
    .slice(0, firstToolPhaseIndex)
    .map((phase) => {
      const activities = phase.activities.filter((activity) => activity.type === 'thinking');
      for (const activity of activities) {
        leadingActivityKeys.add(activity.key);
      }
      return { ...phase, activities };
    })
    .filter(hasPhaseContent);

  if (leadingThinkingPhases.length === 0) {
    return { detailPhases: phases, leadingThinkingPhases: [] };
  }

  const detailPhases = phases
    .map((phase) => ({
      ...phase,
      activities: phase.activities.filter((activity) => !leadingActivityKeys.has(activity.key)),
    }))
    .filter(hasPhaseContent);

  return { detailPhases, leadingThinkingPhases };
}

function CompactActivitySummary({ entry }: { entry: AssistantProcessEntry }) {
  const primary = entry.activitySummary.primary;
  if (!primary) {
    return (
      <span className="group-hover/process-trigger:text-foreground group-focus-visible/process-trigger:text-foreground inline-flex h-5 min-w-0 items-center truncate leading-4 transition-colors">
        {entry.summary.label}
      </span>
    );
  }

  return (
    <span className="inline-flex h-5 max-w-full min-w-0 items-center gap-1.5 overflow-hidden">
      <ToolDisplayIconView icon={primary.icon} />
      <span className="group-hover/process-trigger:text-foreground group-focus-visible/process-trigger:text-foreground min-w-0 truncate leading-4 transition-colors">
        {primary.label}
      </span>
    </span>
  );
}

function AssistantPhaseItem({
  expansionScope,
  hideToolIcons = false,
  parentExpansionId,
  phase,
}: {
  expansionScope: string;
  hideToolIcons?: boolean;
  parentExpansionId?: string;
  phase: AssistantProcessPhase;
}) {
  const activities = phase.activities.filter(hasVisibleActivity);
  if (activities.length === 0) return null;

  return (
    <div className="max-w-full min-w-0 space-y-1.5" data-assistant-process-phase={phase.kind}>
      {activities.map((activity) => (
        <AssistantActivityItem
          activity={activity}
          expansionScope={expansionScope}
          hideToolIcon={hideToolIcons}
          key={activity.key}
          parentExpansionId={parentExpansionId}
        />
      ))}
    </div>
  );
}

function AssistantActivityItem({
  activity,
  expansionScope,
  hideToolIcon = false,
  parentExpansionId,
}: {
  activity: AssistantProcessActivity;
  expansionScope: string;
  hideToolIcon?: boolean;
  parentExpansionId?: string;
}) {
  if (activity.type === 'tool') {
    return (
      <ToolActivityItem
        activity={activity}
        expansionScope={expansionScope}
        hideIcon={hideToolIcon}
        parentExpansionId={parentExpansionId}
      />
    );
  }

  if (activity.type === 'thinking') {
    return <ThinkingActivityItem activity={activity} />;
  }

  return (
    <InlineStatus running={activity.running ?? true} text={activity.text} tone={activity.tone} />
  );
}

function ToolActivityItem({
  activity,
  expansionScope,
  hideIcon = false,
  parentExpansionId,
}: {
  activity: AssistantToolActivity;
  expansionScope: string;
  hideIcon?: boolean;
  parentExpansionId?: string;
}) {
  const { display } = activity;
  const expansionId = getToolDetailExpansionId(activity.key, expansionScope);
  const open = useConversationExpansionOpen(expansionId, false);
  const hasDetail = hasExpandableToolDisplayDetail(display);

  useRegisterConversationExpansionNode({
    id: expansionId,
    kind: 'tool_detail',
    parentId: parentExpansionId,
  });

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      const { actions } = useConversationExpansionStore.getState();
      actions.setExpanded(expansionId, nextOpen);
    },
    [expansionId],
  );

  if (!hasDetail) {
    return (
      <div className="flex min-h-5 w-full min-w-0 items-center gap-1.5 text-left">
        <ToolActivitySummary display={display} hasDetail={false} hideIcon={hideIcon} />
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger
        aria-label={formatToolDetailAriaLabel(open, display)}
        className="group/tool-action flex min-h-5 w-full min-w-0 items-center gap-1.5 rounded text-left disabled:pointer-events-none"
        disabled={!hasDetail}
        type="button"
      >
        <ToolActivitySummary display={display} hasDetail hideIcon={hideIcon} />
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
  hideIcon = false,
}: {
  display: ToolDisplayResult;
  hasDetail: boolean;
  hideIcon?: boolean;
}) {
  const placeMetricsAtEnd = display.metricsPlacement === 'end';
  const disclosureIcon = hasDetail ? (
    <ChevronRight className="size-3.5 shrink-0 opacity-0 transition-[opacity,transform] duration-220 ease-out group-hover/tool-action:opacity-100 group-focus-visible/tool-action:opacity-100 group-data-[state=open]/tool-action:rotate-90 group-data-[state=open]/tool-action:opacity-100" />
  ) : null;

  return (
    <>
      {hideIcon ? null : <ToolDisplayIconView icon={display.icon} />}
      <span
        className={cn(
          'group-hover/tool-action:text-foreground group-focus-visible/tool-action:text-foreground min-w-0 truncate transition-colors',
          display.status === 'error' && 'text-destructive',
          (display.status === 'pending' || display.status === 'running') &&
            'scout-running-text-shimmer',
        )}
      >
        {display.summaryTitle}
      </span>
      {placeMetricsAtEnd ? disclosureIcon : null}
      <ToolDisplayMetrics metrics={display.metrics} placement={display.metricsPlacement} />
      {placeMetricsAtEnd ? null : disclosureIcon}
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
  return <TextToolDetailPanel detail={detail} status={status} />;
}

function FileEditDiffPanel({ detail }: { detail: DiffToolDisplayDetail }) {
  const lines = detail.previewError ? [] : detail.diffText.split('\n');
  const { hiddenLineCount, isTruncated, setShowAll, visibleLines } = usePreviewLines(lines);

  if (detail.previewError) {
    return <FileEditPreviewErrorPanel detail={detail} message={detail.previewError} />;
  }

  return (
    <div
      className="border-border/70 bg-foreground/[0.035] max-w-full min-w-0 overflow-hidden rounded-lg border shadow-sm"
      data-file-edit-diff-panel="true"
    >
      <FileEditDiffHeader detail={detail} />
      <ScrollArea
        className="max-h-44 max-w-full min-w-0 sm:max-h-56"
        scrollbars="both"
        type="always"
        viewportClassName="max-h-44 sm:max-h-56"
        viewportProps={{ style: { overflowX: 'auto' } }}
      >
        <pre className="m-0 w-max min-w-full py-1 font-mono text-[12px] leading-5">
          {visibleLines.map((line, index) => (
            <span
              className="block min-h-5 min-w-full border-l-2 border-transparent px-2.5 whitespace-pre"
              data-diff-line-content
              key={`${index}:${line.slice(0, 16)}`}
              style={getDiffLineStyle(line)}
            >
              {line || ' '}
            </span>
          ))}
        </pre>
      </ScrollArea>
      {isTruncated ? (
        <ToolDetailLineLimitButton
          hiddenLineCount={hiddenLineCount}
          totalLineCount={lines.length}
          onShowAll={() => setShowAll(true)}
        />
      ) : null}
    </div>
  );
}

function FileEditDiffHeader({ detail }: { detail: DiffToolDisplayDetail }) {
  if (!detail.title && !detail.path) return null;
  return (
    <div className="border-border/60 divide-border/60 divide-y border-b">
      {detail.title ? (
        <div className="text-muted-foreground flex min-h-8 items-center gap-1.5 px-2.5 py-1 text-[12px] leading-5 font-medium">
          <span className="min-w-0 truncate">{detail.title}</span>
          <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
        </div>
      ) : null}
      {detail.path ? (
        <div className="flex min-h-8 items-center gap-1.5 px-2.5 py-1 text-[12px] leading-5">
          <FileDiff
            aria-hidden="true"
            className="text-muted-foreground/70 size-3.5 shrink-0"
            strokeWidth={2}
          />
          <span className="text-foreground min-w-0 flex-1 truncate font-mono">{detail.path}</span>
          {typeof detail.additions === 'number' && detail.additions > 0 ? (
            <span className="shrink-0 font-mono text-[var(--chart-2)]">+{detail.additions}</span>
          ) : null}
          {typeof detail.deletions === 'number' && detail.deletions > 0 ? (
            <span className="shrink-0 font-mono text-[var(--chart-5)]">-{detail.deletions}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function usePreviewLines(lines: string[]): {
  hiddenLineCount: number;
  isTruncated: boolean;
  setShowAll: (showAll: boolean) => void;
  visibleLines: string[];
} {
  const [showAll, setShowAll] = useState(false);
  const isTruncated = !showAll && lines.length > TOOL_DETAIL_PREVIEW_LINE_LIMIT;
  return {
    hiddenLineCount: isTruncated ? lines.length - TOOL_DETAIL_PREVIEW_LINE_LIMIT : 0,
    isTruncated,
    setShowAll,
    visibleLines: isTruncated ? lines.slice(0, TOOL_DETAIL_PREVIEW_LINE_LIMIT) : lines,
  };
}

function ToolDetailLineLimitButton({
  hiddenLineCount,
  onShowAll,
  totalLineCount,
}: {
  hiddenLineCount: number;
  onShowAll: () => void;
  totalLineCount: number;
}) {
  return (
    <button
      className="text-muted-foreground hover:text-foreground border-border/40 flex w-full items-center justify-center border-t px-2.5 py-1.5 text-[11px] leading-4 transition-colors"
      data-tool-detail-line-limit
      type="button"
      onClick={onShowAll}
    >
      显示全部 {totalLineCount} 行，已隐藏 {hiddenLineCount} 行
    </button>
  );
}

function FileEditPreviewErrorPanel({
  detail,
  message,
}: {
  detail: DiffToolDisplayDetail;
  message: string;
}) {
  return (
    <div className="border-border/70 bg-foreground/[0.035] max-w-full min-w-0 overflow-hidden rounded-lg border shadow-sm">
      <FileEditDiffHeader detail={detail} />
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
          {status === 'error' || status === 'stopped' ? '×' : '✓'} {detail.completionLabel}
        </div>
      ) : null}
    </div>
  );
}

function ThinkingActivityItem({ activity }: { activity: AssistantThinkingActivity }) {
  const text = activity.content.thinking.trim();

  if (activity.content.redacted) {
    return (
      <div className="flex min-h-5 items-center gap-1.5">
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
      className="text-foreground max-w-full min-w-0 text-xs leading-5 [overflow-wrap:anywhere] break-words whitespace-pre-wrap"
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
    <div className={cn('flex min-h-5 items-center', tone === 'error' && 'text-destructive')}>
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
  const className = 'size-3.5 shrink-0 self-center';
  switch (icon) {
    case 'terminal':
      return <SquareTerminal className={className} />;
    case 'search':
      return <Search className={className} />;
    case 'file':
      return <FileText className={className} />;
    case 'edit':
      return <ClipboardPen className={className} />;
    case 'folder':
      return <FolderOpen className={className} />;
    case 'clipboard-list':
      return <ClipboardList className={className} />;
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

function hasToolActivity(phases: AssistantProcessPhase[]): boolean {
  return phases.some((phase) => phase.activities.some((activity) => activity.type === 'tool'));
}

function formatToolDetailAriaLabel(open: boolean, display: ToolDisplayResult): string {
  const label = display.detailLabel ?? '工具输出';
  const target = display.detailTarget ?? display.toolName;
  return `${open ? '收起' : '展开'}${label} ${target}`;
}

function getProcessTriggerLabel(entry: AssistantProcessEntry): string {
  return entry.activitySummary.primary?.label ?? entry.summary.label;
}

function shouldShimmerSummary(summary: AssistantProcessEntry['summary']): boolean {
  return summary.running && summary.status === 'model_deciding';
}

function shouldShowDisclosureIcon(
  _summary: AssistantProcessEntry['summary'],
  hasProcessContent: boolean,
): boolean {
  return hasProcessContent;
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
