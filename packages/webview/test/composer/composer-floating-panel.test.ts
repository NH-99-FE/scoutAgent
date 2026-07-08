import { describe, expect, it, vi } from 'vitest';

import { scrollComposerFloatingPanelOptionIntoView } from '@/features/composer/view/composer-floating-panel-scroll';

describe('ComposerFloatingPanel', () => {
  it('uses native nearest scrolling for the active option', () => {
    const option = document.createElement('button');
    const scrollIntoView = vi.fn();
    option.scrollIntoView = scrollIntoView;

    scrollComposerFloatingPanelOptionIntoView(option);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });

  it('ignores missing active options', () => {
    expect(() => scrollComposerFloatingPanelOptionIntoView(null)).not.toThrow();
  });
});
