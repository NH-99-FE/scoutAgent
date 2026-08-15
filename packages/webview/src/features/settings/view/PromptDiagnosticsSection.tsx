import { AlertTriangle } from 'lucide-react';
import type { ScoutDiagnostic } from '@scout-agent/shared';

export function PromptDiagnosticsSection({ diagnostics }: { diagnostics: ScoutDiagnostic[] }) {
  if (diagnostics.length === 0) return null;

  return (
    <section className="border-border/70 bg-background/40 overflow-hidden rounded-lg border">
      <div className="border-border/70 border-b px-4 py-3">
        <h2 className="text-sm font-medium">加载诊断</h2>
      </div>
      <div className="divide-border/60 divide-y">
        {diagnostics.map((diagnostic, index) => (
          <div
            key={`${diagnostic.path ?? 'diagnostic'}:${index}`}
            className="flex gap-2 px-4 py-3 text-xs"
          >
            <AlertTriangle className="text-warning mt-0.5 size-3.5 shrink-0" />
            <div className="min-w-0">
              <p>{diagnostic.message}</p>
              {diagnostic.path ? (
                <p
                  className="text-muted-foreground mt-1 truncate font-mono"
                  title={diagnostic.path}
                >
                  {diagnostic.path}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
