// ============================================================
// Floating Panel — 通用浮层视觉容器
// ============================================================

import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

// ---------- 类型 ----------

interface FloatingPanelProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  children: ReactNode;
  contentClassName?: string;
  scrollable?: boolean;
  title?: ReactNode;
}

const PANEL_MAX_HEIGHT_CLASS = 'max-h-[min(280px,42vh)]';

// ---------- Component ----------

export function FloatingPanel({
  children,
  className,
  contentClassName,
  scrollable = true,
  title,
  ...props
}: FloatingPanelProps) {
  const content = (
    <div
      className={cn('w-full max-w-full min-w-0 overflow-hidden py-1.5 pr-3 pl-1', contentClassName)}
    >
      {children}
    </div>
  );

  return (
    <div
      className={cn(
        PANEL_MAX_HEIGHT_CLASS,
        'border-border bg-background flex w-full min-w-0 flex-col overflow-hidden rounded-xl border shadow-sm',
        className,
      )}
      {...props}
    >
      {title ? (
        <div className="border-border text-foreground/70 border-b px-3 py-1.5 text-xs font-medium">
          {title}
        </div>
      ) : null}

      {scrollable ? (
        <ScrollArea
          className={cn(
            PANEL_MAX_HEIGHT_CLASS,
            'min-h-0 w-full max-w-full min-w-0 flex-1',
            '[&_[data-slot=scroll-area-scrollbar][data-orientation=vertical]]:py-2',
          )}
          type="always"
          viewportClassName={cn(PANEL_MAX_HEIGHT_CLASS, 'w-full min-w-0 max-w-full')}
        >
          {content}
        </ScrollArea>
      ) : (
        content
      )}
    </div>
  );
}
