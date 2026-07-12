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
  it('renders content inside one shared scroll area', () => {
    render(
      createElement(FloatingPanel, {
        children: 'packages/webview',
      }),
    );

    expect(
      screen.getByText('packages/webview').closest('[data-slot="scroll-area"]'),
    ).not.toBeNull();
  });

  it('renders accessible groups inside the shared scroll area', () => {
    render(
      createElement(FloatingPanel, {
        'aria-label': '添加内容',
        children: [
          createElement(FloatingPanel.Group, { children: '文件和文件夹', label: '添加' }),
          createElement(FloatingPanel.Group, {
            children: 'Default templates',
            label: '插件',
          }),
          createElement(FloatingPanel.Group, { children: 'Sites', label: '应用' }),
        ],
        role: 'listbox',
      }),
    );

    const addGroup = screen.getByRole('group', { name: '添加' });
    expect(addGroup).toHaveTextContent('文件和文件夹');
    expect(screen.getByRole('group', { name: '插件' })).toHaveTextContent('Default templates');
    expect(screen.getByRole('group', { name: '应用' })).toHaveTextContent('Sites');
    expect(addGroup.closest('[data-slot="scroll-area"]')).not.toBeNull();
  });

  it('uses one canonical option layout for panel options', () => {
    render(
      createElement(FloatingPanel, {
        'aria-label': '候选项',
        children: createElement(FloatingPanel.Option, {
          active: true,
          description: '查看会话树',
          icon: createElement('svg'),
          label: '会话树',
        }),
        role: 'listbox',
      }),
    );

    const option = screen.getByRole('option', { name: '会话树 查看会话树' });
    expect(option).toHaveAttribute('aria-selected', 'true');
    expect(option).toHaveClass('h-7', 'gap-1.5', 'rounded-lg', 'px-2', 'text-xs');
    expect(screen.getByText('会话树')).toHaveClass('max-w-[58%]', 'font-medium');
    expect(screen.getByText('查看会话树')).toHaveClass('w-0', 'flex-1');
  });

  it('renders status content without scrolling or a clipping height cap', () => {
    render(
      createElement(FloatingPanel, {
        children: '没有匹配的命令',
        role: 'status',
        variant: 'status',
      }),
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('没有匹配的命令');
    expect(status).not.toHaveClass('max-h-[min(280px,42vh)]');
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
