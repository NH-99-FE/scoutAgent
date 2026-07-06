import * as React from 'react';
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';

import { getNestedScrollBoundaryProps } from '@/components/ui/nested-scroll-boundary';
import { cn } from '@/lib/utils';

interface ScrollAreaProps extends React.ComponentProps<typeof ScrollAreaPrimitive.Root> {
  scrollbars?: 'vertical' | 'horizontal' | 'both';
  viewportClassName?: string;
  viewportProps?: React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Viewport>;
  viewportRef?: React.Ref<HTMLDivElement>;
}

function ScrollArea({
  className,
  children,
  scrollbars = 'vertical',
  viewportClassName,
  viewportProps,
  viewportRef,
  ...props
}: ScrollAreaProps) {
  const { className: viewportPropsClassName, ...resolvedViewportProps } = viewportProps ?? {};
  const showVerticalScrollbar = scrollbars === 'vertical' || scrollbars === 'both';
  const showHorizontalScrollbar = scrollbars === 'horizontal' || scrollbars === 'both';
  const nestedScrollAxis = getNestedScrollAxis(scrollbars);

  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative min-w-0 overflow-hidden', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        {...getNestedScrollBoundaryProps(nestedScrollAxis)}
        {...resolvedViewportProps}
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className={cn(
          'size-full min-w-0 overflow-x-hidden rounded-[inherit] transition-[color,box-shadow] outline-none',
          viewportClassName,
          viewportPropsClassName,
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {showVerticalScrollbar ? <ScrollBar orientation="vertical" /> : null}
      {showHorizontalScrollbar ? <ScrollBar orientation="horizontal" /> : null}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function getNestedScrollAxis(
  scrollbars: ScrollAreaProps['scrollbars'],
): 'vertical' | 'horizontal' | 'both' {
  if (scrollbars === 'horizontal') return 'horizontal';
  if (scrollbars === 'both') return 'both';
  return 'vertical';
}

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        'flex touch-none p-px transition-colors select-none data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="scout-scroll-area-thumb relative flex-1 rounded-full transition-colors"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
