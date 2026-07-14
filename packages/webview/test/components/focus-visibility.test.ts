import { afterEach, describe, expect, it } from 'vitest';
import { installTabFocusVisibility } from '@/components/ui/focus';

describe('installTabFocusVisibility', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    document.documentElement.removeAttribute('data-scout-tab-focus');
  });

  it('enables focus decoration only for unmodified Tab navigation', () => {
    cleanup = installTabFocusVisibility(document);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.documentElement).toHaveAttribute('data-scout-tab-focus', 'true');

    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(document.documentElement).not.toHaveAttribute('data-scout-tab-focus');

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', altKey: true, bubbles: true }),
    );
    expect(document.documentElement).not.toHaveAttribute('data-scout-tab-focus');

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
    );
    expect(document.documentElement).toHaveAttribute('data-scout-tab-focus', 'true');

    window.dispatchEvent(new FocusEvent('blur'));
    expect(document.documentElement).not.toHaveAttribute('data-scout-tab-focus');
  });

  it('removes its global listeners and focus state during cleanup', () => {
    cleanup = installTabFocusVisibility(document);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

    cleanup();
    cleanup = undefined;
    expect(document.documentElement).not.toHaveAttribute('data-scout-tab-focus');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.documentElement).not.toHaveAttribute('data-scout-tab-focus');
  });
});
