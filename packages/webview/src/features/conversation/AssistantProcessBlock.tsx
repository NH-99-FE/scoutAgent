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
  PencilLine,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type {
  AssistantProcessActivity,
  AssistantProcessEntry,
  AssistantThinkingActivity,
  AssistantToolActivity,
} from './conversation-view-model';
import type { ToolDisplayResult } from './tool-display';

export function AssistantProcessBlock({ entry }: { entry: AssistantProcessEntry }) {
  const [manualOpen, setManualOpen] = useState<boolean | undefined>(undefined);
  const open = manualOpen ?? entry.defaultOpen;
  const hasDetails = entry.activities.some(hasActivityDetails);
  const summary = entry.summary;
  const tone = summary.tone;

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
            tone === 'error'
              ? 'hover:text-destructive focus-visible:text-destructive'
              : 'hover:text-muted-foreground focus-visible:text-muted-foreground',
          )}
          disabled={!hasDetails}
          type="button"
        >
          <ProcessSummaryIcon activity={entry.activities[0]} />
          <span className={cn('min-w-0 truncate', summary.running && 'scout-running-text-shimmer')}>
            {summary.label}
          </span>
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
            <div className="mt-1.5 max-w-full min-w-0 space-y-1 overflow-hidden">
              {entry.activities.map((activity) => (
                <AssistantActivityItem activity={activity} key={activity.key} />
              ))}
            </div>
          </CollapsibleContent>
        ) : null}
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

  return <InlineStatus running={activity.running ?? true} text={activity.text} tone={activity.tone} />;
}

function ToolActivityItem({ activity }: { activity: AssistantToolActivity }) {
  const { display } = activity;
  const [open, setOpen] = useState(false);
  const hasDetails = display.detailText.trim().length > 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        aria-label={`${open ? '收起' : '展开'}工具输出 ${display.toolName}`}
        className={cn(
          'flex min-h-5 w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors disabled:pointer-events-none',
          display.status === 'error'
            ? 'hover:text-destructive focus-visible:text-destructive'
            : 'hover:text-muted-foreground focus-visible:text-muted-foreground',
        )}
        disabled={!hasDetails}
        type="button"
      >
        <ToolKindIcon toolName={display.toolName} />
        <span
          className={cn(
            'min-w-0 truncate',
            display.status === 'running' && 'scout-running-text-shimmer',
          )}
        >
          {display.summaryTitle}
        </span>
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
    return activity.isStreaming ? <InlineStatus text="思考中" /> : null;
  }

  return (
    <div
      aria-label={`思考过程 ${activity.messageKey}`}
      className="text-foreground/75 max-w-full min-w-0 px-1 py-0.5 text-xs leading-5 [overflow-wrap:anywhere] break-words whitespace-pre-wrap"
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
  if (!activity) return <Wrench className="size-3.5 shrink-0" />;
  if (activity.type === 'tool') return <ToolKindIcon toolName={activity.display.toolName} />;
  if (activity.type === 'thinking') return <Brain className="size-3.5 shrink-0" />;
  return <Brain className="size-3.5 shrink-0" />;
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

function hasActivityDetails(activity: AssistantProcessActivity): boolean {
  if (activity.type === 'status') return activity.text.trim().length > 0;
  if (activity.type === 'thinking') {
    return activity.content.redacted || activity.content.thinking.trim().length > 0;
  }
  return activity.display.detailText.trim().length > 0;
}
