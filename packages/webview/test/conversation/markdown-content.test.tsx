import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const markdownRenderCount = vi.hoisted(() => ({ value: 0 }));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: ReactNode }) => {
    markdownRenderCount.value += 1;
    return <div data-testid="react-markdown">{children}</div>;
  },
}));

import { MarkdownContent } from '@/features/conversation/view/MarkdownContent';

describe('MarkdownContent', () => {
  beforeEach(() => {
    markdownRenderCount.value = 0;
  });

  it('does not rerender markdown when content props are unchanged', () => {
    const { rerender } = render(
      <MarkdownContent className="text-sm">hello **Scout**</MarkdownContent>,
    );

    expect(screen.getByTestId('react-markdown')).toHaveTextContent('hello **Scout**');
    expect(markdownRenderCount.value).toBe(1);

    rerender(<MarkdownContent className="text-sm">hello **Scout**</MarkdownContent>);

    expect(markdownRenderCount.value).toBe(1);
  });
});
