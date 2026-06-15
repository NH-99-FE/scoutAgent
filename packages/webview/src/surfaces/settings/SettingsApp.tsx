// ============================================================
// Settings App — 设置面板骨架
// ============================================================

import { RefreshCw, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { protocolClient } from '@/bridge/protocol-client';
import { useDefaultModelLabel, useModelCount, useScoutConfig } from '@/store/config-store';
import { useDiagnostics } from '@/store/ui-store';

export function SettingsApp() {
  const config = useScoutConfig();
  const modelCount = useModelCount();
  const defaultModel = useDefaultModelLabel();
  const diagnostics = useDiagnostics();

  return (
    <main className="bg-background text-foreground min-h-screen">
      <header className="border-border flex items-center justify-between border-b px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">Scout Settings</h1>
          <p className="text-muted-foreground truncate text-xs">
            {defaultModel || 'No default model'}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={protocolClient.requestConfig}>
          <RefreshCw />
          Refresh
        </Button>
      </header>

      <section className="grid gap-4 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="border-border bg-card flex size-9 items-center justify-center rounded-md border">
            <SlidersHorizontal className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">{modelCount} models</p>
            <p className="text-muted-foreground truncate text-xs">
              {config?.defaultModelProvider || 'provider pending'}
            </p>
          </div>
        </div>

        <Separator />

        <dl className="grid gap-3 text-sm">
          <Field label="Default model" value={defaultModel || 'unset'} />
          <Field
            label="Branch reserve"
            value={String(config?.branchSummary.reserveTokens ?? 'unset')}
          />
          <Field
            label="Skip branch prompt"
            value={String(config?.branchSummary.skipPrompt ?? false)}
          />
          <Field label="Diagnostics" value={String(diagnostics.length)} />
        </dl>
      </section>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border/60 grid grid-cols-[minmax(110px,0.45fr)_1fr] gap-3 border-b pb-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate font-medium">{value}</dd>
    </div>
  );
}
