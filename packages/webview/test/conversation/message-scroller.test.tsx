import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';

describe('MessageScroller', () => {
  it('keeps top-level message items out of browser lazy layout', () => {
    const { container } = render(
      <MessageScrollerProvider>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent>
              <MessageScrollerItem messageId="message-1">
                <div>hello</div>
              </MessageScrollerItem>
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>,
    );

    const itemClassName =
      container.querySelector<HTMLElement>('[data-message-id="message-1"]')?.className ?? '';

    expect(itemClassName).not.toContain('content-visibility');
    expect(itemClassName).not.toContain('contain-intrinsic-size');
  });
});
