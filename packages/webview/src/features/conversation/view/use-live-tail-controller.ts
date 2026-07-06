// ============================================================
// Live Tail Controller — transcript 底部实时跟随策略
// ============================================================

import { useCallback, useRef } from 'react';
import type { KeyboardEvent, TouchEvent, WheelEvent } from 'react';

interface UseLiveTailControllerOptions {
  isAtEnd: boolean;
  scrollToEnd: (options?: { behavior?: ScrollBehavior }) => boolean;
}

export function useLiveTailController({ isAtEnd, scrollToEnd }: UseLiveTailControllerOptions) {
  const lastTouchClientYRef = useRef<number | null>(null);
  const restoreLiveTailForGesture = useCallback(
    (viewport: HTMLElement, target: EventTarget | null, deltaY: number) => {
      if (shouldRestoreLiveTailForScrollGesture(isAtEnd, viewport, target, deltaY)) {
        scrollToEnd({ behavior: 'auto' });
      }
    },
    [isAtEnd, scrollToEnd],
  );
  const handleViewportWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      restoreLiveTailForGesture(event.currentTarget, event.target, event.deltaY);
    },
    [restoreLiveTailForGesture],
  );
  const handleViewportKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (shouldRestoreLiveTailForKeyboardScroll(isAtEnd, event)) {
        scrollToEnd({ behavior: 'auto' });
      }
    },
    [isAtEnd, scrollToEnd],
  );
  const handleViewportTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    lastTouchClientYRef.current = event.touches[0]?.clientY ?? null;
  }, []);
  const handleViewportTouchMove = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      const touch = event.touches[0];
      if (!touch) return;

      const previousClientY = lastTouchClientYRef.current;
      lastTouchClientYRef.current = touch.clientY;
      if (previousClientY === null) return;

      restoreLiveTailForGesture(event.currentTarget, event.target, previousClientY - touch.clientY);
    },
    [restoreLiveTailForGesture],
  );
  const handleViewportTouchEnd = useCallback(() => {
    lastTouchClientYRef.current = null;
  }, []);

  return {
    viewportHandlers: {
      onKeyDown: handleViewportKeyDown,
      onTouchCancel: handleViewportTouchEnd,
      onTouchEnd: handleViewportTouchEnd,
      onTouchMove: handleViewportTouchMove,
      onTouchStart: handleViewportTouchStart,
      onWheel: handleViewportWheel,
    },
  };
}

function shouldRestoreLiveTailForScrollGesture(
  isAtEnd: boolean,
  viewport: HTMLElement,
  target: EventTarget | null,
  deltaY: number,
): boolean {
  if (!isAtEnd) return false;
  if (deltaY > 0) return true;
  return canNestedScrollContainerHandleGesture(viewport, target, deltaY);
}

function shouldRestoreLiveTailForKeyboardScroll(
  isAtEnd: boolean,
  event: KeyboardEvent<HTMLDivElement>,
): boolean {
  if (!isAtEnd) return false;

  const direction = getKeyboardScrollDirection(event);
  if (direction === 0) return false;
  if (event.target === event.currentTarget) return direction > 0;
  if (isNonScrollingInteractiveTarget(event.currentTarget, event.target)) return true;
  if (!hasVerticalNestedScrollContainer(event.currentTarget, event.target)) return false;

  return (
    direction > 0 ||
    canNestedScrollContainerHandleGesture(event.currentTarget, event.target, direction)
  );
}

function getKeyboardScrollDirection(event: KeyboardEvent<HTMLDivElement>): number {
  if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === 'End') {
    return 1;
  }
  if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home') {
    return -1;
  }
  if (event.key === ' ' || event.key === 'Spacebar') return event.shiftKey ? -1 : 1;

  return 0;
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
    if (canNestedScrollVerticallyInDirection(element, direction)) return true;
    element = element.parentElement;
  }

  return false;
}

function isNonScrollingInteractiveTarget(
  viewport: HTMLElement,
  target: EventTarget | null,
): boolean {
  let element = getTargetElement(target);
  while (element && element !== viewport) {
    if (isInteractiveElement(element)) return true;
    element = element.parentElement;
  }

  return false;
}

function isInteractiveElement(element: HTMLElement): boolean {
  if (element.isContentEditable) return true;

  const tagName = element.tagName;
  if (
    tagName === 'BUTTON' ||
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT'
  ) {
    return true;
  }
  if (tagName === 'A' && element.hasAttribute('href')) return true;

  const role = element.getAttribute('role');
  return (
    role === 'button' ||
    role === 'checkbox' ||
    role === 'combobox' ||
    role === 'link' ||
    role === 'menuitem' ||
    role === 'option' ||
    role === 'radio' ||
    role === 'slider' ||
    role === 'spinbutton' ||
    role === 'switch' ||
    role === 'tab' ||
    role === 'textbox'
  );
}

function hasVerticalNestedScrollContainer(
  viewport: HTMLElement,
  target: EventTarget | null,
): boolean {
  let element = getTargetElement(target);
  while (element && element !== viewport) {
    if (isVerticalNestedScrollContainer(element)) return true;
    element = element.parentElement;
  }

  return false;
}

function getTargetElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Node)) return null;
  return target instanceof HTMLElement ? target : target.parentElement;
}

function canNestedScrollVerticallyInDirection(element: HTMLElement, direction: number): boolean {
  if (!isVerticalNestedScrollContainer(element)) return false;
  if (element.scrollHeight <= element.clientHeight) return false;
  if (direction < 0) return element.scrollTop > 0;
  return element.scrollHeight - element.scrollTop - element.clientHeight > 0;
}

function isVerticalNestedScrollContainer(element: HTMLElement): boolean {
  const axis = element.dataset.scoutNestedScroll;
  return axis === 'vertical' || axis === 'both';
}
