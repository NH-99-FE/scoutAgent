import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ScrollArea } from '@/components/ui/scroll-area';

describe('ScrollArea', () => {
  it('marks the viewport as a vertical nested scroll container by default', () => {
    const { container } = render(<ScrollArea>content</ScrollArea>);

    expect(container.querySelector('[data-slot="scroll-area-viewport"]')).toHaveAttribute(
      'data-scout-nested-scroll',
      'vertical',
    );
  });

  it('marks both axes when both scrollbars are enabled', () => {
    const { container } = render(<ScrollArea scrollbars="both">content</ScrollArea>);

    expect(container.querySelector('[data-slot="scroll-area-viewport"]')).toHaveAttribute(
      'data-scout-nested-scroll',
      'both',
    );
  });
});
