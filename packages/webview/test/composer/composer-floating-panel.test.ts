import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render } from '@testing-library/react';

import {
  scrollComposerFloatingPanelOptionIntoView,
  useComposerFloatingPanelOptionScroll,
} from '@/features/composer/view/composer-floating-panel-scroll';

function TestPanel({
  activeKey,
  firstScrollIntoView,
  renderTick,
  secondScrollIntoView,
}: {
  activeKey: string | null;
  firstScrollIntoView: () => void;
  renderTick: number;
  secondScrollIntoView: () => void;
}) {
  const { setOptionElement } = useComposerFloatingPanelOptionScroll(activeKey);

  return createElement(
    'div',
    { 'data-render-tick': renderTick },
    createElement(
      'button',
      {
        ref: (element: HTMLButtonElement | null) => {
          if (element) element.scrollIntoView = firstScrollIntoView;
          setOptionElement('first', element);
        },
        type: 'button',
      },
      'First',
    ),
    createElement(
      'button',
      {
        ref: (element: HTMLButtonElement | null) => {
          if (element) element.scrollIntoView = secondScrollIntoView;
          setOptionElement('second', element);
        },
        type: 'button',
      },
      'Second',
    ),
  );
}

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

  it('does not pull the active option back into view on unrelated renders', () => {
    const firstScrollIntoView = vi.fn();
    const secondScrollIntoView = vi.fn();
    const { rerender } = render(
      createElement(TestPanel, {
        activeKey: 'first',
        firstScrollIntoView,
        renderTick: 0,
        secondScrollIntoView,
      }),
    );

    expect(firstScrollIntoView).toHaveBeenCalledTimes(1);

    rerender(
      createElement(TestPanel, {
        activeKey: 'first',
        firstScrollIntoView,
        renderTick: 1,
        secondScrollIntoView,
      }),
    );

    expect(firstScrollIntoView).toHaveBeenCalledTimes(1);

    rerender(
      createElement(TestPanel, {
        activeKey: 'second',
        firstScrollIntoView,
        renderTick: 2,
        secondScrollIntoView,
      }),
    );

    expect(secondScrollIntoView).toHaveBeenCalledTimes(1);
  });
});
