// ============================================================
// Composer Suggestion Popover — 输入区候选浮层定位与关闭适配
// ============================================================

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
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

  const handleKeyDownCapture = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (
      !open ||
      event.nativeEvent.isComposing ||
      event.key === 'Process' ||
      event.key !== 'Escape'
    ) {
      return;
    }
    // Escape 只在 composer 浮层作用域内消费，避免干扰输入法和页面中的其他弹窗。
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    onDismiss();
  };

  return (
    <Popover modal={false} open={open}>
      <PopoverAnchor asChild>
        <div
          ref={anchorRef}
          className="relative w-full max-w-full min-w-0"
          onKeyDownCapture={handleKeyDownCapture}
        >
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
            if (isEventFromAnchor(event, anchorRef.current)) {
              event.preventDefault();
              return;
            }
            onDismiss();
          }}
          onPointerDownOutside={(event) => {
            if (isEventFromAnchor(event, anchorRef.current)) {
              event.preventDefault();
              return;
            }
            onDismiss();
          }}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onKeyDownCapture={handleKeyDownCapture}
        >
          {panel}
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

function isEventFromAnchor(event: Event, anchor: HTMLElement | null): boolean {
  const originalEvent = (event as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent;
  const target = originalEvent?.target ?? event.target;
  return target instanceof Node && anchor?.contains(target) === true;
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
