import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoutBusyState } from '@scout-agent/shared';
import type { ComponentProps, ReactNode, Ref } from 'react';

const messageScrollerMock = vi.hoisted(() => ({
  providerProps: [] as Array<{ defaultScrollPosition?: string }>,
  viewportProps: [] as Array<{ preserveScrollOnPrepend?: boolean }>,
  scrollToEnd: vi.fn(),
  scrollToMessage: vi.fn(),
  scrollToStart: vi.fn(),
}));

vi.mock('@/components/ui/message-scroller', () => ({
  MessageScrollerProvider: ({
    children,
    ...props
  }: {
    children?: ReactNode;
    defaultScrollPosition?: string;
  }) => {
    messageScrollerMock.providerProps.push(props);
    return <>{children}</>;
  },
  MessageScroller: ({ children, ...props }: ComponentProps<'div'>) => (
    <div data-slot="message-scroller" {...props}>
      {children}
    </div>
  ),
  MessageScrollerViewport: ({
    children,
    preserveScrollOnPrepend,
    ref,
    ...props
  }: ComponentProps<'div'> & {
    preserveScrollOnPrepend?: boolean;
    ref?: Ref<HTMLDivElement>;
  }) => {
    messageScrollerMock.viewportProps.push({ preserveScrollOnPrepend });
    return (
      <div data-slot="message-scroller-viewport" ref={ref} {...props}>
        {children}
      </div>
    );
  },
  MessageScrollerContent: ({ children, ...props }: ComponentProps<'div'>) => (
    <div data-slot="message-scroller-content" {...props}>
      {children}
    </div>
  ),
  MessageScrollerItem: ({
    children,
    messageId,
    scrollAnchor = false,
    ...props
  }: ComponentProps<'div'> & { messageId?: string; scrollAnchor?: boolean }) => (
    <div
      data-message-id={messageId}
      data-scroll-anchor={scrollAnchor ? 'true' : 'false'}
      data-slot="message-scroller-item"
      {...props}
    >
      {children}
    </div>
  ),
  MessageScrollerButton: (props: ComponentProps<'button'>) => <button {...props} />,
  useMessageScroller: () => ({
    scrollToEnd: messageScrollerMock.scrollToEnd,
    scrollToMessage: messageScrollerMock.scrollToMessage,
    scrollToStart: messageScrollerMock.scrollToStart,
  }),
  useMessageScrollerScrollable: () => ({ start: false, end: false }),
}));

import { ConversationView } from '@/features/conversation/ConversationView';
import type { ConversationItem } from '@/store/conversation-store';

const IDLE_BUSY_STATE: ScoutBusyState = { kind: 'idle', cancellable: false };

function makeUserConversationItems(count: number) {
  return Array.from(
    { length: count },
    (_, index): ConversationItem => ({
      key: `user-${index}`,
      message: {
        role: 'user',
        content: `message ${index}`,
        timestamp: index + 1,
      },
    }),
  );
}

describe('ConversationView MessageScroller props', () => {
  beforeEach(() => {
    messageScrollerMock.providerProps.length = 0;
    messageScrollerMock.viewportProps.length = 0;
    messageScrollerMock.scrollToEnd.mockClear();
    messageScrollerMock.scrollToMessage.mockClear();
    messageScrollerMock.scrollToStart.mockClear();
  });

  it('keeps default scroll position stable across rerenders', () => {
    const { rerender } = render(
      <ConversationView
        busyState={IDLE_BUSY_STATE}
        isStreaming={false}
        items={makeUserConversationItems(1)}
        toolExecutionsById={{}}
      />,
    );

    rerender(
      <ConversationView
        busyState={IDLE_BUSY_STATE}
        isStreaming={false}
        items={makeUserConversationItems(2)}
        toolExecutionsById={{}}
      />,
    );

    expect(messageScrollerMock.providerProps.map((props) => props.defaultScrollPosition)).toEqual([
      'end',
      'end',
    ]);
  });

  it('does not enable prepend preservation without history pagination', () => {
    const { rerender } = render(
      <ConversationView
        busyState={IDLE_BUSY_STATE}
        isStreaming={false}
        items={makeUserConversationItems(1)}
        toolExecutionsById={{}}
      />,
    );

    rerender(
      <ConversationView
        busyState={IDLE_BUSY_STATE}
        isStreaming={false}
        items={makeUserConversationItems(2)}
        toolExecutionsById={{}}
      />,
    );

    expect(messageScrollerMock.viewportProps.map((props) => props.preserveScrollOnPrepend)).toEqual(
      [false, false],
    );
  });

  it('keeps prepend preservation out of the ConversationView contract', () => {
    render(
      <ConversationView
        busyState={IDLE_BUSY_STATE}
        isStreaming={false}
        items={makeUserConversationItems(1)}
        toolExecutionsById={{}}
      />,
    );

    expect(messageScrollerMock.viewportProps.at(-1)?.preserveScrollOnPrepend).toBe(false);
  });
});
