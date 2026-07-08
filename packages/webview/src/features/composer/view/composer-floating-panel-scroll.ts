// ============================================================
// Composer Floating Panel Scroll — Composer 浮层选中项滚动策略
// ============================================================

import { useCallback, useLayoutEffect, useRef } from 'react';

type PanelOptionKey = string | number;

// ---------- Hook ----------

export function useComposerFloatingPanelOptionScroll(activeKey: PanelOptionKey | null) {
  const optionRefs = useRef(new Map<PanelOptionKey, HTMLElement>());

  const setOptionElement = useCallback((key: PanelOptionKey, element: HTMLElement | null) => {
    if (element) {
      optionRefs.current.set(key, element);
      return;
    }
    optionRefs.current.delete(key);
  }, []);

  useLayoutEffect(() => {
    if (activeKey === null) return;
    scrollComposerFloatingPanelOptionIntoView(optionRefs.current.get(activeKey) ?? null);
  });

  return { setOptionElement };
}

// ---------- Scroll ----------

export function scrollComposerFloatingPanelOptionIntoView(option: HTMLElement | null) {
  option?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}
