// ============================================================
// Suggestion Option Scroll — 候选浮层选中项滚动策略
// ============================================================

import { useCallback, useLayoutEffect, useRef } from 'react';

type SuggestionOptionKey = string | number;

// ---------- Hook ----------

export function useSuggestionOptionScroll(activeKey: SuggestionOptionKey | null) {
  const optionRefs = useRef(new Map<SuggestionOptionKey, HTMLElement>());

  const setOptionElement = useCallback((key: SuggestionOptionKey, element: HTMLElement | null) => {
    if (element) {
      optionRefs.current.set(key, element);
      return;
    }
    optionRefs.current.delete(key);
  }, []);

  useLayoutEffect(() => {
    if (activeKey === null) return;
    scrollSuggestionOptionIntoView(optionRefs.current.get(activeKey) ?? null);
  }, [activeKey]);

  return { setOptionElement };
}

// ---------- Scroll ----------

export function scrollSuggestionOptionIntoView(option: HTMLElement | null) {
  option?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}
