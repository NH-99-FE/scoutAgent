import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  downloadImage: vi.fn(),
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
    protocolClientMock.downloadImage.mockReset();
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

  it('renders skill invocation user messages without raw wrapper text', () => {
    const rows: ConversationTranscriptRow[] = [
      {
        type: 'user',
        key: 'user-skill',
        message: {
          role: 'user',
          content: [
            {
              type: 'skillInvocation',
              name: 'deploy',
              location: '/workspace/.scout/skills/deploy/SKILL.md',
              content:
                'References are relative to /workspace/.scout/skills/deploy.\n\nDeploy carefully.',
              userMessage: 'Use staging',
            },
            { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
          ],
          timestamp: 1,
        },
      },
    ];

    const { container } = render(
      <ConversationTranscript expansionScope="test" isStreaming={false} rows={rows} />,
    );

    expect(screen.getByText('deploy')).toBeInTheDocument();
    expect(screen.getByText('Use staging')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '已发送图片 1' })).toHaveAttribute(
      'src',
      'data:image/png;base64,aW1hZ2U=',
    );
    expect(container.textContent).not.toContain('<skill');
    expect(container.textContent).not.toContain('</skill>');
  });

  it('renders user images outside the text bubble and previews the image group', async () => {
    const scrollWidth = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(640);
    const rows: ConversationTranscriptRow[] = [
      {
        type: 'user',
        key: 'user-image',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect this screenshot' },
            { type: 'image', data: 'Zmlyc3Q=', mimeType: 'image/png' },
            { type: 'image', data: 'c2Vjb25k', mimeType: 'image/jpeg' },
            { type: 'image', data: 'dGhpcmQ=', mimeType: 'image/webp' },
          ],
          timestamp: 1,
        },
      },
    ];

    const { container } = render(
      <ConversationTranscript expansionScope="test" isStreaming={false} rows={rows} />,
    );

    expect(screen.getByText('Inspect this screenshot')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '已发送图片 1' })).toHaveAttribute(
      'src',
      'data:image/png;base64,Zmlyc3Q=',
    );
    const bubble = container.querySelector('.scout-user-message');
    const tray = container.querySelector('.scout-user-image-tray');
    const viewport = tray?.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement;
    expect(bubble).not.toBeNull();
    expect(tray).not.toBeNull();
    expect(tray).toHaveClass('w-full', '[&_[data-slot=scroll-area-scrollbar]]:hidden');
    expect(bubble?.previousElementSibling).toBe(tray);
    expect(viewport).toHaveAttribute('data-scout-nested-scroll', 'horizontal');
    expect(viewport).toHaveClass('overflow-x-auto', 'overflow-y-hidden');
    expect(viewport.scrollLeft).toBe(640);
    expect(within(bubble as HTMLElement).queryByRole('img')).not.toBeInTheDocument();
    expect(container.textContent).not.toContain('[image]');

    const firstPreviewButton = screen.getByRole('button', { name: '预览已发送图片 1' });
    firstPreviewButton.focus();
    fireEvent.click(firstPreviewButton);

    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '图片预览' })).toHaveAttribute(
      'src',
      'data:image/png;base64,Zmlyc3Q=',
    );
    fireEvent.click(screen.getByRole('button', { name: '下载图片' }));
    expect(protocolClientMock.downloadImage).toHaveBeenCalledWith(
      { type: 'image', data: 'Zmlyc3Q=', mimeType: 'image/png' },
      'scout-image-1.png',
    );
    expect(screen.queryByRole('button', { name: '上一张图片' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一张图片' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '放大图片' }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一张图片' }));
    expect(screen.getByRole('img', { name: '图片预览' })).toHaveAttribute(
      'src',
      'data:image/jpeg;base64,c2Vjb25k',
    );
    fireEvent.click(screen.getByRole('button', { name: '下载图片' }));
    expect(protocolClientMock.downloadImage).toHaveBeenLastCalledWith(
      { type: 'image', data: 'c2Vjb25k', mimeType: 'image/jpeg' },
      'scout-image-2.jpg',
    );
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一张图片' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一张图片' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '下一张图片' }));
    expect(screen.getByRole('img', { name: '图片预览' })).toHaveAttribute(
      'src',
      'data:image/webp;base64,dGhpcmQ=',
    );
    expect(screen.getByRole('button', { name: '上一张图片' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下一张图片' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
    await waitFor(() => expect(firstPreviewButton).toHaveFocus());
    scrollWidth.mockRestore();
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
