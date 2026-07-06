import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import type { ScoutExtensionUIRequest } from '@scout-agent/shared';

const scrollerItemRenderCounts = vi.hoisted(() => new Map<string, number>());

vi.mock('@/features/conversation/view/ConversationScroller', () => ({
  ConversationScrollerContent: ({ children, ...props }: ComponentProps<'div'>) => (
    <div data-slot="message-scroller-content" {...props}>
      {children}
    </div>
  ),
  ConversationScrollerItem: ({
    children,
    messageId,
    ...props
  }: ComponentProps<'div'> & { messageId: string; children?: ReactNode }) => {
    scrollerItemRenderCounts.set(messageId, (scrollerItemRenderCounts.get(messageId) ?? 0) + 1);

    return (
      <div data-message-id={messageId} data-slot="message-scroller-item" {...props}>
        {children}
      </div>
    );
  },
}));

const protocolClientMock = vi.hoisted(() => ({
  extensionUIResponse: vi.fn(),
}));

vi.mock('@/bridge/protocol-client', () => ({
  protocolClient: protocolClientMock,
}));

import { ConversationTranscript } from '@/features/conversation/view/ConversationTranscript';
import type { ConversationTranscriptRow } from '@/features/conversation/render-model/conversation-transcript-rows';

describe('ConversationTranscript', () => {
  beforeEach(() => {
    scrollerItemRenderCounts.clear();
  });

  it('renders typed extension request rows as transcript items', () => {
    const request: ScoutExtensionUIRequest = {
      type: 'extension_ui_request',
      id: 'approval-1',
      method: 'confirm',
      title: 'Approve command',
      message: 'Proceed?',
    };
    const rows: ConversationTranscriptRow[] = [
      {
        type: 'extension_requests',
        key: 'conversation-extension-requests',
        requests: [request],
      },
    ];

    const { container } = render(
      <ConversationTranscript expansionScope="test" isStreaming={false} rows={rows} />,
    );

    expect(
      container.querySelector('[data-message-id="conversation-extension-requests"]'),
    ).toBeInTheDocument();
    expect(screen.getByText('Approve command')).toBeInTheDocument();
    expect(screen.getByText('Proceed?')).toBeInTheDocument();
  });

  it('does not rerender stable history rows when a streaming row changes', () => {
    const stableUserRow: ConversationTranscriptRow = {
      type: 'user',
      key: 'user-1',
      message: {
        role: 'user',
        content: 'first',
        timestamp: 1,
      },
    };
    const streamingAssistantStart = makeAssistantTextRow('assistant-turn:user-2', 'hel');
    const streamingAssistantUpdate = makeAssistantTextRow('assistant-turn:user-2', 'hello');

    const { rerender } = render(
      <ConversationTranscript
        expansionScope="test"
        isStreaming={true}
        rows={[stableUserRow, streamingAssistantStart]}
      />,
    );

    expect(scrollerItemRenderCounts.get('user-1')).toBe(1);
    expect(scrollerItemRenderCounts.get('assistant-turn:user-2')).toBe(1);

    rerender(
      <ConversationTranscript
        expansionScope="test"
        isStreaming={true}
        rows={[stableUserRow, streamingAssistantUpdate]}
      />,
    );

    expect(scrollerItemRenderCounts.get('user-1')).toBe(1);
    expect(scrollerItemRenderCounts.get('assistant-turn:user-2')).toBe(2);
  });
});

function makeAssistantTextRow(key: string, text: string): ConversationTranscriptRow {
  return {
    type: 'assistant',
    key,
    entries: [
      {
        type: 'content',
        key: `${key}:content`,
        blocks: [{ type: 'text', text }],
        timestamp: 2,
      },
    ],
    changesReviews: [],
    actionText: text,
    timestamp: 2,
    isLatestAssistant: true,
    isStreaming: true,
  };
}
