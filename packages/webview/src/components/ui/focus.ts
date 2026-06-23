// ============================================================
// UI Focus Helpers — 统一鼠标焦点与浮层焦点样式
// ============================================================

import type * as React from 'react';

const POINTER_FOCUS_ATTRIBUTE = 'data-scout-pointer-focus';

export function markPointerFocus<TElement extends HTMLElement>(
  event: React.PointerEvent<TElement>,
) {
  event.currentTarget.setAttribute(POINTER_FOCUS_ATTRIBUTE, 'true');
}

export function clearPointerFocus<TElement extends HTMLElement>(event: React.FocusEvent<TElement>) {
  event.currentTarget.removeAttribute(POINTER_FOCUS_ATTRIBUTE);
}
