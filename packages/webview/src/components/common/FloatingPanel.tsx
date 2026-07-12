// ============================================================
// Floating Panel — 通用浮层视觉容器
// ============================================================

import { forwardRef, useId, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

// ---------- 类型 ----------

interface FloatingPanelProps extends ComponentPropsWithoutRef<'div'> {
  children: ReactNode;
  contentClassName?: string;
  variant?: 'default' | 'status';
}

interface FloatingPanelGroupProps extends Omit<
  ComponentPropsWithoutRef<'div'>,
  'aria-labelledby' | 'children' | 'role'
> {
  children: ReactNode;
  label: ReactNode;
}

interface FloatingPanelOptionProps extends Omit<
  ComponentPropsWithoutRef<'button'>,
  'aria-selected' | 'children' | 'role' | 'type'
> {
  active: boolean;
  description?: string;
  icon: ReactNode;
  label: string;
}

const PANEL_MAX_HEIGHT_CLASS = 'max-h-[min(280px,42vh)]';

// ---------- Components ----------

export function FloatingPanel({
  children,
  className,
  contentClassName,
  variant = 'default',
  ...props
}: FloatingPanelProps) {
  const scrollable = variant === 'default';
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
        scrollable && PANEL_MAX_HEIGHT_CLASS,
        'border-border bg-background flex w-full min-w-0 flex-col overflow-hidden rounded-xl border shadow-sm',
        className,
      )}
      {...props}
    >
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

function FloatingPanelGroup({ children, className, label, ...props }: FloatingPanelGroupProps) {
  const labelId = useId();

  return (
    <div
      aria-labelledby={labelId}
      className={cn('mt-1 min-w-0 first:mt-0', className)}
      role="group"
      {...props}
    >
      <div id={labelId} className="text-foreground/60 px-2 py-0.5 text-[11px] leading-4">
        {label}
      </div>
      {children}
    </div>
  );
}

const FloatingPanelOption = forwardRef<HTMLButtonElement, FloatingPanelOptionProps>(
  function FloatingPanelOption(
    { 'aria-label': ariaLabel, active, className, description, icon, label, ...props },
    ref,
  ) {
    const accessibleLabel = ariaLabel ?? (description ? `${label} ${description}` : label);

    return (
      <button
        {...props}
        ref={ref}
        aria-label={accessibleLabel}
        aria-selected={active}
        className={cn(
          'group/floating-panel-item flex h-7 w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-lg px-2 text-left text-xs outline-hidden',
          active ? 'bg-option-hover' : 'hover:bg-option-hover',
          className,
        )}
        role="option"
        type="button"
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex size-3.5 shrink-0 items-center justify-center transition-colors [&_svg]:size-3.5 [&_svg]:shrink-0',
            active
              ? 'text-foreground/80'
              : 'text-foreground/65 group-hover/floating-panel-item:text-foreground/80',
          )}
        >
          {icon}
        </span>
        <span
          className={cn(
            'min-w-0 truncate font-medium transition-colors',
            description ? 'max-w-[58%] shrink' : 'flex-1',
            active
              ? 'text-foreground/90'
              : 'text-foreground/75 group-hover/floating-panel-item:text-foreground/90',
          )}
        >
          {label}
        </span>
        {description ? (
          <span
            className={cn(
              'w-0 min-w-0 flex-1 truncate transition-colors',
              active
                ? 'text-foreground/70'
                : 'text-muted-foreground/80 group-hover/floating-panel-item:text-foreground/70',
            )}
            title={description}
          >
            {description}
          </span>
        ) : null}
      </button>
    );
  },
);

FloatingPanel.Group = FloatingPanelGroup;
FloatingPanel.Option = FloatingPanelOption;
