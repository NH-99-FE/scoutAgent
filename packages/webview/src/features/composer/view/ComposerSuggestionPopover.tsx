// ============================================================
// Composer Suggestion Popover — 输入区候选浮层定位与关闭适配
// ============================================================

import type { ReactNode } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';

// ---------- 类型 ----------

interface ComposerSuggestionPopoverProps {
  children: ReactNode;
  onDismiss: () => void;
  open: boolean;
  panel: ReactNode;
}

// ---------- Component ----------

export function ComposerSuggestionPopover({
  children,
  onDismiss,
  open,
  panel,
}: ComposerSuggestionPopoverProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const anchorWidth = useElementWidth(anchorRef);

  return (
    <Popover
      modal={false}
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onDismiss();
      }}
    >
      <PopoverAnchor asChild>
        <div ref={anchorRef} className="relative w-full max-w-full min-w-0">
          {children}
        </div>
      </PopoverAnchor>

      {open && panel ? (
        <PopoverContent
          align="start"
          collisionPadding={8}
          // Radix PopoverContent 默认使用 dialog；候选 popup 的实际语义由内部 listbox/status 提供。
          role={undefined}
          side="top"
          sideOffset={6}
          sticky="partial"
          style={anchorWidth > 0 ? { width: anchorWidth } : undefined}
          variant="bare"
          onCloseAutoFocus={(event) => event.preventDefault()}
          // Combobox 的 DOM focus 始终停留在 textarea；不能把 anchor focus 误判为离开浮层。
          onFocusOutside={(event) => {
            if (isEventFromAnchor(event, anchorRef.current)) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (isEventFromAnchor(event, anchorRef.current)) event.preventDefault();
          }}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          {panel}
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

function isEventFromAnchor(event: Event, anchor: HTMLElement | null): boolean {
  return event.target instanceof Node && anchor?.contains(event.target) === true;
}

// ---------- Anchor width ----------

function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const updateWidth = () => {
      const nextWidth = element.getBoundingClientRect().width;
      setWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
    };

    updateWidth();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }

    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [ref]);

  return width;
}
