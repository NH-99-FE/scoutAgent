// ============================================================
// Composer Floating Panel — Composer 底部浮层外壳
// ============================================================

import type { ReactNode } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ComposerFloatingPanelProps {
  children: ReactNode;
  label: string;
}

interface ComposerFloatingPanelHintProps {
  children: ReactNode;
  label: string;
}

// ---------- Component ----------

export function ComposerFloatingPanel({ children, label }: ComposerFloatingPanelProps) {
  return (
    <div
      aria-label={label}
      className="border-border bg-background mb-1.5 overflow-hidden rounded-xl border shadow-sm"
      role="listbox"
    >
      <ScrollArea className="max-h-[min(280px,42vh)]" viewportClassName="max-h-[min(280px,42vh)]">
        <div className="p-1.5">{children}</div>
      </ScrollArea>
    </div>
  );
}

export function ComposerFloatingPanelHint({ children, label }: ComposerFloatingPanelHintProps) {
  return (
    <div
      aria-label={label}
      className="border-border bg-background text-muted-foreground mb-1.5 max-h-[min(280px,42vh)] overflow-hidden rounded-xl border px-3 py-2 text-xs shadow-sm"
      role="listbox"
    >
      {children}
    </div>
  );
}
