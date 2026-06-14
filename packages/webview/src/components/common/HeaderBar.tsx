// ============================================================
// Header Bar — 页面顶部单行标题栏布局
// ============================================================

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface HeaderBarProps {
  title: string;
  left?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleClassName?: string;
  actionsClassName?: string;
}

export function HeaderBar({
  title,
  left,
  actions,
  className,
  titleClassName,
  actionsClassName,
}: HeaderBarProps) {
  return (
    <div className={cn('flex w-full min-w-0 items-center justify-between gap-1', className)}>
      <div className="flex min-w-0 flex-1 items-center gap-1 [&_button]:text-current">
        {left}
        <h1
          className={cn('text-foreground min-w-0 truncate text-[13px] font-medium', titleClassName)}
        >
          {title}
        </h1>
      </div>

      {actions ? (
        <div
          className={cn(
            'flex shrink-0 items-center gap-0.5 text-current [&_button]:text-current',
            actionsClassName,
          )}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
