import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';

import { FloatingPanel } from '@/components/common/FloatingPanel';
import {
  scrollSuggestionOptionIntoView,
  useSuggestionOptionScroll,
} from '@/features/composer/hooks/use-suggestion-option-scroll';

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
  const { setOptionElement } = useSuggestionOptionScroll(activeKey);

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

describe('FloatingPanel', () => {
  it('renders optional title and content', () => {
    render(
      createElement(FloatingPanel, {
        children: 'packages/webview',
        title: '文件',
      }),
    );

    expect(screen.getByText('文件')).toBeInTheDocument();
    expect(screen.getByText('packages/webview')).toBeInTheDocument();
  });

  it('does not render an empty title container', () => {
    const { container } = render(createElement(FloatingPanel, { children: 'content' }));

    expect(container.querySelector('.border-b')).toBeNull();
  });

  it('can render non-scrollable status content', () => {
    render(
      createElement(FloatingPanel, {
        children: '没有匹配的命令',
        role: 'status',
        scrollable: false,
      }),
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('没有匹配的命令');
    expect(status.querySelector('[data-slot="scroll-area"]')).toBeNull();
  });

  it('uses native nearest scrolling for the active option', () => {
    const option = document.createElement('button');
    const scrollIntoView = vi.fn();
    option.scrollIntoView = scrollIntoView;

    scrollSuggestionOptionIntoView(option);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });

  it('ignores missing active options', () => {
    expect(() => scrollSuggestionOptionIntoView(null)).not.toThrow();
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
