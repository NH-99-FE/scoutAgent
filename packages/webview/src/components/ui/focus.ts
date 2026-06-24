// ============================================================
// UI Focus Helpers — 统一焦点轮廓抑制样式
// ============================================================

import type * as React from 'react';

const SUPPRESS_FOCUS_OUTLINE_ATTRIBUTE = 'data-scout-suppress-focus-outline';

export function markPointerFocus<TElement extends HTMLElement>(
  event: React.PointerEvent<TElement>,
) {
  event.currentTarget.setAttribute(SUPPRESS_FOCUS_OUTLINE_ATTRIBUTE, 'true');
}

export function markProgrammaticFocus<TElement extends HTMLElement>(element: TElement | null) {
  element?.setAttribute(SUPPRESS_FOCUS_OUTLINE_ATTRIBUTE, 'true');
}

export function clearPointerFocus<TElement extends HTMLElement>(event: React.FocusEvent<TElement>) {
  if (event.relatedTarget === null) return;
  event.currentTarget.removeAttribute(SUPPRESS_FOCUS_OUTLINE_ATTRIBUTE);
}
