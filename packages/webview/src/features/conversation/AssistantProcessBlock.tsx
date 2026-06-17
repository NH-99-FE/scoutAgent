// ============================================================
// Assistant Process Block — assistant 过程与工具活动渲染
// ============================================================

import { useState } from 'react';
import {
  Brain,
  ChevronDown,
  ChevronRight,
  EyeOff,
  FileText,
  FolderOpen,
  LoaderCircle,
  PencilLine,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type {
  AssistantProcessActivity,
  AssistantProcessEntry,
  AssistantThinkingActivity,
  AssistantToolActivity,
} from './conversation-view-model';
import type { ToolDisplayResult, ToolDisplayStatus } from './tool-display';

export function AssistantProcessBlock({ entry }: { entry: AssistantProcessEntry }) {
  const [open, setOpen] = useState(false);
  const hasDetails = entry.activities.some(hasActivityDetails);
  const summary = getProcessSummary(entry.activities);
  const tone = getProcessTone(entry.activities);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          'text-muted-foreground space-y-1 text-xs',
          tone === 'error' && 'text-destructive',
        )}
      >
        <CollapsibleTrigger
          aria-label={`${open ? '收起' : '展开'}过程 ${summary.label}`}
          className="hover:bg-muted/60 hover:text-foreground -ml-1 inline-flex min-h-6 max-w-full min-w-0 items-center gap-1.5 rounded-md px-1 text-left transition-colors disabled:pointer-events-none"
          disabled={!hasDetails}
          type="button"
        >
          <ProcessSummaryIcon activity={entry.activities[0]} />
          {summary.running ? <LoaderCircle className="size-3.5 shrink-0 animate-spin" /> : null}
          <span className="min-w-0 truncate">{summary.label}</span>
          {hasDetails ? (
            open ? (
              <ChevronDown className="size-3.5 shrink-0" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0" />
            )
          ) : null}
        </CollapsibleTrigger>
        {hasDetails ? (
          <CollapsibleContent>
            <div className="mt-1 max-w-full min-w-0 space-y-1 overflow-hidden">
              {entry.activities.map((activity) => (
                <AssistantActivityItem activity={activity} key={activity.key} />
              ))}
            </div>
          </CollapsibleContent>
        ) : null}
        <div className="border-border/70 mt-1 border-t" />
      </div>
    </Collapsible>
  );
}

function AssistantActivityItem({ activity }: { activity: AssistantProcessActivity }) {
  if (activity.type === 'tool') {
    return <ToolActivityItem activity={activity} />;
  }

  if (activity.type === 'thinking') {
    return <ThinkingActivityItem activity={activity} />;
  }

  return <InlineStatus text={activity.text} />;
}

function ToolActivityItem({ activity }: { activity: AssistantToolActivity }) {
  const { display } = activity;
  const [open, setOpen] = useState(false);
  const hasDetails = display.detailText.trim().length > 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        aria-label={`${open ? '收起' : '展开'}工具输出 ${display.toolName}`}
        className="hover:bg-muted/60 hover:text-foreground flex min-h-6 w-full min-w-0 items-center gap-1.5 rounded-md px-1 text-left transition-colors disabled:pointer-events-none"
        disabled={!hasDetails}
        type="button"
      >
        <ToolKindIcon toolName={display.toolName} />
        {display.status === 'running' ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
        ) : null}
        <span className="min-w-0 truncate">{display.summaryTitle}</span>
        {hasDetails ? (
          open ? (
            <ChevronDown className="size-3.5 shrink-0" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0" />
          )
        ) : null}
      </CollapsibleTrigger>
      {hasDetails ? (
        <CollapsibleContent>
          <ToolDetailPanel display={display} />
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

function ToolDetailPanel({ display }: { display: ToolDisplayResult }) {
  return (
    <div className="border-border/70 bg-muted/25 max-w-full min-w-0 overflow-hidden rounded-xl border">
      <div className="text-muted-foreground border-border/70 border-b px-3 py-1.5 text-[11px] leading-4">
        {display.detailTitle}
      </div>
      <pre className="text-foreground/85 max-h-44 max-w-full overflow-auto px-2.5 py-2 font-mono text-[12px] leading-5 [overflow-wrap:anywhere] break-words whitespace-pre-wrap sm:max-h-56 sm:px-3">
        {display.detailText}
      </pre>
      {display.completionLabel ? (
        <div
          className={cn(
            'text-muted-foreground px-3 pb-2 text-right text-[11px]',
            display.status === 'error' && 'text-destructive',
          )}
        >
          {display.status === 'error' ? '×' : '✓'} {display.completionLabel}
        </div>
      ) : null}
    </div>
  );
}

function ThinkingActivityItem({ activity }: { activity: AssistantThinkingActivity }) {
  const text = activity.content.thinking.trim();

  if (activity.content.redacted) {
    return (
      <div className="flex min-h-6 items-center gap-1.5">
        <EyeOff className="size-3.5 shrink-0" />
        <span>思考内容已隐藏</span>
      </div>
    );
  }

  if (!text) {
    return activity.isStreaming ? <InlineStatus text="正在思考" /> : null;
  }

  return (
    <div
      aria-label={`思考过程 ${activity.messageKey}`}
      className="border-border/80 bg-muted/20 max-w-full min-w-0 rounded-r-xl border-l px-3 py-2 text-xs leading-5 [overflow-wrap:anywhere] break-words whitespace-pre-wrap italic"
    >
      {text}
    </div>
  );
}

function InlineStatus({ text }: { text: string }) {
  return (
    <div className="flex min-h-6 items-center gap-1.5">
      <LoaderCircle className="size-3.5 animate-spin" />
      <span>{text}</span>
    </div>
  );
}

function ProcessSummaryIcon({ activity }: { activity: AssistantProcessActivity | undefined }) {
  if (!activity) return <Wrench className="size-3.5 shrink-0" />;
  if (activity.type === 'tool') return <ToolKindIcon toolName={activity.display.toolName} />;
  if (activity.type === 'thinking') return <Brain className="size-3.5 shrink-0" />;
  return <LoaderCircle className="size-3.5 shrink-0 animate-spin" />;
}

function ToolKindIcon({ toolName }: { toolName: string }) {
  const className = 'size-3.5 shrink-0';
  switch (toolName) {
    case 'bash':
      return <Terminal className={className} />;
    case 'grep':
    case 'find':
      return <Search className={className} />;
    case 'read':
      return <FileText className={className} />;
    case 'edit':
    case 'write':
      return <PencilLine className={className} />;
    case 'ls':
      return <FolderOpen className={className} />;
    default:
      return <Wrench className={className} />;
  }
}

function getProcessSummary(activities: AssistantProcessActivity[]): {
  label: string;
  running: boolean;
} {
  if (activities.length === 0) {
    return { label: '处理中', running: true };
  }

  if (activities.length === 1) {
    const activity = activities[0];
    return {
      label: getActivityGroupTitle(activity),
      running: getActivityStatus(activity) === 'running',
    };
  }

  const statuses = activities.map(getActivityStatus);
  const primaryActivity = getPrimarySummaryActivity(activities);

  return {
    label: formatMultiActivityTitle(getActivitySummaryTitle(primaryActivity), activities.length),
    running: statuses.includes('running'),
  };
}

function getPrimarySummaryActivity(
  activities: AssistantProcessActivity[],
): AssistantProcessActivity {
  const priorityPredicates: Array<(activity: AssistantProcessActivity) => boolean> = [
    (activity) => activity.type === 'tool' && getActivityStatus(activity) === 'running',
    (activity) => activity.type === 'tool' && getActivityStatus(activity) === 'pending',
    (activity) => activity.type === 'tool' && getActivityStatus(activity) === 'error',
    (activity) => getActivityStatus(activity) === 'running',
    (activity) => getActivityStatus(activity) === 'error',
    (activity) => activity.type === 'tool',
  ];

  for (const predicate of priorityPredicates) {
    const activity = activities.find(predicate);
    if (activity) return activity;
  }

  return activities[0];
}

function formatMultiActivityTitle(title: string, activityCount: number): string {
  if (activityCount <= 1) return title;
  return `${title} 等 ${activityCount} 项`;
}

function getActivitySummaryTitle(activity: AssistantProcessActivity): string {
  if (activity.type === 'status') return activity.text;
  if (activity.type === 'thinking') return activity.isStreaming ? '正在思考' : '思考过程';
  return activity.display.summaryTitle;
}

function getActivityGroupTitle(activity: AssistantProcessActivity | undefined): string {
  if (!activity) return '处理中';
  if (activity.type === 'status') return activity.text;
  if (activity.type === 'thinking') return activity.isStreaming ? '正在思考' : '思考过程';
  return activity.display.groupTitle;
}

function getActivityStatus(activity: AssistantProcessActivity): ToolDisplayStatus {
  if (activity.type === 'status') return 'running';
  if (activity.type === 'thinking') return activity.isStreaming ? 'running' : 'done';
  return activity.display.status;
}

function getProcessTone(activities: AssistantProcessActivity[]): 'default' | 'error' {
  return activities.some((activity) => getActivityStatus(activity) === 'error')
    ? 'error'
    : 'default';
}

function hasActivityDetails(activity: AssistantProcessActivity): boolean {
  if (activity.type === 'status') return false;
  if (activity.type === 'thinking') {
    return activity.content.redacted || activity.content.thinking.trim().length > 0;
  }
  return activity.display.detailText.trim().length > 0;
}
