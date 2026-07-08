// ============================================================
// Composer Floating Panel — Composer 底部浮层外壳
// ============================================================

import type { ReactNode } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface ComposerFloatingPanelProps {
  children: ReactNode;
  label: string;
}

interface ComposerFloatingPanelHintProps {
  children: ReactNode;
  label: string;
}

const PANEL_MAX_HEIGHT_CLASS = 'max-h-[min(280px,42vh)]';

// ---------- Component ----------

export function ComposerFloatingPanel({ children, label }: ComposerFloatingPanelProps) {
  return (
    <div
      aria-label={label}
      className="border-border bg-background mb-1.5 w-full min-w-0 overflow-hidden rounded-xl border shadow-sm"
      role="listbox"
    >
      <ScrollArea
        className={cn(
          PANEL_MAX_HEIGHT_CLASS,
          'w-full max-w-full min-w-0',
          '[&_[data-slot=scroll-area-scrollbar][data-orientation=vertical]]:py-2',
        )}
        type="always"
        viewportClassName={cn(PANEL_MAX_HEIGHT_CLASS, 'w-full min-w-0 max-w-full')}
      >
        <div className="w-full max-w-full min-w-0 overflow-hidden py-1.5 pr-3 pl-1">{children}</div>
      </ScrollArea>
    </div>
  );
}

export function ComposerFloatingPanelHint({ children, label }: ComposerFloatingPanelHintProps) {
  return (
    <div
      aria-label={label}
      className={cn(
        'border-border bg-background text-muted-foreground mb-1.5 w-full min-w-0 overflow-hidden rounded-xl border px-3 py-2 text-xs shadow-sm',
        PANEL_MAX_HEIGHT_CLASS,
      )}
      role="listbox"
    >
      {children}
    </div>
  );
}
