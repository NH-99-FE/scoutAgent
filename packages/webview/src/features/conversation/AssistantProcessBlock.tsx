// ============================================================
// Assistant Process Block — assistant 过程与工具活动渲染
// ============================================================

import { type CSSProperties, useState } from 'react';
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
import type {
  FileEditToolDisplayResult,
  GenericToolDisplayResult,
  ToolDisplayResult,
} from './tool-display';

export function AssistantProcessBlock({ entry }: { entry: AssistantProcessEntry }) {
  const [manualOpen, setManualOpen] = useState<boolean | undefined>(undefined);
  const open = manualOpen ?? entry.defaultOpen;
  const hasDetails = entry.phases.some(hasPhaseDetails);
  const summary = entry.summary;
  const tone = summary.tone;
  const firstActivity = getFirstProcessActivity(entry.phases);
  const shimmerSummary = shouldShimmerSummary(summary);
  const showDisclosureIcon = shouldShowDisclosureIcon(summary, hasDetails);

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
          disabled={!hasDetails}
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
        {hasDetails ? (
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
  const activities = phase.activities.filter(hasActivityDetails);
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

  if (display.kind === 'file_edit') {
    return <FileEditActivityItem display={display} />;
  }

  return <GenericToolActivityItem display={display} />;
}

function GenericToolActivityItem({ display }: { display: GenericToolDisplayResult }) {
  const [open, setOpen] = useState(false);
  const hasDetails = display.detailText.trim().length > 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        aria-label={`${open ? '收起' : '展开'}工具输出 ${display.toolName}`}
        className="group/tool-action flex min-h-5 w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left disabled:pointer-events-none"
        disabled={!hasDetails}
        type="button"
      >
        <ToolKindIcon toolName={display.toolName} />
        <span
          className={cn(
            'group-hover/tool-action:text-foreground group-focus-visible/tool-action:text-foreground min-w-0 truncate transition-colors',
            display.status === 'running' && 'scout-running-text-shimmer',
          )}
        >
          {display.summaryTitle}
        </span>
        {hasDetails ? (
          <ChevronRight className="size-3.5 shrink-0 opacity-0 transition-[opacity,transform] duration-220 ease-out group-hover/tool-action:opacity-100 group-focus-visible/tool-action:opacity-100 group-data-[state=open]/tool-action:rotate-90 group-data-[state=open]/tool-action:opacity-100" />
        ) : null}
      </CollapsibleTrigger>
      {hasDetails ? (
        <CollapsibleContent className="scout-process-collapse-content">
          <ToolDetailPanel display={display} />
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

function FileEditActivityItem({ display }: { display: FileEditToolDisplayResult }) {
  const [open, setOpen] = useState(false);
  const hasDetails = hasToolDisplayDetails(display);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        aria-label={`${open ? '收起' : '展开'}编辑差异 ${display.path}`}
        className="group/tool-action flex min-h-5 w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left disabled:pointer-events-none"
        data-file-edit-activity
        disabled={!hasDetails}
        type="button"
      >
        <PencilLine className="size-3.5 shrink-0" />
        <span
          className={cn(
            'group-hover/tool-action:text-foreground group-focus-visible/tool-action:text-foreground min-w-0 truncate transition-colors',
            display.status === 'running' && 'scout-running-text-shimmer',
          )}
        >
          {display.summaryTitle}
        </span>
        {!display.previewError ? <FileEditStats display={display} /> : null}
        {hasDetails ? (
          <ChevronRight className="size-3.5 shrink-0 opacity-0 transition-[opacity,transform] duration-220 ease-out group-hover/tool-action:opacity-100 group-focus-visible/tool-action:opacity-100 group-data-[state=open]/tool-action:rotate-90 group-data-[state=open]/tool-action:opacity-100" />
        ) : null}
      </CollapsibleTrigger>
      {hasDetails ? (
        <CollapsibleContent className="scout-process-collapse-content">
          <FileEditDiffPanel display={display} />
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

function FileEditStats({ display }: { display: FileEditToolDisplayResult }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[11px] leading-4">
      <span style={ADDED_TEXT_STYLE}>+{display.additions}</span>
      <span style={DELETED_TEXT_STYLE}>-{display.deletions}</span>
    </span>
  );
}

function FileEditDiffPanel({ display }: { display: FileEditToolDisplayResult }) {
  if (display.previewError) {
    return <FileEditPreviewErrorPanel message={display.previewError} />;
  }

  const lines = display.diffText.split('\n');
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

function ToolDetailPanel({ display }: { display: GenericToolDisplayResult }) {
  return (
    <div className="border-border/60 bg-muted/15 max-w-full min-w-0 overflow-hidden rounded-md border-l">
      <div className="text-muted-foreground/80 px-2.5 py-1 text-[11px] leading-4">
        {display.detailTitle}
      </div>
      <ScrollArea
        className="max-h-44 max-w-full min-w-0 sm:max-h-56"
        scrollbars="vertical"
        type="always"
        viewportClassName="max-h-44 sm:max-h-56"
      >
        <pre className="text-foreground/80 max-w-full px-2.5 pb-2 font-mono text-[12px] leading-5 [overflow-wrap:anywhere] break-words whitespace-pre-wrap">
          {display.detailText}
        </pre>
      </ScrollArea>
      {display.completionLabel ? (
        <div
          className={cn(
            'text-muted-foreground/75 px-2.5 pb-1.5 text-right text-[11px]',
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
  if (activity.type === 'tool') return <ToolKindIcon toolName={activity.display.toolName} />;
  return null;
}

function ToolKindIcon({ toolName }: { toolName: string }) {
  const className = 'size-3.5 shrink-0';
  switch (toolName) {
    case 'bash':
      return <SquareTerminal className={className} />;
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

function hasActivityDetails(activity: AssistantProcessActivity): boolean {
  if (activity.type === 'status') return activity.text.trim().length > 0;
  if (activity.type === 'thinking') {
    return activity.content.redacted || activity.content.thinking.trim().length > 0;
  }
  return hasToolDisplayDetails(activity.display);
}

function hasToolDisplayDetails(display: ToolDisplayResult): boolean {
  if (display.kind === 'file_edit') {
    return Boolean(display.previewError?.trim() || display.diffText.trim());
  }
  return display.detailText.trim().length > 0;
}

function hasPhaseDetails(phase: AssistantProcessPhase): boolean {
  return phase.activities.some(hasActivityDetails);
}

function shouldShimmerSummary(summary: AssistantProcessEntry['summary']): boolean {
  return summary.running && summary.label === '正在思考';
}

function shouldShowDisclosureIcon(
  summary: AssistantProcessEntry['summary'],
  hasDetails: boolean,
): boolean {
  return hasDetails && summary.label === '已处理';
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
