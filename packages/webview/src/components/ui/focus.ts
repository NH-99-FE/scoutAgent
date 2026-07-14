// ============================================================
// UI Focus Visibility — 仅在 Tab 键盘导航时展示焦点轮廓
// ============================================================

const TAB_FOCUS_ATTRIBUTE = 'data-scout-tab-focus';

export function installTabFocusVisibility(targetDocument: Document): () => void {
  const root = targetDocument.documentElement;
  const targetWindow = targetDocument.defaultView;

  const disableTabFocus = () => {
    root.removeAttribute(TAB_FOCUS_ATTRIBUTE);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    if (event.altKey || event.ctrlKey || event.metaKey) {
      disableTabFocus();
      return;
    }
    root.setAttribute(TAB_FOCUS_ATTRIBUTE, 'true');
  };

  targetDocument.addEventListener('keydown', handleKeyDown, true);
  targetDocument.addEventListener('pointerdown', disableTabFocus, true);
  targetWindow?.addEventListener('blur', disableTabFocus);

  return () => {
    targetDocument.removeEventListener('keydown', handleKeyDown, true);
    targetDocument.removeEventListener('pointerdown', disableTabFocus, true);
    targetWindow?.removeEventListener('blur', disableTabFocus);
    disableTabFocus();
  };
}
