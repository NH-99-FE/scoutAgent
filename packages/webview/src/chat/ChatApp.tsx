// ============================================================
// Chat App — 常驻侧栏入口
// ============================================================

import { GitBranch, Play, Settings, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { protocolClient } from '@/bridge/protocol-client';
import {
  useBusyState,
  useContextUsage,
  useConversationMessageCount,
} from '@/store/conversation-store';
import {
  useCurrentModelLabel,
  useSessionCount,
  useSessionCwd,
  useSessionName,
} from '@/store/session-store';
import { useTaskCount } from '@/store/task-store';

export function ChatApp() {
  const model = useCurrentModelLabel();
  const busy = useBusyState();
  const contextUsage = useContextUsage();
  const messageCount = useConversationMessageCount();
  const taskCount = useTaskCount();
  const sessionCount = useSessionCount();
  const sessionName = useSessionName();
  const cwd = useSessionCwd();

  return (
    <main className="bg-background text-foreground flex min-h-screen flex-col">
      <header className="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">Scout Agent</h1>
          <p className="text-muted-foreground truncate text-xs">{model || 'No model'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            aria-label="Open tree"
            size="icon-sm"
            variant="ghost"
            onClick={protocolClient.openTreePanel}
          >
            <GitBranch />
          </Button>
          <Button
            aria-label="Open settings"
            size="icon-sm"
            variant="ghost"
            onClick={protocolClient.openSettingsPanel}
          >
            <Settings />
          </Button>
        </div>
      </header>

      <section className="border-border bg-border grid grid-cols-2 gap-px border-b text-xs">
        <Metric label="Messages" value={String(messageCount)} />
        <Metric label="Tasks" value={String(taskCount)} />
        <Metric label="Sessions" value={String(sessionCount)} />
        <Metric label="Context" value={formatContextUsage(contextUsage?.percent)} />
      </section>

      <section className="flex flex-1 flex-col gap-3 px-3 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{sessionName || 'Untitled session'}</p>
          <p className="text-muted-foreground truncate text-xs">{cwd || 'No workspace'}</p>
        </div>
        <Separator />
        <div className="border-border bg-muted/20 rounded-md border px-3 py-2">
          <p className="text-xs font-medium">{busy.label ?? formatBusyKind(busy.kind)}</p>
          <p className="text-muted-foreground mt-1 text-xs">{busy.kind}</p>
        </div>
      </section>

      <footer className="border-border flex items-center gap-2 border-t px-3 py-2">
        <Button
          className="flex-1"
          size="sm"
          variant={busy.cancellable ? 'destructive' : 'outline'}
          onClick={busy.kind === 'retry' ? protocolClient.abortRetry : protocolClient.abort}
          disabled={!busy.cancellable}
        >
          <Square />
          Stop
        </Button>
        <Button
          className="flex-1"
          size="sm"
          variant="outline"
          onClick={protocolClient.continueSession}
        >
          <Play />
          Continue
        </Button>
      </footer>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background px-3 py-2">
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-medium">{value}</p>
    </div>
  );
}

function formatContextUsage(percent: number | null | undefined): string {
  return typeof percent === 'number' ? `${Math.round(percent)}%` : 'n/a';
}

function formatBusyKind(kind: string): string {
  return kind === 'idle' ? 'Idle' : kind;
}
