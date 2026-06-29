// ============================================================
// Conversation Auto Scroll — 会话滚动跟随策略
// ============================================================

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type {
  RefObject,
  TouchEvent,
  TouchEventHandler,
  UIEventHandler,
  WheelEvent,
  WheelEventHandler,
} from 'react';

const STICKY_SCROLL_THRESHOLD_PX = 48;
const SCROLLABLE_OVERFLOW_VALUES = new Set(['auto', 'scroll', 'overlay']);

interface UseConversationAutoScrollOptions {
  contentKey: unknown;
  contentLayoutKey?: unknown;
  forceScrollToBottomKey?: unknown;
  getScrollMetrics?: (element: HTMLElement) => ConversationScrollMetrics;
  runtimeStatusKey: string;
  scrollToBottomOverride?: () => void;
  showScrollToBottomButton: boolean;
  tailContentKey?: unknown;
  viewportRef?: RefObject<HTMLDivElement | null>;
}

interface ConversationViewportHandlers {
  onScroll: UIEventHandler<HTMLDivElement>;
  onTouchCancel: TouchEventHandler<HTMLDivElement>;
  onTouchEnd: TouchEventHandler<HTMLDivElement>;
  onTouchMove: TouchEventHandler<HTMLDivElement>;
  onTouchStart: TouchEventHandler<HTMLDivElement>;
  onWheel: WheelEventHandler<HTMLDivElement>;
}

export interface ConversationScrollMetrics {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}

export function useConversationAutoScroll({
  contentKey,
  contentLayoutKey,
  forceScrollToBottomKey,
  getScrollMetrics,
  runtimeStatusKey,
  scrollToBottomOverride,
  showScrollToBottomButton,
  tailContentKey,
  viewportRef,
}: UseConversationAutoScrollOptions) {
  const viewportElementRef = useRef<HTMLDivElement | null>(null);
  const setViewportRef = useCallback(
    (element: HTMLDivElement | null) => {
      viewportElementRef.current = element;
      if (viewportRef) {
        viewportRef.current = element;
      }
    },
    [viewportRef],
  );
  const shouldStickToBottomRef = useRef(true);
  const hasAutoScrolledRef = useRef(false);
  const lastForceScrollToBottomKeyRef = useRef(forceScrollToBottomKey);
  const lastTouchClientYRef = useRef<number | null>(null);
  const scheduledScrollRef = useRef<number | null>(null);
  const [isScrollToBottomVisible, setIsScrollToBottomVisible] = useState(false);

  const cancelScheduledScroll = useCallback(() => {
    if (scheduledScrollRef.current === null) return;
    if (typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(scheduledScrollRef.current);
    }
    scheduledScrollRef.current = null;
  }, []);

  const writeScrollToBottom = useCallback(() => {
    const element = viewportElementRef.current;
    if (!element) return;

    if (scrollToBottomOverride) {
      scrollToBottomOverride();
    } else {
      const top = getScrollBottomTop(element, getScrollMetrics);
      if (typeof element.scrollTo === 'function') {
        element.scrollTo({ top, behavior: 'auto' });
      } else {
        element.scrollTop = top;
      }
    }
    shouldStickToBottomRef.current = true;
    setIsScrollToBottomVisible(false);
  }, [getScrollMetrics, scrollToBottomOverride]);

  const schedulePinnedScrollToBottom = useCallback(() => {
    cancelScheduledScroll();

    if (typeof window.requestAnimationFrame !== 'function') {
      writeScrollToBottom();
      return;
    }

    scheduledScrollRef.current = -1;
    const frameId = window.requestAnimationFrame(() => {
      scheduledScrollRef.current = null;
      if (!shouldStickToBottomRef.current) return;
      writeScrollToBottom();
    });
    if (scheduledScrollRef.current !== null) {
      scheduledScrollRef.current = frameId;
    }
  }, [cancelScheduledScroll, writeScrollToBottom]);

  const updateScrollState = useCallback(
    ({ updateStickiness }: { updateStickiness: boolean }) => {
      const element = viewportElementRef.current;
      if (!element) return;

      const isNearBottom = getIsNearBottom(element, getScrollMetrics);
      if (updateStickiness) {
        shouldStickToBottomRef.current = isNearBottom;
      }
      setIsScrollToBottomVisible(showScrollToBottomButton && !isNearBottom);
    },
    [getScrollMetrics, showScrollToBottomButton],
  );

  const stopFollowingUserScroll = useCallback(() => {
    shouldStickToBottomRef.current = false;
    cancelScheduledScroll();
    updateScrollState({ updateStickiness: false });
  }, [cancelScheduledScroll, updateScrollState]);

  const handleDirectionalScrollIntent = useCallback(
    (target: EventTarget | null, deltaY: number) => {
      const element = viewportElementRef.current;
      if (!element) return;

      if (deltaY === 0 || canNestedScrollContainerHandleGesture(element, target, deltaY)) {
        updateScrollState({ updateStickiness: false });
        return;
      }

      if (getIsNearBottom(element, getScrollMetrics) && deltaY >= 0) {
        updateScrollState({ updateStickiness: false });
        return;
      }

      stopFollowingUserScroll();
    },
    [getScrollMetrics, stopFollowingUserScroll, updateScrollState],
  );

  const handleScroll = useCallback(() => {
    updateScrollState({ updateStickiness: true });
  }, [updateScrollState]);

  const handleTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    lastTouchClientYRef.current = event.touches[0]?.clientY ?? null;
  }, []);

  const handleTouchMove = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      const touch = event.touches[0];
      if (!touch) return;

      const previousClientY = lastTouchClientYRef.current;
      lastTouchClientYRef.current = touch.clientY;
      if (previousClientY === null) return;

      handleDirectionalScrollIntent(event.target, previousClientY - touch.clientY);
    },
    [handleDirectionalScrollIntent],
  );

  const handleTouchEnd = useCallback(() => {
    lastTouchClientYRef.current = null;
  }, []);

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      handleDirectionalScrollIntent(event.target, event.deltaY);
    },
    [handleDirectionalScrollIntent],
  );

  const scrollToBottom = useCallback(() => {
    cancelScheduledScroll();
    writeScrollToBottom();
  }, [cancelScheduledScroll, writeScrollToBottom]);

  useLayoutEffect(() => {
    const isInitialAutoScroll = !hasAutoScrolledRef.current;
    const shouldScroll = isInitialAutoScroll || shouldStickToBottomRef.current;
    hasAutoScrolledRef.current = true;
    if (!shouldScroll) {
      updateScrollState({ updateStickiness: false });
      return undefined;
    }

    if (isInitialAutoScroll) {
      writeScrollToBottom();
      return undefined;
    }

    schedulePinnedScrollToBottom();
    return cancelScheduledScroll;
  }, [
    cancelScheduledScroll,
    contentKey,
    contentLayoutKey,
    runtimeStatusKey,
    schedulePinnedScrollToBottom,
    tailContentKey,
    updateScrollState,
    writeScrollToBottom,
  ]);

  useLayoutEffect(() => {
    if (forceScrollToBottomKey === undefined) return;
    if (Object.is(lastForceScrollToBottomKeyRef.current, forceScrollToBottomKey)) return;

    lastForceScrollToBottomKeyRef.current = forceScrollToBottomKey;
    cancelScheduledScroll();
    writeScrollToBottom();
  }, [cancelScheduledScroll, forceScrollToBottomKey, writeScrollToBottom]);

  const viewportHandlers: ConversationViewportHandlers = {
    onScroll: handleScroll,
    onTouchCancel: handleTouchEnd,
    onTouchEnd: handleTouchEnd,
    onTouchMove: handleTouchMove,
    onTouchStart: handleTouchStart,
    onWheel: handleWheel,
  };

  return {
    isScrollToBottomVisible,
    scrollToBottom,
    viewportHandlers,
    viewportRef: setViewportRef,
  };
}

function getIsNearBottom(
  element: HTMLElement,
  getScrollMetrics: UseConversationAutoScrollOptions['getScrollMetrics'],
): boolean {
  const { clientHeight, scrollHeight, scrollTop } = resolveScrollMetrics(element, getScrollMetrics);
  const distanceToBottom = scrollHeight - scrollTop - clientHeight;
  return distanceToBottom <= STICKY_SCROLL_THRESHOLD_PX;
}

function getScrollBottomTop(
  element: HTMLElement,
  getScrollMetrics: UseConversationAutoScrollOptions['getScrollMetrics'],
): number {
  const { clientHeight, scrollHeight } = resolveScrollMetrics(element, getScrollMetrics);
  return Math.max(0, scrollHeight - clientHeight);
}

function resolveScrollMetrics(
  element: HTMLElement,
  getScrollMetrics: UseConversationAutoScrollOptions['getScrollMetrics'],
): ConversationScrollMetrics {
  return (
    getScrollMetrics?.(element) ?? {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    }
  );
}

function canNestedScrollContainerHandleGesture(
  viewport: HTMLElement,
  target: EventTarget | null,
  deltaY: number,
): boolean {
  const direction = Math.sign(deltaY);
  if (direction === 0) return false;

  let element = getTargetElement(target);
  while (element && element !== viewport) {
    if (canScrollVerticallyInDirection(element, direction)) return true;
    element = element.parentElement;
  }

  return false;
}

function getTargetElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Node)) return null;
  return target instanceof HTMLElement ? target : target.parentElement;
}

function canScrollVerticallyInDirection(element: HTMLElement, direction: number): boolean {
  if (!isVerticallyScrollable(element)) return false;
  if (direction < 0) return element.scrollTop > 0;
  return element.scrollHeight - element.scrollTop - element.clientHeight > 0;
}

function isVerticallyScrollable(element: HTMLElement): boolean {
  if (element.scrollHeight <= element.clientHeight) return false;
  if (element.dataset.slot === 'scroll-area-viewport') return true;

  const overflowY = window.getComputedStyle(element).overflowY;
  return SCROLLABLE_OVERFLOW_VALUES.has(overflowY);
}
