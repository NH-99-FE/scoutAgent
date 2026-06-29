// ============================================================
// Bootstrap Pending State — Webview 启动中占位
// ============================================================

import { Loader2 } from 'lucide-react';

export function BootstrapPendingState() {
  return (
    <main
      aria-live="polite"
      className="bg-background text-muted-foreground flex h-screen min-h-0 items-center justify-center px-6"
    >
      <section className="grid justify-items-center gap-3 text-center">
        <Loader2 className="size-5 animate-spin" />
        <p className="text-sm">Scout 正在启动</p>
      </section>
    </main>
  );
}
