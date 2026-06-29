// ============================================================
// Bootstrap Error State — Webview 启动失败持久提示
// ============================================================

import { CircleAlert } from 'lucide-react';

export function BootstrapErrorState({ message }: { message?: string }) {
  return (
    <main
      role="alert"
      className="bg-background text-foreground flex h-screen min-h-0 items-center justify-center px-6"
    >
      <section className="grid max-w-sm gap-3 text-center">
        <CircleAlert className="text-destructive mx-auto size-8" />
        <h1 className="text-base font-semibold">Scout 暂时无法启动</h1>
        <p className="text-muted-foreground text-sm">
          初始化状态加载失败。请重新打开面板或重载窗口。
        </p>
        {message ? (
          <p className="border-border bg-muted/40 text-muted-foreground rounded-md border px-3 py-2 text-xs break-words">
            {message}
          </p>
        ) : null}
      </section>
    </main>
  );
}
