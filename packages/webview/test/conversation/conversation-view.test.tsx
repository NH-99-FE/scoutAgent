import { act, cleanup, fireEvent as rtlFireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScoutBusyState, ScoutChangesReviewSummary } from '@scout-agent/shared';

const protocolClientMock = vi.hoisted(() => ({
  copyText: vi.fn(),
  openChangesReview: vi.fn(),
}));

vi.mock('@/bridge/protocol-client', () => ({
  protocolClient: protocolClientMock,
}));

import { ConversationView } from '@/features/conversation/ConversationView';
import {
  buildConversationRows,
  createConversationRowsProjector,
  type AssistantProcessActivity,
  type ConversationViewItem,
} from '@/features/conversation/conversation-view-model';
import type {
  ConversationItem,
  ToolCallPreviewState,
  ToolExecutionState,
} from '@/store/conversation-store';
import { useConversationExpansionStore } from '@/store/conversation-expansion-store';

const IDLE_BUSY_STATE: ScoutBusyState = { kind: 'idle', cancellable: false };
const AGENT_BUSY_STATE: ScoutBusyState = { kind: 'agent', label: 'Working', cancellable: true };

const fireEvent = {
  click: (...args: Parameters<typeof rtlFireEvent.click>) => {
    let result = false;
    act(() => {
      result = rtlFireEvent.click(...args);
    });
    return result;
  },
  scroll: (...args: Parameters<typeof rtlFireEvent.scroll>) => {
    let result = false;
    act(() => {
      result = rtlFireEvent.scroll(...args);
    });
    return result;
  },
  touchMove: (...args: Parameters<typeof rtlFireEvent.touchMove>) => {
    let result = false;
    act(() => {
      result = rtlFireEvent.touchMove(...args);
    });
    return result;
  },
  wheel: (...args: Parameters<typeof rtlFireEvent.wheel>) => {
    let result = false;
    act(() => {
      result = rtlFireEvent.wheel(...args);
    });
    return result;
  },
};

function renderConversation({
  busyState,
  expansionScope,
  forceScrollToBottomKey,
  items,
  isStreaming = false,
  showScrollToBottomButton = false,
  toolExecutionsById = {},
  toolPreviewsById = {},
}: {
  busyState?: ScoutBusyState;
  expansionScope?: string;
  forceScrollToBottomKey?: unknown;
  items: ConversationViewItem[];
  isStreaming?: boolean;
  showScrollToBottomButton?: boolean;
  toolExecutionsById?: Record<string, ToolExecutionState>;
  toolPreviewsById?: Record<string, ToolCallPreviewState>;
}) {
  const resolvedBusyState = busyState ?? (isStreaming ? AGENT_BUSY_STATE : IDLE_BUSY_STATE);
  return render(
    <ConversationView
      busyState={resolvedBusyState}
      expansionScope={expansionScope}
      forceScrollToBottomKey={forceScrollToBottomKey}
      isStreaming={isStreaming}
      items={items}
      showScrollToBottomButton={showScrollToBottomButton}
      toolExecutionsById={toolExecutionsById}
      toolPreviewsById={toolPreviewsById}
    />,
  );
}

function expandCompletedTurn() {
  fireEvent.click(screen.getByRole('button', { name: /展开回复 已处理/ }));
}

function expectToolErrorSummary(action: string, target: string) {
  const actionLabel = screen.getByText(action, { selector: '[data-tool-summary-action]' });
  const targetLabel = screen.getByText(target, { selector: '[data-tool-summary-target]' });

  expect(actionLabel).toHaveClass('text-destructive');
  expect(targetLabel.closest('.text-destructive')).toBeNull();
}

function ensureFileChangeDiffExpanded(pathPattern: RegExp) {
  const closedToggle = screen.queryByRole('button', {
    name: new RegExp(`展开文件变更 ${pathPattern.source}`),
  });
  if (closedToggle) {
    fireEvent.click(closedToggle);
    return;
  }
  expect(
    screen.getByRole('button', {
      name: new RegExp(`收起文件变更 ${pathPattern.source}`),
    }),
  ).toBeInTheDocument();
}

function setViewportScrollMetrics(
  viewport: HTMLElement,
  metrics: { clientHeight: number; scrollHeight: number; scrollTop: number },
) {
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    viewport.scrollTop = options.top ?? viewport.scrollTop;
  });
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: metrics.clientHeight },
    scrollHeight: { configurable: true, value: metrics.scrollHeight },
    scrollTop: { configurable: true, value: metrics.scrollTop, writable: true },
    scrollTo: {
      configurable: true,
      value: scrollTo,
    },
  });
  return scrollTo;
}

function makeUserConversationItems(count: number, contentOverrides: Record<number, string> = {}) {
  return Array.from(
    { length: count },
    (_, index): ConversationItem => ({
      key: `user-${index}`,
      message: {
        role: 'user',
        content: contentOverrides[index] ?? `message ${index}`,
        timestamp: index + 1,
      },
    }),
  );
}

function isToolActivity(
  activity: AssistantProcessActivity,
): activity is Extract<AssistantProcessActivity, { type: 'tool' }> {
  return activity.type === 'tool';
}

function makeChangesReviewSummary(
  overrides: Partial<ScoutChangesReviewSummary> = {},
): ScoutChangesReviewSummary {
  const files = overrides.files ?? [
    {
      path: '/workspace/src/app.ts',
      displayPath: 'src/app.ts',
      additions: 2,
      deletions: 1,
    },
  ];
  return {
    turnId: 'turn-1',
    fileCount: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files,
    ...overrides,
  };
}

describe('ConversationView', () => {
  afterEach(() => {
    useConversationExpansionStore.getState().actions.reset();
    protocolClientMock.copyText.mockReset();
    protocolClientMock.openChangesReview.mockReset();
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens running thinking by default and collapses it after completion', () => {
    const items: ConversationItem[] = [
      {
        key: 'message-1',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: '分析当前布局' }],
          timestamp: 1,
        },
      },
    ];
    const { container, rerender } = renderConversation({
      items,
      isStreaming: true,
    });

    expect(screen.getByText('正在思考')).toBeInTheDocument();
    expect(screen.getByText('分析当前布局')).toBeInTheDocument();
    expect(container.querySelector('[data-process-disclosure-icon]')).toBeNull();
    expect(container.querySelector('[data-assistant-turn-disclosure-icon]')).toBeNull();

    rerender(
      <ConversationView
        busyState={IDLE_BUSY_STATE}
        isStreaming={false}
        items={items}
        toolExecutionsById={{}}
      />,
    );

    const turnSummaryButton = screen.getByRole('button', { name: /展开回复 已处理/ });
    expect(turnSummaryButton).toBeInTheDocument();
    expect(turnSummaryButton.className).not.toContain('-ml-1');
    expect(turnSummaryButton.className).not.toContain('px-1');
    expect(turnSummaryButton.className).not.toContain('py-0.5');
    expect(turnSummaryButton.parentElement).toHaveClass('border-b');
    expect(container.querySelector('[data-assistant-turn-disclosure-icon]')).toBeTruthy();
    expect(screen.queryByText('分析当前布局')).not.toBeInTheDocument();

    fireEvent.click(turnSummaryButton);
    expect(screen.getByText('分析当前布局')).toBeInTheDocument();
  });

  it('collapses process history once final answer content starts streaming', () => {
    renderConversation({
      items: [
        {
          key: 'message-1',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: '分析当前布局' },
              { type: 'text', text: '最终答案开始输出' },
            ],
            timestamp: 1,
          },
        },
      ],
      isStreaming: true,
    });

    expect(screen.queryByRole('button', { name: /展开过程 已处理/ })).not.toBeInTheDocument();
    expect(screen.getByText('正在思考')).toBeInTheDocument();
    expect(screen.queryByText('分析当前布局')).not.toBeInTheDocument();
    expect(screen.getByText('最终答案开始输出')).toBeInTheDocument();
  });

  it('starts a new running process segment below text when tools continue', () => {
    renderConversation({
      items: [
        {
          key: 'message-1',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: '分析当前布局' },
              { type: 'text', text: '我先看一下文件' },
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'read',
                arguments: { path: 'README.md' },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      isStreaming: true,
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'read',
          args: { path: 'README.md' },
          status: 'running',
          isError: false,
        },
      },
    });

    const text = screen.getByText('我先看一下文件');
    const runningTool = screen.getByText('正在阅读 README.md');

    expect(screen.queryByRole('button', { name: /展开过程 已处理/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /收起过程 正在处理/ })).not.toBeInTheDocument();
    expect(screen.getByText('正在处理')).toBeInTheDocument();
    expect(screen.queryByText('分析当前布局')).not.toBeInTheDocument();
    expect(text.compareDocumentPosition(runningTool) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('collapses a running process segment when a following text block arrives', () => {
    const initialItems: ConversationItem[] = [
      {
        key: 'message-1',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '分析当前布局' },
            {
              type: 'toolCall',
              id: 'tool-1',
              name: 'read',
              arguments: { path: 'README.md' },
            },
          ],
          timestamp: 1,
        },
      },
    ];
    const nextItems: ConversationItem[] = [
      {
        key: 'message-1',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '分析当前布局' },
            {
              type: 'toolCall',
              id: 'tool-1',
              name: 'read',
              arguments: { path: 'README.md' },
            },
            { type: 'text', text: '文件读完了，继续分析' },
          ],
          timestamp: 1,
        },
      },
    ];
    const toolExecutionsById: Record<string, ToolExecutionState> = {
      'tool-1': {
        toolCallId: 'tool-1',
        toolName: 'read',
        args: { path: 'README.md' },
        status: 'running',
        isError: false,
      },
    };
    const { rerender } = renderConversation({
      items: initialItems,
      isStreaming: true,
      toolExecutionsById,
    });

    expect(screen.queryByRole('button', { name: /收起过程 正在处理/ })).not.toBeInTheDocument();
    expect(screen.getByText('分析当前布局')).toBeInTheDocument();
    expect(screen.getByText('正在阅读 README.md')).toBeInTheDocument();

    rerender(
      <ConversationView
        busyState={AGENT_BUSY_STATE}
        isStreaming={true}
        items={nextItems}
        toolExecutionsById={toolExecutionsById}
      />,
    );

    expect(screen.getByText('文件读完了，继续分析')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /展开过程 正在阅读 README\.md/ }),
    ).not.toBeInTheDocument();
    const thinking = screen.getByText('分析当前布局');
    const runningTool = screen.getByText('正在阅读 README.md');
    expect(thinking.compareDocumentPosition(runningTool) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('keeps the assistant turn marked as processing after work content starts streaming', () => {
    renderConversation({
      items: [
        {
          key: 'message-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'read',
                arguments: { path: 'README.md' },
              },
              { type: 'text', text: '读完了，继续整理结论' },
            ],
            timestamp: 1,
          },
        },
      ],
      isStreaming: true,
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'read',
          args: { path: 'README.md' },
          status: 'done',
          isError: false,
        },
      },
    });

    expect(screen.getByText('正在处理')).toBeInTheDocument();
    expect(screen.getByText('读完了，继续整理结论')).toBeInTheDocument();
    expect(screen.getByText('正在阅读 README.md')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /展开过程 正在阅读 README\.md/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('正在思考')).not.toBeInTheDocument();
  });

  it('does not mark an older assistant as streaming when a user message is last', () => {
    renderConversation({
      isStreaming: true,
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: '上一轮思考' }],
            timestamp: 1,
          },
        },
        {
          key: 'user-1',
          message: {
            role: 'user',
            content: '继续',
            timestamp: 2,
          },
        },
      ],
    });

    expect(screen.getByRole('button', { name: /展开回复 已处理/ })).toBeInTheDocument();
    expect(screen.queryByText('上一轮思考')).not.toBeInTheDocument();
    expandCompletedTurn();
    expect(screen.getByText('正在思考')).toBeInTheDocument();
    expect(screen.getByText('上一轮思考')).toBeInTheDocument();
  });

  it('renders a derived-session origin notice from a UI-only conversation item', () => {
    const items = [
      {
        key: 'user-0',
        message: {
          role: 'user' as const,
          content: 'message 0',
          entryId: 'fork-point',
          timestamp: 1,
        },
      },
    ];
    const { container, rerender } = renderConversation({ items });
    expect(container.querySelector('[data-assistant-outcome-kind="forked"]')).toBeNull();

    rerender(
      <ConversationView
        busyState={IDLE_BUSY_STATE}
        isStreaming={false}
        items={[
          ...items,
          {
            key: 'fork-origin:fork-point',
            type: 'notice',
            notice: { kind: 'fork_origin', text: '从对话中派生' },
          },
        ]}
        toolExecutionsById={{}}
        toolPreviewsById={{}}
      />,
    );

    expect(container.querySelector('[data-assistant-outcome-kind="forked"]')).not.toBeNull();
    expect(screen.getByText('从对话中派生')).toBeInTheDocument();
  });

  it('keeps an assistant reply visible when a derived-session notice is inserted', () => {
    renderConversation({
      items: [
        {
          key: 'user-1',
          message: {
            role: 'user',
            content: 'original prompt',
            entryId: 'user-1-entry',
            timestamp: 1,
          },
        },
        {
          key: 'fork-origin:user-1-entry',
          type: 'notice',
          notice: { kind: 'fork_origin', text: '从对话中派生' },
        },
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'visible model reply' }],
            timestamp: 3,
          },
        },
      ],
    });

    expect(screen.getByText('从对话中派生')).toBeInTheDocument();
    expect(screen.getByText('visible model reply')).toBeInTheDocument();
  });

  it('uses a wrapping boundary for user messages across sidebar widths', () => {
    const { container } = renderConversation({
      items: [
        {
          key: 'user-1',
          message: {
            role: 'user',
            content:
              '一段很长的用户消息，用来确认气泡不会因为断点变化突然改变最大宽度 ' +
              'https://example.com/scout/very-long-path-without-natural-breaks/'.repeat(4),
            timestamp: 1,
          },
        },
      ],
    });

    const userBubble = container.querySelector('.scout-user-message');
    expect(userBubble).toHaveClass('scout-user-message');
    expect(userBubble).toHaveClass('min-w-0', 'max-w-[77%]');
    expect(userBubble).toHaveClass('whitespace-pre-wrap');
    expect(userBubble).toHaveClass('[overflow-wrap:anywhere]');
    expect(userBubble).not.toHaveClass('overflow-hidden');
    expect(userBubble?.className).not.toContain('sm:max-w');
    expect(userBubble?.className).not.toContain('lg:max-w');
  });

  it('shows user message actions on hover and copies user text through the extension protocol', () => {
    protocolClientMock.copyText.mockImplementation((_text, onResult) => {
      onResult?.({ type: 'copy_text_result', success: true });
    });
    const { container } = renderConversation({
      items: [
        {
          key: 'user-1',
          message: {
            role: 'user',
            content: '要复制的用户消息',
            timestamp: 1,
          },
        },
      ],
    });

    const actionBar = container.querySelector('[data-message-actions="user"]');
    expect(actionBar).toHaveClass('opacity-0');
    expect(actionBar).toHaveClass('group-hover/message:opacity-100');
    expect(actionBar?.textContent).toMatch(/\d{2}:\d{2}/);

    fireEvent.click(screen.getByRole('button', { name: '复制' }));

    expect(protocolClientMock.copyText).toHaveBeenCalledWith(
      '要复制的用户消息',
      expect.any(Function),
      expect.any(Function),
    );
    expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent('已复制');
  });

  it('keeps only the latest assistant message actions visible by default', () => {
    const { container } = renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: '上一条回复' }],
            timestamp: 1,
          },
        },
        {
          key: 'user-1',
          message: {
            role: 'user',
            content: '继续',
            timestamp: 2,
          },
        },
        {
          key: 'assistant-2',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: '最新回复' }],
            timestamp: 3,
          },
        },
      ],
    });

    const actionBars = Array.from(container.querySelectorAll('[data-message-actions="assistant"]'));

    expect(actionBars).toHaveLength(2);
    expect(actionBars[0]).toHaveClass('opacity-0');
    expect(actionBars[1]).toHaveClass('opacity-100');
    expect(actionBars[1]).toHaveAttribute('data-latest-assistant-actions', 'true');
  });

  it('shows latest assistant message actions only after streaming completes', () => {
    const items: ConversationItem[] = [
      {
        key: 'assistant-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '流式回复中' }],
          timestamp: 1,
        },
      },
    ];
    const { container, rerender } = renderConversation({ items, isStreaming: true });

    expect(container.querySelector('[data-message-actions="assistant"]')).toBeNull();

    rerender(
      <ConversationView
        busyState={IDLE_BUSY_STATE}
        isStreaming={false}
        items={items}
        toolExecutionsById={{}}
      />,
    );

    const actionBar = container.querySelector('[data-message-actions="assistant"]');
    expect(actionBar).toHaveClass('opacity-100');
    expect(actionBar).toHaveAttribute('data-latest-assistant-actions', 'true');
  });

  it('copies assistant message text through the extension protocol', () => {
    protocolClientMock.copyText.mockImplementation((_text, onResult) => {
      onResult?.({ type: 'copy_text_result', success: true });
    });
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: '要复制的回复' }],
            timestamp: 1,
          },
        },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: '复制' }));

    expect(protocolClientMock.copyText).toHaveBeenCalledWith(
      '要复制的回复',
      expect.any(Function),
      expect.any(Function),
    );
    expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent('已复制');
  });

  it('keeps assistant markdown in a wrapping boundary', () => {
    const longToken =
      'averylongunbrokenassistantreplythatmustwrapinsidethesidebarinstead-of-being-clipped';
    const longPath = `/Users/lianglonghui/Desktop/code/my-agent/scoutAgent/${longToken}`;
    const { container } = renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: `路径 \`${longPath}\` ${longToken}` }],
            timestamp: 1,
          },
        },
      ],
    });

    const viewport = container.querySelector('[data-slot="scroll-area-viewport"]');
    const content = container.querySelector('.scout-conversation-content');
    const markdownRoot = container.querySelector('[data-scout-markdown-content="true"]');
    const assistantTurn = markdownRoot?.closest('article');
    expect(viewport).toHaveClass('scout-conversation-viewport');
    expect(content).toHaveClass('scout-conversation-content', 'w-full', 'min-w-0', 'max-w-full');
    expect(markdownRoot).toHaveClass('scout-markdown-content');
    expect(markdownRoot).toHaveClass('w-full', 'min-w-0', 'max-w-full');
    expect(assistantTurn).toHaveClass('scout-assistant-turn', 'w-full', 'min-w-0', 'max-w-full');
    expect(assistantTurn).not.toHaveClass('overflow-hidden');

    const inlineCode = container.querySelector('code');
    expect(inlineCode).not.toHaveClass('whitespace-pre');
  });

  it('renders compaction as an outcome and retry status inline at the bottom', () => {
    const items: ConversationItem[] = [
      {
        key: 'user-1',
        message: {
          role: 'user',
          content: 'hello',
          timestamp: 1,
        },
      },
    ];
    const { container, rerender } = renderConversation({
      busyState: {
        kind: 'compaction',
        label: 'Compacting',
        cancellable: true,
        reason: 'overflow',
      },
      isStreaming: true,
      items,
    });

    expect(screen.getByText('正在压缩上下文')).toBeInTheDocument();
    expect(
      container.querySelector('[data-assistant-outcome-kind="compacting"] .animate-spin'),
    ).toBeTruthy();
    expect(screen.queryByText('上下文溢出恢复')).not.toBeInTheDocument();
    expect(screen.queryByText('正在思考')).not.toBeInTheDocument();
    expect(screen.queryByText('正在处理')).not.toBeInTheDocument();
    expect(container.querySelector('[data-assistant-outcome-kind="compacting"]')).toBeTruthy();
    expect(container.querySelector('[data-runtime-inline-status="compaction"]')).toBeNull();

    rerender(
      <ConversationView
        busyState={{
          kind: 'retry',
          label: 'Retrying',
          cancellable: true,
          attempt: 2,
          maxAttempts: 3,
          reason: 'rate limit',
        }}
        isStreaming={true}
        items={items}
        toolExecutionsById={{}}
      />,
    );

    expect(screen.getByText('正在重试 2/3')).toBeInTheDocument();
    expect(screen.queryByText('正在处理')).not.toBeInTheDocument();
    expect(screen.queryByText('正在思考')).not.toBeInTheDocument();
    expect(screen.getByText('rate limit')).toBeInTheDocument();
    expect(container.querySelector('[data-runtime-inline-status="retry"]')).toBeTruthy();
  });

  it('keeps a failed assistant turn settled while retry is waiting', () => {
    const { container } = renderConversation({
      busyState: {
        kind: 'retry',
        label: 'Retrying',
        cancellable: true,
        attempt: 1,
        maxAttempts: 3,
        reason: 'retryable provider error',
      },
      isStreaming: true,
      items: [
        {
          key: 'user-1',
          message: {
            role: 'user',
            content: '继续',
            timestamp: 1,
          },
        },
        {
          key: 'assistant-error-1',
          message: {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage: 'Provider temporarily unavailable',
            timestamp: 2,
          },
        },
      ],
    });

    expect(screen.getByText('正在重试 1/3')).toBeInTheDocument();
    expect(screen.getByText('retryable provider error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /收起回复 处理失败/ })).toBeInTheDocument();
    expect(screen.getByText('Provider temporarily unavailable')).toBeInTheDocument();
    expect(screen.queryByText('正在思考')).not.toBeInTheDocument();
    expect(screen.queryByText('正在处理')).not.toBeInTheDocument();
    expect(container.querySelector('[data-runtime-inline-status="retry"]')).toBeTruthy();
  });

  it('shows the scroll-to-bottom button only when enabled and away from the bottom', () => {
    const { container } = renderConversation({
      showScrollToBottomButton: true,
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: '很长的回复' }],
            timestamp: 1,
          },
        },
      ],
    });
    const viewport = container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    expect(viewport).not.toBeNull();
    const resolvedViewport = viewport!;
    const scrollTo = setViewportScrollMetrics(resolvedViewport, {
      clientHeight: 360,
      scrollHeight: 1200,
      scrollTop: 240,
    });

    fireEvent.scroll(resolvedViewport);

    const button = screen.getByRole('button', { name: '滚动到底部' });
    expect(button).toBeInTheDocument();

    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(1);
        return 1;
      });

    fireEvent.click(button);

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({ top: 840, behavior: 'auto' });
    expect(resolvedViewport.scrollTop).toBe(840);
    expect(screen.queryByRole('button', { name: '滚动到底部' })).not.toBeInTheDocument();
  });

  it('keeps short conversations on the normal render path', () => {
    const { container } = renderConversation({ items: makeUserConversationItems(159) });

    expect(container.querySelector('[data-scout-conversation-virtualized="false"]')).toBeTruthy();
    expect(container.querySelector('[data-scout-conversation-virtual-row]')).toBeNull();
  });

  it('virtualizes top-level rows once the conversation reaches the threshold', () => {
    const { container } = renderConversation({ items: makeUserConversationItems(160) });

    expect(container.querySelector('[data-scout-conversation-virtualized="true"]')).toBeTruthy();
  });

  it('scrolls virtualized conversations to the measured bottom from the scroll button', () => {
    const { container } = renderConversation({
      items: makeUserConversationItems(160),
      showScrollToBottomButton: true,
    });
    const viewport = container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    expect(viewport).not.toBeNull();
    const resolvedViewport = viewport!;
    const scrollTo = setViewportScrollMetrics(resolvedViewport, {
      clientHeight: 360,
      scrollHeight: 12_000,
      scrollTop: 1_000,
    });

    fireEvent.scroll(resolvedViewport);
    fireEvent.click(screen.getByRole('button', { name: '滚动到底部' }));

    expect(scrollTo).toHaveBeenLastCalledWith({ top: 11_640, behavior: 'auto' });
    expect(resolvedViewport.scrollTop).toBe(11_640);
    expect(screen.queryByRole('button', { name: '滚动到底部' })).not.toBeInTheDocument();
  });

  it('does not force virtualized conversations to the bottom after the user scrolls away', () => {
    const firstItems = makeUserConversationItems(160);
    const nextItems = makeUserConversationItems(160, { 159: 'updated tail message' });
    const { rerender } = renderConversation({ items: firstItems, isStreaming: true });
    const scrollContainer = screen.getByLabelText('会话滚动区域');
    const scrollTo = setViewportScrollMetrics(scrollContainer, {
      clientHeight: 400,
      scrollHeight: 12_000,
      scrollTop: 1_000,
    });

    fireEvent.scroll(scrollContainer);
    scrollTo.mockClear();
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(1);
        return 1;
      });

    rerender(
      <ConversationView
        busyState={AGENT_BUSY_STATE}
        isStreaming={true}
        items={nextItems}
        toolExecutionsById={{}}
      />,
    );

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('scrolls to the bottom when an explicit force scroll key changes', () => {
    const items = makeUserConversationItems(4);
    const { rerender } = renderConversation({
      forceScrollToBottomKey: 0,
      items,
      showScrollToBottomButton: true,
    });
    const scrollContainer = screen.getByLabelText('会话滚动区域');
    const scrollTo = setViewportScrollMetrics(scrollContainer, {
      clientHeight: 400,
      scrollHeight: 1000,
      scrollTop: 100,
    });

    fireEvent.scroll(scrollContainer);
    expect(screen.getByRole('button', { name: '滚动到底部' })).toBeInTheDocument();

    scrollTo.mockClear();
    rerender(
      <ConversationView
        busyState={IDLE_BUSY_STATE}
        forceScrollToBottomKey={1}
        isStreaming={false}
        items={items}
        showScrollToBottomButton
        toolExecutionsById={{}}
      />,
    );

    expect(scrollTo).toHaveBeenLastCalledWith({ top: 600, behavior: 'auto' });
    expect(scrollContainer.scrollTop).toBe(600);
    expect(screen.queryByRole('button', { name: '滚动到底部' })).not.toBeInTheDocument();
  });

  it('keeps virtualized conversations pinned while the user is near the bottom', () => {
    const firstItems = makeUserConversationItems(160);
    const nextItems = makeUserConversationItems(160, { 159: 'updated tail message' });
    const { rerender } = renderConversation({ items: firstItems, isStreaming: true });
    const scrollContainer = screen.getByLabelText('会话滚动区域');
    const scrollTo = setViewportScrollMetrics(scrollContainer, {
      clientHeight: 400,
      scrollHeight: 12_000,
      scrollTop: 11_580,
    });

    fireEvent.scroll(scrollContainer);
    scrollTo.mockClear();
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(1);
        return 1;
      });

    rerender(
      <ConversationView
        busyState={AGENT_BUSY_STATE}
        isStreaming={true}
        items={nextItems}
        toolExecutionsById={{}}
      />,
    );

    expect(requestAnimationFrame).toHaveBeenCalled();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 11_600, behavior: 'auto' });
  });

  it('shows the assistant thinking status without runtime inline status for normal agent streaming', () => {
    const { container } = renderConversation({
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
      isStreaming: true,
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: '正在生成' }],
            timestamp: 1,
          },
        },
      ],
    });

    expect(container.querySelector('[data-runtime-inline-status]')).toBeNull();
    expect(screen.queryByText('正在回复')).not.toBeInTheDocument();
    expect(screen.getByText('正在思考')).toBeInTheDocument();
    expect(screen.queryByText('正在处理')).not.toBeInTheDocument();
  });

  it('shows only the thinking summary when no assistant message has started yet', () => {
    const items: ConversationItem[] = [
      {
        key: 'user-1',
        message: {
          role: 'user',
          content: '开始',
          timestamp: 1,
        },
      },
    ];
    const { rerender } = renderConversation({
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
      isStreaming: true,
      items,
    });

    const thinkingStatus = screen.getByText('正在思考');
    expect(thinkingStatus).toBeInTheDocument();
    expect(thinkingStatus.parentElement).not.toHaveClass('scout-running-text-shimmer');
    expect(screen.queryByRole('button', { name: /展开过程 正在思考/ })).not.toBeInTheDocument();
    expect(screen.queryByText('正在处理')).not.toBeInTheDocument();

    rerender(
      <ConversationView
        busyState={{ kind: 'agent', label: 'Working', cancellable: true }}
        isStreaming={true}
        items={[
          ...items,
          {
            key: 'assistant-1',
            message: {
              role: 'assistant',
              content: [],
              timestamp: 2,
            },
          },
        ]}
        toolExecutionsById={{}}
      />,
    );

    expect(screen.getByText('正在思考')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /展开过程 正在思考/ })).not.toBeInTheDocument();
  });

  it('renders thinking summary before a message starts', () => {
    renderConversation({
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
      isStreaming: true,
      items: [
        {
          key: 'user-1',
          message: {
            role: 'user',
            content: '开始',
            timestamp: 1,
          },
        },
      ],
    });

    expect(screen.getByText('正在思考')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /展开过程 正在思考/ })).not.toBeInTheDocument();
  });

  it('shows stopped turns as expanded process history', () => {
    const { container } = renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: '已经检查到这里' }],
            stopReason: 'aborted',
            errorMessage: 'Request was aborted',
            timestamp: 1,
          },
        },
      ],
    });

    const notice = container.querySelector('[data-manual-abort-notice="true"]');
    const thinking = screen.getByText('已经检查到这里');
    expect(screen.getByRole('button', { name: /收起回复 已停止/ })).toBeInTheDocument();
    expect(thinking).toBeInTheDocument();
    expect(screen.getByText('你停止了会话')).toBeInTheDocument();
    expect(screen.queryByText('Request was aborted')).not.toBeInTheDocument();
    expect(notice).toHaveClass('justify-end', 'border-b');
    expect(
      thinking.compareDocumentPosition(notice as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('renders compacted summary markdown under the outcome divider', () => {
    const { container } = renderConversation({
      items: [
        {
          key: 'compaction-1',
          message: {
            role: 'compactionSummary',
            summary: '## Summary\n\n- **Kept** important context',
            tokensBefore: 1234,
            timestamp: 1,
          },
        },
      ],
    });

    const outcome = container.querySelector('[data-assistant-outcome-kind="compacted"]');
    expect(screen.getByText('上下文已压缩')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByText('Kept')).toBeInTheDocument();
    expect(outcome?.querySelector('[data-scout-markdown-content="true"]')).toBeTruthy();
  });

  it('renders compacted markdown after the retained final message', () => {
    const { container } = renderConversation({
      items: [
        {
          key: 'user-kept',
          message: {
            role: 'user',
            content: 'kept prompt',
            timestamp: 1,
          },
        },
        {
          key: 'assistant-kept',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'kept reply' }],
            timestamp: 2,
          },
        },
        {
          key: 'compaction-1',
          message: {
            role: 'compactionSummary',
            summary: '## Generated document\n\n- retained context',
            tokensBefore: 1234,
            timestamp: 3,
          },
        },
      ],
    });

    const assistantText = screen.getByText('kept reply');
    const outcome = container.querySelector('[data-assistant-outcome-kind="compacted"]');
    const heading = screen.getByRole('heading', { name: 'Generated document' });

    expect(outcome).toBeTruthy();
    expect(
      assistantText.compareDocumentPosition(outcome as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      (outcome as Node).compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('shows failed turns only for assistant error stop reasons', () => {
    const { container } = renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage: 'Provider request failed',
            timestamp: 1,
          },
        },
      ],
    });

    expect(screen.getByRole('button', { name: /收起回复 处理失败/ })).toBeInTheDocument();
    expect(container.querySelector('[data-assistant-error-notice="true"]')).toHaveTextContent(
      'Provider request failed',
    );
  });

  it('keeps status errors inside a completed turn when the assistant did not fail', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: '已经给出可用结果' }],
            errorMessage: '某个内部状态需要注意',
            timestamp: 1,
          },
        },
      ],
    });

    expect(screen.getByRole('button', { name: /展开回复 已处理/ })).toBeInTheDocument();
    expect(screen.getByText('已经给出可用结果')).toBeInTheDocument();
    expect(screen.queryByText('某个内部状态需要注意')).not.toBeInTheDocument();
    expandCompletedTurn();
    expect(screen.getByText('某个内部状态需要注意')).toBeInTheDocument();
  });

  it('does not tint successful process history red when the assistant fails later', () => {
    const errorMessage =
      '403 The free tier of the model has been exhausted. Please disable free tier only mode.';

    const { container } = renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: '先检查最后一章。' },
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'read',
                arguments: { path: 'chapter.md' },
              },
              { type: 'text', text: '我会继续润色结尾。' },
              {
                type: 'toolCall',
                id: 'tool-2',
                name: 'edit',
                arguments: { path: 'chapter.md' },
              },
            ],
            stopReason: 'error',
            errorMessage,
            timestamp: 1,
          },
        },
      ],
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'read',
          args: { path: 'chapter.md' },
          status: 'done',
          result: {
            content: [{ type: 'text', text: 'chapter content' }],
          },
          isError: false,
        },
        'tool-2': {
          toolCallId: 'tool-2',
          toolName: 'edit',
          args: { path: 'chapter.md' },
          status: 'done',
          result: {
            content: [{ type: 'text', text: 'edit complete' }],
          },
          isError: false,
        },
      },
    });

    expect(screen.getByRole('button', { name: /收起回复 处理失败/ })).toHaveClass(
      'text-destructive',
    );
    const errorNotice = container.querySelector('[data-assistant-error-notice="true"]');
    const assistantTurn = container.querySelector('.scout-assistant-turn');
    expect(errorNotice).toHaveTextContent(errorMessage);
    expect(errorNotice).not.toHaveClass('text-destructive');
    expect(screen.getByText(errorMessage).closest('[data-assistant-process-phase]')).toBeNull();
    expect(screen.getByText(errorMessage).closest('.text-destructive')).toBeNull();
    expect(
      assistantTurn &&
        errorNotice &&
        assistantTurn.compareDocumentPosition(errorNotice) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText('已阅读 chapter.md').closest('.text-destructive')).toBeNull();
    expect(screen.getByText('已编辑 chapter.md').closest('.text-destructive')).toBeNull();
  });

  it('respects manual process expansion across streaming updates', () => {
    const firstItems: ConversationItem[] = [
      {
        key: 'message-1',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '第一段思考' },
            { type: 'text', text: '开始回答' },
          ],
          timestamp: 1,
        },
      },
    ];
    const nextItems: ConversationItem[] = [
      {
        key: 'message-1',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '第二段思考' },
            { type: 'text', text: '继续回答' },
          ],
          timestamp: 1,
        },
      },
    ];
    const { rerender } = renderConversation({
      items: firstItems,
      isStreaming: true,
    });

    expect(screen.queryByText('第一段思考')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /展开过程 已处理/ })).not.toBeInTheDocument();

    rerender(
      <ConversationView
        busyState={AGENT_BUSY_STATE}
        isStreaming={true}
        items={nextItems}
        toolExecutionsById={{}}
      />,
    );

    expect(screen.queryByText('第二段思考')).not.toBeInTheDocument();
  });

  it('merges tool results into matching assistant tool calls', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: '准备读取文件' },
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'read',
                arguments: { path: 'README.md' },
              },
            ],
            timestamp: 1,
          },
        },
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'read',
            content: [{ type: 'text', text: '文件内容' }],
            isError: false,
            timestamp: 2,
          },
        },
      ],
    });

    expect(screen.getByText('准备读取文件')).toBeInTheDocument();
    expect(screen.queryByText('已阅读 README.md')).not.toBeInTheDocument();
    expandCompletedTurn();
    expect(screen.getByText('已阅读 README.md')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /展开过程 已阅读 README\.md/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('文件内容')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /展开工具输出 read/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/"path": "README.md"/)).not.toBeInTheDocument();
  });

  it('aligns the direct single-tool process row with the outer process block', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'read',
                arguments: { path: 'README.md' },
              },
            ],
            timestamp: 1,
          },
        },
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'read',
            content: [{ type: 'text', text: '文件内容' }],
            isError: false,
            timestamp: 2,
          },
        },
      ],
    });

    expandCompletedTurn();
    const readActivity = screen.getByText('已阅读 README.md');
    const activityRow = readActivity.closest('div');
    const processList = readActivity.closest('[data-assistant-process-phase]')?.parentElement;

    expect(activityRow?.className).not.toContain('px-0');
    expect(activityRow?.className).not.toContain('px-1');
    expect(activityRow?.className).not.toContain('py-0.5');
    expect(processList?.className).not.toContain('-ml-1');
  });

  it('keeps read failures expandable without showing arguments', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'read',
                arguments: { path: 'missing.md' },
              },
            ],
            timestamp: 1,
          },
        },
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'read',
            content: [{ type: 'text', text: 'ENOENT: no such file or directory' }],
            isError: true,
            timestamp: 2,
          },
        },
      ],
    });

    expandCompletedTurn();
    expectToolErrorSummary('阅读失败', 'missing.md');
    expect(
      screen.queryByRole('button', { name: /展开过程 阅读失败 missing\.md/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/ENOENT/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开工具输出 read/ }));
    expect(screen.getByText(/ENOENT: no such file or directory/)).toBeInTheDocument();
    expect(screen.getByText('× 失败')).toBeInTheDocument();
    expect(screen.queryByText(/"path": "missing.md"/)).not.toBeInTheDocument();
  });

  it('shows write progress without exposing generated content', () => {
    renderConversation({
      isStreaming: true,
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'write',
                arguments: { path: 'src/generated.ts', content: 'secret\nline 2\nline 3\n' },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'write',
          args: { path: 'src/generated.ts', content: 'secret\nline 2\nline 3\n' },
          status: 'running',
          isError: false,
        },
      },
    });

    expect(screen.getByText('正在写入 src/generated.ts')).toBeInTheDocument();
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /展开写入内容 src\/generated\.ts/ }),
    ).not.toBeInTheDocument();
  });

  it('renders streaming write progress counts without an expandable diff', () => {
    renderConversation({
      isStreaming: true,
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'write',
                arguments: { path: 'src/generated.ts', content: 'secret\nline 2\nline 3\n' },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      toolPreviewsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'write',
          preview: {
            kind: 'file_edit',
            path: 'src/generated.ts',
            additions: 3,
            deletions: 0,
          },
        },
      },
    });

    expect(screen.getByText('正在写入 src/generated.ts')).toBeInTheDocument();
    expect(screen.getByText('+3')).toBeInTheDocument();
    expect(screen.queryByText('-0')).not.toBeInTheDocument();
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /展开写入差异 src\/generated\.ts/ }),
    ).not.toBeInTheDocument();
  });

  it('shows running edit as a non-expandable relative path when no preview is available', () => {
    renderConversation({
      isStreaming: true,
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'edit',
                arguments: {
                  path: '/Users/lianglonghui/Desktop/pi-learning/CalculatorTest.java',
                },
                displayArguments: {
                  path: 'CalculatorTest.java',
                },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'edit',
          args: {
            path: '/Users/lianglonghui/Desktop/pi-learning/CalculatorTest.java',
          },
          displayArgs: {
            path: 'CalculatorTest.java',
          },
          status: 'running',
          isError: false,
        },
      },
    });

    expect(screen.getByText('正在编辑 CalculatorTest.java')).toBeInTheDocument();
    expect(
      screen.queryByText('正在编辑 /Users/lianglonghui/Desktop/pi-learning/CalculatorTest.java'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('参数')).not.toBeInTheDocument();
    expect(screen.queryByText(/"path"/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /展开(详情|工具输出|编辑差异)/ }),
    ).not.toBeInTheDocument();
  });

  it('renders write previews with change counts without an expandable diff', () => {
    renderConversation({
      isStreaming: true,
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'write',
                arguments: { path: 'src/generated.ts', content: 'export const value = 1;\n' },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      toolPreviewsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'write',
          preview: {
            kind: 'file_edit',
            path: 'src/generated.ts',
            diff: '+1 export const value = 1;',
            additions: 1,
            deletions: 0,
            firstChangedLine: 1,
          },
        },
      },
    });

    expect(screen.getByText('正在写入 src/generated.ts')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.queryByText('-0')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /展开写入差异 src\/generated\.ts/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('+1 export const value = 1;')).not.toBeInTheDocument();
  });

  it('renders completed write final diff previews from details', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'write',
                arguments: { path: 'src/generated.ts', content: 'export const value = 1;\n' },
              },
            ],
            timestamp: 1,
          },
        },
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'write',
            content: [{ type: 'text', text: 'done' }],
            details: {
              kind: 'file_change',
              path: 'src/generated.ts',
              additions: 1,
              deletions: 0,
              review: {
                turnId: 'turn-1',
                recordId: 'review-1',
              },
              diffPreview: {
                rows: [{ type: 'added', newLineNumber: 1, text: 'export const value = 1;' }],
              },
            },
            isError: false,
            timestamp: 2,
          },
        },
      ],
    });

    expect(screen.getByText('已写入 src/generated.ts')).toBeInTheDocument();
    expect(screen.getAllByText('+1').length).toBeGreaterThan(0);
    expect(screen.queryByText('-0')).not.toBeInTheDocument();

    ensureFileChangeDiffExpanded(/src\/generated\.ts/);

    expect(screen.getByText('+1 export const value = 1;')).toBeInTheDocument();
  });

  it('does not render raw write content from arguments', () => {
    renderConversation({
      isStreaming: true,
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'write',
                arguments: { path: 'src/spaced.ts', content: '  indented\n   \nlast\n' },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'write',
          args: { path: 'src/spaced.ts', content: '  indented\n   \nlast\n' },
          status: 'running',
          isError: false,
        },
      },
    });

    expect(screen.getByText('正在写入 src/spaced.ts')).toBeInTheDocument();
    expect(screen.queryByText(/indented/)).not.toBeInTheDocument();
    expect(screen.queryByText(/last/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /展开写入内容 src\/spaced\.ts/ }),
    ).not.toBeInTheDocument();
  });

  it('does not expose blank write content as an expandable block', () => {
    renderConversation({
      isStreaming: true,
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'write',
                arguments: { path: 'src/blank.txt', content: '   \n' },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'write',
          args: { path: 'src/blank.txt', content: '   \n' },
          status: 'running',
          isError: false,
        },
      },
    });

    expect(screen.getByText('正在写入 src/blank.txt')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /展开写入内容 src\/blank\.txt/ }),
    ).not.toBeInTheDocument();
  });

  it('keeps write failures expandable without exposing content', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'write',
                arguments: { path: 'src/generated.ts', content: 'secret\nline 2\n' },
              },
            ],
            timestamp: 1,
          },
        },
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'write',
            content: [{ type: 'text', text: 'EACCES: permission denied' }],
            isError: true,
            timestamp: 2,
          },
        },
      ],
    });

    expandCompletedTurn();
    expectToolErrorSummary('写入失败', 'src/generated.ts');
    expect(
      screen.queryByRole('button', { name: /展开过程 写入失败 src\/generated\.ts/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/EACCES/)).not.toBeInTheDocument();
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开工具输出 src\/generated\.ts/ }));
    expect(screen.getByText(/EACCES: permission denied/)).toBeInTheDocument();
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
  });

  it('renders assistant turn review entry and opens the changes review panel', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'edit',
                arguments: { path: 'src/app.ts' },
              },
            ],
            changesReviews: [makeChangesReviewSummary()],
            timestamp: 1,
          },
        },
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'edit',
            content: [{ type: 'text', text: 'done' }],
            details: {
              kind: 'file_change',
              path: '/workspace/src/app.ts',
              displayPath: 'src/app.ts',
              additions: 2,
              deletions: 1,
              review: {
                turnId: 'turn-1',
                recordId: 'review-1',
              },
            },
            isError: false,
            timestamp: 2,
          },
        },
      ],
    });

    const reviewButton = screen.getByRole('button', { name: 'Review Changes' });
    expect(reviewButton).toBeInTheDocument();
    expect(screen.getByText('已编辑 1 个文件')).toBeInTheDocument();
    expect(screen.getAllByText('+2')).toHaveLength(2);
    expect(screen.getAllByText('-1')).toHaveLength(2);
    expect(screen.getByText('src/')).toBeInTheDocument();
    expect(screen.getByText('app.ts')).toBeInTheDocument();
    expect(screen.queryByText('src/app.ts')).toBeNull();

    fireEvent.click(reviewButton);

    expect(protocolClientMock.openChangesReview).toHaveBeenCalledWith('turn-1');
  });

  it('expands completed file change tool rows with final diff preview rows', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'edit',
                arguments: { path: 'src/app.ts' },
              },
            ],
            timestamp: 1,
          },
        },
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'edit',
            content: [{ type: 'text', text: 'done' }],
            details: {
              kind: 'file_change',
              path: '/workspace/src/app.ts',
              displayPath: 'src/app.ts',
              additions: 1,
              deletions: 1,
              review: {
                turnId: 'turn-1',
                recordId: 'review-1',
              },
              diffPreview: {
                rows: [
                  { type: 'removed', oldLineNumber: 2, text: 'const value = "old";' },
                  { type: 'added', newLineNumber: 2, text: 'const value = "new";' },
                ],
              },
            },
            isError: false,
            timestamp: 2,
          },
        },
      ],
    });

    const completedTool = screen.getByText('已编辑 src/app.ts');
    const completedToolButton = completedTool.closest('button');
    expect(completedToolButton).toHaveAccessibleName('展开文件变更 src/app.ts');

    fireEvent.click(completedToolButton!);

    expect(screen.getByText('-2 const value = "old";')).toBeInTheDocument();
    expect(screen.getByText('+2 const value = "new";')).toBeInTheDocument();
  });

  it('marks completed final diff previews when the host truncated the rows', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'edit',
                arguments: { path: 'src/app.ts' },
              },
            ],
            timestamp: 1,
          },
        },
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'edit',
            content: [{ type: 'text', text: 'done' }],
            details: {
              kind: 'file_change',
              path: '/workspace/src/app.ts',
              displayPath: 'src/app.ts',
              additions: 10,
              deletions: 1,
              review: {
                turnId: 'turn-1',
                recordId: 'review-1',
              },
              diffPreview: {
                rows: [{ type: 'added', newLineNumber: 2, text: 'const value = "new";' }],
                truncated: true,
              },
            },
            isError: false,
            timestamp: 2,
          },
        },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: /展开文件变更 src\/app\.ts/ }));

    expect(screen.getByText('+2 const value = "new";')).toBeInTheDocument();
    expect(screen.getByText('… 预览已截断，请打开审查查看完整变更')).toBeInTheDocument();
  });

  it('keeps completed final diff previews expandable when rows are unavailable', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'edit',
                arguments: { path: 'src/app.ts' },
              },
            ],
            timestamp: 1,
          },
        },
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'edit',
            content: [{ type: 'text', text: 'done' }],
            details: {
              kind: 'file_change',
              path: '/workspace/src/app.ts',
              displayPath: 'src/app.ts',
              additions: 1000,
              deletions: 1000,
              review: {
                turnId: 'turn-1',
                recordId: 'review-1',
              },
              diffPreview: {
                rows: [],
                unavailableReason: 'Diff too large to review',
              },
            },
            isError: false,
            timestamp: 2,
          },
        },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: /展开文件变更 src\/app\.ts/ }));

    expect(screen.getByText('预览错误')).toBeInTheDocument();
    expect(screen.getByText('Diff too large to review')).toBeInTheDocument();
  });

  it('keeps the first completed file change row expandable when several files changed', () => {
    const files = ['test.c', 'test.py', 'Test.java', 'test.js'];

    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: files.map((path, index) => ({
              type: 'toolCall' as const,
              id: `tool-${index + 1}`,
              name: 'edit',
              arguments: { path },
            })),
            changesReviews: [
              makeChangesReviewSummary({
                files: files.map((path, index) => ({
                  path,
                  displayPath: path,
                  additions: index + 1,
                  deletions: 1,
                })),
              }),
            ],
            timestamp: 1,
          },
        },
        ...files.map(
          (path, index): ConversationItem => ({
            key: `tool-result-${index + 1}`,
            message: {
              role: 'toolResult',
              toolCallId: `tool-${index + 1}`,
              toolName: 'edit',
              content: [{ type: 'text', text: 'done' }],
              details: {
                kind: 'file_change',
                path,
                displayPath: path,
                additions: index + 1,
                deletions: 1,
                review: {
                  turnId: 'turn-1',
                  recordId: `review-${index + 1}`,
                },
                diffPreview: {
                  rows: [
                    { type: 'removed', oldLineNumber: 1, text: `old ${path}` },
                    { type: 'added', newLineNumber: 1, text: `new ${path}` },
                  ],
                },
              },
              isError: false,
              timestamp: index + 2,
            },
          }),
        ),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: /展开文件变更 test\.c/ }));

    expect(screen.getByText('-1 old test.c')).toBeInTheDocument();
    expect(screen.getByText('+1 new test.c')).toBeInTheDocument();
    for (const path of files.slice(1)) {
      expect(screen.getByRole('button', { name: new RegExp(`展开文件变更 ${path}`) }));
    }
  });

  it('defers the latest streaming assistant review entry until the turn settles', () => {
    const items: ConversationViewItem[] = [
      {
        key: 'assistant-1',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'tool-1',
              name: 'edit',
              arguments: { path: 'src/app.ts' },
            },
          ],
          changesReviews: [makeChangesReviewSummary()],
          timestamp: 1,
        },
      },
      {
        key: 'tool-result-1',
        message: {
          role: 'toolResult',
          toolCallId: 'tool-1',
          toolName: 'edit',
          content: [{ type: 'text', text: 'done' }],
          details: {
            kind: 'file_change',
            path: '/workspace/src/app.ts',
            displayPath: 'src/app.ts',
            additions: 2,
            deletions: 1,
            review: {
              turnId: 'turn-1',
              recordId: 'review-1',
            },
          },
          isError: false,
          timestamp: 2,
        },
      },
    ];

    const streamingRows = buildConversationRows({
      busyState: AGENT_BUSY_STATE,
      isStreaming: true,
      items,
      toolExecutionsById: {},
    });
    const streamingAssistantRow = streamingRows.find((row) => row.type === 'assistant');
    expect(streamingAssistantRow?.changesReviews).toEqual([]);

    const settledRows = buildConversationRows({
      busyState: IDLE_BUSY_STATE,
      isStreaming: false,
      items,
      toolExecutionsById: {},
    });
    const settledAssistantRow = settledRows.find((row) => row.type === 'assistant');
    expect(settledAssistantRow?.changesReviews).toMatchObject([
      {
        turnId: 'turn-1',
        fileCount: 1,
        additions: 2,
        deletions: 1,
        files: [
          {
            path: '/workspace/src/app.ts',
            displayPath: 'src/app.ts',
            additions: 2,
            deletions: 1,
          },
        ],
      },
    ]);
  });

  it('collapses assistant review files after the first three and expands the rest on click', () => {
    const paths = ['src/one.ts', 'src/two.ts', 'src/three.ts', 'src/four.ts'];

    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: paths.map((path, index) => ({
              type: 'toolCall',
              id: `tool-${index + 1}`,
              name: 'edit',
              arguments: { path },
            })),
            changesReviews: [
              makeChangesReviewSummary({
                fileCount: paths.length,
                files: [...paths].reverse().map((path, index) => ({
                  path,
                  displayPath: path,
                  additions: paths.length - index,
                  deletions: 0,
                })),
              }),
            ],
            timestamp: 1,
          },
        },
        ...paths.map((path, index) => ({
          key: `tool-result-${index + 1}`,
          message: {
            role: 'toolResult' as const,
            toolCallId: `tool-${index + 1}`,
            toolName: 'edit',
            content: [{ type: 'text' as const, text: 'done' }],
            details: {
              kind: 'file_change' as const,
              path,
              additions: index + 1,
              deletions: 0,
              review: {
                turnId: 'turn-1',
                recordId: `review-${index + 1}`,
              },
            },
            isError: false,
            timestamp: index + 2,
          },
        })),
      ],
    });

    expect(screen.getByText('已编辑 4 个文件')).toBeInTheDocument();
    expect(screen.getByText('four.ts')).toBeInTheDocument();
    expect(screen.getByText('three.ts')).toBeInTheDocument();
    expect(screen.getByText('two.ts')).toBeInTheDocument();
    expect(screen.queryByText('one.ts')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /再显示 1 个文件/ }));

    expect(screen.getByText('one.ts')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /再显示 1 个文件/ })).not.toBeInTheDocument();
  });

  it('opens each assistant review entry by its own turn', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'edit',
                arguments: { path: 'src/old.ts' },
              },
            ],
            changesReviews: [
              makeChangesReviewSummary({
                turnId: 'turn-1',
                files: [
                  { path: 'src/old.ts', displayPath: 'src/old.ts', additions: 1, deletions: 0 },
                ],
              }),
            ],
            timestamp: 1,
          },
        },
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'edit',
            content: [{ type: 'text', text: 'done' }],
            details: {
              kind: 'file_change',
              path: 'src/old.ts',
              additions: 1,
              deletions: 0,
              review: {
                turnId: 'turn-1',
                recordId: 'review-1',
              },
            },
            isError: false,
            timestamp: 2,
          },
        },
        {
          key: 'assistant-2',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-2',
                name: 'edit',
                arguments: { path: 'src/latest.ts' },
              },
            ],
            changesReviews: [
              makeChangesReviewSummary({
                turnId: 'turn-2',
                files: [
                  {
                    path: 'src/latest.ts',
                    displayPath: 'src/latest.ts',
                    additions: 2,
                    deletions: 1,
                  },
                ],
              }),
            ],
            timestamp: 3,
          },
        },
        {
          key: 'tool-result-2',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-2',
            toolName: 'edit',
            content: [{ type: 'text', text: 'done' }],
            details: {
              kind: 'file_change',
              path: 'src/latest.ts',
              additions: 2,
              deletions: 1,
              review: {
                turnId: 'turn-2',
                recordId: 'review-2',
              },
            },
            isError: false,
            timestamp: 4,
          },
        },
      ],
    });

    const reviewButtons = screen.getAllByRole('button', { name: 'Review Changes' });
    expect(reviewButtons).toHaveLength(2);

    fireEvent.click(reviewButtons[0]);
    fireEvent.click(reviewButtons[1]);

    expect(protocolClientMock.openChangesReview).toHaveBeenCalledTimes(2);
    expect(protocolClientMock.openChangesReview.mock.calls.map(([turnId]) => turnId)).toEqual(
      expect.arrayContaining(['turn-1', 'turn-2']),
    );
  });

  it('keeps assistant turn review entry clickable for the host error path', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'edit',
                arguments: { path: 'src/app.ts' },
              },
            ],
            changesReviews: [makeChangesReviewSummary()],
            timestamp: 1,
          },
        },
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'edit',
            content: [{ type: 'text', text: 'done' }],
            details: {
              kind: 'file_change',
              path: 'src/app.ts',
              additions: 1,
              deletions: 0,
              review: {
                turnId: 'turn-1',
                recordId: 'review-1',
              },
            },
            isError: false,
            timestamp: 2,
          },
        },
      ],
    });

    const reviewButton = screen.getByRole('button', {
      name: 'Review Changes',
    });
    expect(reviewButton).not.toBeDisabled();

    fireEvent.click(reviewButton);

    expect(protocolClientMock.openChangesReview).toHaveBeenCalledWith('turn-1');
  });

  it('renders assistant text as safe GitHub flavored markdown', () => {
    const { container } = renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: [
                  '# 变更总结',
                  '',
                  '- 支持列表',
                  '- 支持表格',
                  '',
                  '[OpenAI](https://openai.com)',
                  '',
                  '| 文件 | 状态 |',
                  '| --- | --- |',
                  '| README.md | updated |',
                  '',
                  '`inline`',
                  '',
                  '<strong>隐藏文本</strong>',
                ].join('\n'),
              },
            ],
            timestamp: 1,
          },
        },
      ],
    });

    expect(screen.getByRole('heading', { name: '变更总结' })).toBeInTheDocument();
    expect(screen.getByText('支持列表')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'OpenAI' })).toHaveAttribute(
      'href',
      'https://openai.com',
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(screen.getByText('inline')).toBeInTheDocument();
    expect(screen.getByText('隐藏文本')).toBeInTheDocument();
    expect(container.querySelector('strong')).toBeNull();
  });

  it('uses sidebar-safe wrapping for long markdown content', () => {
    const longToken = 'https://example.com/scout/very-long-path-without-natural-breaks/'.repeat(4);
    const { container } = renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: [
                  `# ${longToken}`,
                  '',
                  `- /workspace/${longToken}`,
                  '',
                  `[${longToken}](${longToken})`,
                  '',
                  '| 路径 | 状态 |',
                  '| --- | --- |',
                  `| ${longToken} | updated |`,
                  '',
                  '```ts',
                  `const path = "${longToken}";`,
                  '```',
                ].join('\n'),
              },
            ],
            timestamp: 1,
          },
        },
      ],
    });

    const heading = container.querySelector('h1');
    const listItem = container.querySelector('li');
    const link = container.querySelector('a');
    const table = container.querySelector('table');
    const tableCell = container.querySelector('td');
    const pre = container.querySelector('pre');
    const markdownRoot = container.querySelector('[data-scout-markdown-content="true"]');
    const tableWrapper = container.querySelector('[data-scout-markdown-table-wrapper="true"]');
    const codeScroll = container.querySelector('[data-scout-markdown-code-scroll="true"]');

    expect(markdownRoot).toHaveClass('scout-markdown-content');
    expect(markdownRoot?.closest('article')).toHaveClass('scout-assistant-turn');
    expect(heading).toHaveClass('min-w-0', 'max-w-full');
    expect(listItem).toHaveClass('min-w-0', 'max-w-full');
    expect(link).toHaveClass('min-w-0', 'max-w-full');
    expect(tableWrapper).toHaveClass(
      'scout-markdown-table-wrapper',
      'w-full',
      'min-w-0',
      'max-w-full',
    );
    expect(tableWrapper).not.toHaveClass('overflow-x-auto');
    expect(table).toHaveClass('scout-markdown-table', 'w-full', 'table-fixed');
    expect(table).not.toHaveClass('min-w-max');
    expect(tableCell).toHaveClass('scout-markdown-table-cell', 'min-w-0', 'max-w-full');
    expect(codeScroll).toHaveClass('scout-markdown-code-scroll', 'w-full', 'min-w-0', 'max-w-full');
    expect(codeScroll?.querySelector('[data-orientation="horizontal"]')).toBeTruthy();
    expect(codeScroll?.querySelector('[data-orientation="vertical"]')).toBeNull();
    expect(pre).toHaveClass('w-max', 'min-w-full', 'max-w-none');
    expect(pre).not.toHaveClass('overflow-x-auto');
    expect(pre?.className).toContain('[&_code]:break-normal');
    expect(pre?.className).toContain('[&_code]:whitespace-pre');
    expect(pre?.className).toContain('[&_code]:[overflow-wrap:normal]');
  });

  it('keeps tool output as plain text instead of markdown', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'bash',
                arguments: { command: 'printf markdown' },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'bash',
          args: { command: 'printf markdown' },
          status: 'done',
          result: {
            content: [{ type: 'text', text: '# 不是标题\n\n- 不是列表' }],
          },
          isError: false,
        },
      },
    });

    expandCompletedTurn();
    expect(screen.getByText('已运行 printf markdown')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /展开工具输出 bash/ }));

    expect(screen.getByText(/# 不是标题/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '不是标题' })).not.toBeInTheDocument();
  });

  it('falls back to tool call arguments when runtime args are missing', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'bash',
                arguments: { command: 'pnpm test' },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'bash',
          status: 'done',
          result: {
            content: [{ type: 'text', text: '测试通过' }],
          },
          isError: false,
        },
      },
    });

    expandCompletedTurn();
    expect(screen.getByText('已运行 pnpm test')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /展开过程 已运行 pnpm test/ }),
    ).not.toBeInTheDocument();
  });

  it('keeps unknown tool summaries on the generic running wording', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'todo_write',
                arguments: { items: ['review'] },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'todo_write',
          status: 'done',
          result: {
            content: [{ type: 'text', text: 'updated todos' }],
          },
          isError: false,
        },
      },
    });

    expandCompletedTurn();
    expect(screen.getByText('已运行 todo_write')).toBeInTheDocument();
    expect(screen.queryByText('已todo_write')).not.toBeInTheDocument();
  });

  it('does not force scroll to bottom after the user scrolls away from the tail', () => {
    const firstItems: ConversationItem[] = [
      {
        key: 'assistant-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '第一段' }],
          timestamp: 1,
        },
      },
    ];
    const nextItems: ConversationItem[] = [
      {
        key: 'assistant-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '第一段\n\n第二段' }],
          timestamp: 1,
        },
      },
    ];
    const { rerender } = renderConversation({ items: firstItems });
    const scrollContainer = screen.getByLabelText('会话滚动区域');
    const scrollTo = vi.fn();

    Object.defineProperty(scrollContainer, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      value: 100,
      writable: true,
    });

    fireEvent.scroll(scrollContainer);
    scrollTo.mockClear();

    rerender(
      <ConversationView
        busyState={AGENT_BUSY_STATE}
        isStreaming={true}
        items={nextItems}
        toolExecutionsById={{}}
      />,
    );

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('stops following streaming updates immediately after user scroll intent', () => {
    const firstItems: ConversationItem[] = [
      {
        key: 'assistant-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '第一段' }],
          timestamp: 1,
        },
      },
    ];
    const nextItems: ConversationItem[] = [
      {
        key: 'assistant-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '第一段\n\n第二段' }],
          timestamp: 1,
        },
      },
    ];
    const { rerender } = renderConversation({ items: firstItems });
    const scrollContainer = screen.getByLabelText('会话滚动区域');
    const scrollTo = vi.fn();

    Object.defineProperty(scrollContainer, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      value: 560,
      writable: true,
    });
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(1);
        return 1;
      });

    fireEvent.wheel(scrollContainer, { deltaY: -120 });
    scrollTo.mockClear();

    rerender(
      <ConversationView
        busyState={AGENT_BUSY_STATE}
        isStreaming={true}
        items={nextItems}
        toolExecutionsById={{}}
      />,
    );

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('keeps following when the user wheels downward at the bottom', () => {
    const firstItems: ConversationItem[] = [
      {
        key: 'assistant-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '第一段' }],
          timestamp: 1,
        },
      },
    ];
    const nextItems: ConversationItem[] = [
      {
        key: 'assistant-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '第一段\n\n第二段' }],
          timestamp: 1,
        },
      },
    ];
    const { rerender } = renderConversation({ items: firstItems });
    const scrollContainer = screen.getByLabelText('会话滚动区域');
    const scrollTo = vi.fn();

    Object.defineProperty(scrollContainer, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      value: 600,
      writable: true,
    });

    fireEvent.wheel(scrollContainer, { deltaY: 120 });
    scrollTo.mockClear();
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(1);
        return 1;
      });

    rerender(
      <ConversationView
        busyState={AGENT_BUSY_STATE}
        isStreaming={true}
        items={nextItems}
        toolExecutionsById={{}}
      />,
    );

    expect(requestAnimationFrame).toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({ top: 600, behavior: 'auto' });
  });

  it('keeps following when a nested scroll area consumes the wheel gesture', () => {
    const firstItems: ConversationItem[] = [
      {
        key: 'assistant-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '第一段' }],
          timestamp: 1,
        },
      },
    ];
    const nextItems: ConversationItem[] = [
      {
        key: 'assistant-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '第一段\n\n第二段' }],
          timestamp: 1,
        },
      },
    ];
    const { rerender } = renderConversation({ items: firstItems });
    const scrollContainer = screen.getByLabelText('会话滚动区域');
    const scrollTo = vi.fn();

    Object.defineProperty(scrollContainer, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      value: 600,
      writable: true,
    });

    const nestedScrollArea = document.createElement('div');
    nestedScrollArea.dataset.slot = 'scroll-area-viewport';
    scrollContainer.appendChild(nestedScrollArea);
    Object.defineProperty(nestedScrollArea, 'scrollHeight', {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(nestedScrollArea, 'clientHeight', {
      configurable: true,
      value: 240,
    });
    Object.defineProperty(nestedScrollArea, 'scrollTop', {
      configurable: true,
      value: 120,
      writable: true,
    });

    fireEvent.wheel(nestedScrollArea, { deltaY: -120 });
    scrollTo.mockClear();
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(1);
        return 1;
      });

    rerender(
      <ConversationView
        busyState={AGENT_BUSY_STATE}
        isStreaming={true}
        items={nextItems}
        toolExecutionsById={{}}
      />,
    );

    expect(requestAnimationFrame).toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({ top: 600, behavior: 'auto' });
  });

  it('keeps following streaming updates while the user is near the bottom', () => {
    const firstItems: ConversationItem[] = [
      {
        key: 'assistant-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '第一段' }],
          timestamp: 1,
        },
      },
    ];
    const nextItems: ConversationItem[] = [
      {
        key: 'assistant-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '第一段\n\n第二段' }],
          timestamp: 1,
        },
      },
    ];
    const { rerender } = renderConversation({ items: firstItems });
    const scrollContainer = screen.getByLabelText('会话滚动区域');
    const scrollTo = vi.fn();

    Object.defineProperty(scrollContainer, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      value: 560,
      writable: true,
    });

    fireEvent.scroll(scrollContainer);
    scrollTo.mockClear();
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(1);
        return 1;
      });

    rerender(
      <ConversationView
        busyState={AGENT_BUSY_STATE}
        isStreaming={true}
        items={nextItems}
        toolExecutionsById={{}}
      />,
    );

    expect(requestAnimationFrame).toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({ top: 600, behavior: 'auto' });
  });

  it('keeps following visible runtime status changes when rows stay unchanged', () => {
    const items: ConversationItem[] = [
      {
        key: 'user-1',
        message: {
          role: 'user',
          content: 'hello',
          timestamp: 1,
        },
      },
    ];
    const toolExecutionsById: Record<string, ToolExecutionState> = {};
    const { rerender } = renderConversation({
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
      isStreaming: true,
      items,
      toolExecutionsById,
    });
    const scrollContainer = screen.getByLabelText('会话滚动区域');
    const scrollTo = vi.fn();

    Object.defineProperty(scrollContainer, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      value: 560,
      writable: true,
    });

    fireEvent.scroll(scrollContainer);
    scrollTo.mockClear();
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(1);
        return 1;
      });

    rerender(
      <ConversationView
        busyState={{
          kind: 'retry',
          label: 'Retrying',
          cancellable: true,
          attempt: 2,
          maxAttempts: 3,
          reason: 'rate limit',
        }}
        isStreaming={true}
        items={items}
        toolExecutionsById={toolExecutionsById}
      />,
    );

    expect(screen.getByText('正在重试 2/3')).toBeInTheDocument();
    expect(requestAnimationFrame).toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({ top: 600, behavior: 'auto' });
  });

  it('renders runtime partial tool output while a tool is running', () => {
    const { container } = renderConversation({
      isStreaming: true,
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'grep',
                arguments: { pattern: 'hello' },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'grep',
          args: { pattern: 'hello' },
          status: 'running',
          partialResult: {
            content: [{ type: 'text', text: '匹配到 2 行' }],
          },
          isError: false,
        },
      },
    });

    expect(screen.queryByRole('button', { name: /收起过程 正在处理/ })).not.toBeInTheDocument();
    expect(container.querySelector('[data-process-disclosure-icon]')).toBeNull();
    expect(screen.getByText('正在处理')).toBeInTheDocument();
    expect(screen.getByText('正在搜索 hello')).toBeInTheDocument();
    expect(screen.queryByText('匹配到 2 行')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开工具输出 grep/ }));
    expect(screen.getByText(/匹配到 2 行/)).toBeInTheDocument();
  });

  it('renders active tool state from runtime tool execution facts', () => {
    renderConversation({
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
      isStreaming: true,
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'grep',
                arguments: { pattern: 'hello' },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'grep',
          args: { pattern: 'hello' },
          status: 'running',
          partialResult: {
            content: [{ type: 'text', text: '来自运行事实的部分输出' }],
          },
          isError: false,
        },
      },
    });

    expect(screen.queryByRole('button', { name: /收起过程 正在处理/ })).not.toBeInTheDocument();
    expect(screen.getByText('正在搜索 hello')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开工具输出 grep/ }));
    expect(screen.getByText(/来自运行事实的部分输出/)).toBeInTheDocument();
  });

  it('renders pending tool calls as processing actions before execution start arrives', () => {
    renderConversation({
      isStreaming: true,
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'grep',
                arguments: { pattern: 'hello' },
              },
            ],
            timestamp: 1,
          },
        },
      ],
    });

    expect(screen.queryByRole('button', { name: /收起过程 正在处理/ })).not.toBeInTheDocument();
    expect(screen.queryByText('等待搜索 hello')).not.toBeInTheDocument();
    expect(screen.getByText('正在搜索 hello')).toBeInTheDocument();
  });

  it('does not show pending tool calls as running after the turn stops before execution', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'grep',
                arguments: { pattern: 'hello' },
              },
            ],
            stopReason: 'aborted',
            errorMessage: 'Request was aborted',
            timestamp: 1,
          },
        },
      ],
    });

    expect(screen.getByRole('button', { name: /收起回复 已停止/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /收起过程 已停止搜索 hello/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('正在搜索 hello')).not.toBeInTheDocument();
    expect(screen.getByText('你停止了会话')).toBeInTheDocument();
    expect(screen.queryByText('Request was aborted')).not.toBeInTheDocument();
    expect(screen.getByText('已停止搜索 hello')).toBeInTheDocument();
  });

  it('does not show pending tool calls as running after the turn fails before execution', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'grep',
                arguments: { pattern: 'hello' },
              },
            ],
            stopReason: 'error',
            errorMessage: 'Provider request failed before tool execution',
            timestamp: 1,
          },
        },
      ],
    });

    expect(screen.getByRole('button', { name: /收起回复 处理失败/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /收起过程 搜索失败 hello/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('正在搜索 hello')).not.toBeInTheDocument();
    expectToolErrorSummary('搜索失败', 'hello');
  });

  it('renders edit previews with change counts without an expandable diff', () => {
    renderConversation({
      isStreaming: true,
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'edit',
                arguments: {
                  path: 'src/app.ts',
                  edits: [{ oldText: 'old', newText: 'new' }],
                },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      toolPreviewsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'edit',
          preview: {
            kind: 'file_edit',
            path: 'src/app.ts',
            diff: ' 1 const value = 1;\n-2 old\n+2 new',
            additions: 1,
            deletions: 1,
            firstChangedLine: 2,
          },
        },
      },
    });

    expect(screen.queryByRole('button', { name: /收起过程 正在处理/ })).not.toBeInTheDocument();
    expect(screen.getByText('正在编辑 src/app.ts')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
    expect(screen.getAllByText('+1')).toHaveLength(1);
    expect(screen.getAllByText('-1')).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: /展开编辑差异 src\/app\.ts/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('-2 old')).not.toBeInTheDocument();
    expect(screen.queryByText('+2 new')).not.toBeInTheDocument();
  });

  it('renders completed edit final diff previews from details', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'edit',
                arguments: {
                  path: 'src/app.ts',
                  edits: [{ oldText: 'old', newText: 'new' }],
                },
              },
            ],
            timestamp: 1,
          },
        },
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'edit',
            content: [{ type: 'text', text: 'done' }],
            details: {
              kind: 'file_change',
              path: 'src/app.ts',
              additions: 1,
              deletions: 1,
              review: {
                turnId: 'turn-1',
                recordId: 'review-1',
              },
              diffPreview: {
                rows: [
                  { type: 'context', oldLineNumber: 1, newLineNumber: 1, text: 'const value = 1;' },
                  { type: 'removed', oldLineNumber: 2, text: 'old' },
                  { type: 'added', newLineNumber: 2, text: 'new' },
                ],
              },
            },
            isError: false,
            timestamp: 2,
          },
        },
      ],
    });

    expect(screen.queryByText('已编辑的文件')).not.toBeInTheDocument();
    expect(screen.getByText('已编辑 src/app.ts')).toBeInTheDocument();
    expect(screen.getAllByText('+1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('-1').length).toBeGreaterThan(0);

    ensureFileChangeDiffExpanded(/src\/app\.ts/);

    expect(screen.getByText('-2 old')).toBeInTheDocument();
    expect(screen.getByText('+2 new')).toBeInTheDocument();
  });

  it('uses completed edit result display paths for final diff details', () => {
    const previewPath = '/workspace/src/app.ts';
    const detailsPath = '/workspace/src/app.ts';
    const detailsDisplayPath = 'src/app.ts';
    const toolPreviewsById: Record<string, ToolCallPreviewState> = {
      'tool-1': {
        toolCallId: 'tool-1',
        toolName: 'edit',
        preview: {
          kind: 'file_edit',
          path: previewPath,
          diff: ' 1 const value = 1;\n-2 old\n+2 new',
          additions: 1,
          deletions: 1,
          firstChangedLine: 2,
        },
      },
    };
    const assistantItem: ConversationItem = {
      key: 'assistant-1',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'tool-1',
            name: 'edit',
            arguments: {
              path: previewPath,
              edits: [{ oldText: 'old', newText: 'new' }],
            },
          },
        ],
        timestamp: 1,
      },
    };
    const { rerender } = renderConversation({
      isStreaming: true,
      items: [assistantItem],
      toolPreviewsById,
    });

    expect(screen.queryByRole('button', { name: /展开编辑差异/ })).not.toBeInTheDocument();
    expect(screen.queryByText('-2 old')).not.toBeInTheDocument();

    act(() => {
      rerender(
        <ConversationView
          busyState={IDLE_BUSY_STATE}
          isStreaming={false}
          items={[
            assistantItem,
            {
              key: 'tool-result-1',
              message: {
                role: 'toolResult',
                toolCallId: 'tool-1',
                toolName: 'edit',
                content: [{ type: 'text', text: 'done' }],
                details: {
                  kind: 'file_change',
                  path: detailsPath,
                  displayPath: detailsDisplayPath,
                  additions: 1,
                  deletions: 1,
                  review: {
                    turnId: 'turn-1',
                    recordId: 'review-1',
                  },
                  diffPreview: {
                    rows: [
                      { type: 'removed', oldLineNumber: 2, text: 'old' },
                      { type: 'added', newLineNumber: 2, text: 'new' },
                    ],
                  },
                },
                isError: false,
                timestamp: 2,
              },
            },
          ]}
          toolExecutionsById={{}}
          toolPreviewsById={toolPreviewsById}
        />,
      );
    });

    expect(screen.queryByText('已编辑的文件')).not.toBeInTheDocument();
    expect(screen.getByText('已编辑 src/app.ts')).toBeInTheDocument();
    expect(screen.queryByText('已编辑 /workspace/src/app.ts')).not.toBeInTheDocument();

    ensureFileChangeDiffExpanded(/src\/app\.ts/);

    expect(screen.getByText('-2 old')).toBeInTheDocument();
    expect(screen.getByText('+2 new')).toBeInTheDocument();
  });

  it('limits large completed edit diffs until the detail is explicitly expanded', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'edit',
                arguments: { path: 'src/large.ts' },
              },
            ],
            timestamp: 1,
          },
        },
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'edit',
            content: [{ type: 'text', text: 'done' }],
            details: {
              kind: 'file_change',
              path: 'src/large.ts',
              additions: 0,
              deletions: 0,
              review: {
                turnId: 'turn-1',
                recordId: 'review-1',
              },
              diffPreview: {
                rows: Array.from({ length: 405 }, (_, index) => ({
                  type: 'context' as const,
                  newLineNumber: index + 1,
                  text: `line-${index + 1}`,
                })),
              },
            },
            isError: false,
            timestamp: 2,
          },
        },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: /展开文件变更 src\/large\.ts/ }));

    expect(screen.getByText(/400 line-400/)).toBeInTheDocument();
    expect(screen.queryByText(/405 line-405/)).not.toBeInTheDocument();
    const showAll = screen.getByRole('button', { name: /显示全部 405 行，已隐藏 5 行/ });

    fireEvent.click(showAll);

    expect(screen.getByText(/405 line-405/)).toBeInTheDocument();
  });

  it('does not render large write arguments in the tool row', () => {
    const content = Array.from({ length: 405 }, (_, index) => `line-${index + 1}`).join('\n');

    renderConversation({
      isStreaming: true,
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'write',
                arguments: { path: 'src/large.ts', content },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'write',
          args: { path: 'src/large.ts', content },
          status: 'running',
          isError: false,
        },
      },
    });

    expect(screen.getByText('正在写入 src/large.ts')).toBeInTheDocument();
    expect(screen.queryByText('line-1')).not.toBeInTheDocument();
    expect(screen.queryByText('line-405')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /展开写入内容 src\/large\.ts/ }),
    ).not.toBeInTheDocument();
  });
  it('shows edit preview errors without marking the real tool execution as failed', () => {
    renderConversation({
      isStreaming: true,
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'edit',
                arguments: {
                  path: 'src/app.ts',
                  edits: [{ oldText: 'missing', newText: 'new' }],
                },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      toolPreviewsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'edit',
          preview: {
            kind: 'file_edit',
            path: 'src/app.ts',
            additions: 0,
            deletions: 0,
            error: 'Could not find the exact text',
          },
        },
      },
    });

    expect(screen.getByText('预览失败 编辑 src/app.ts')).toBeInTheDocument();
    expect(screen.queryByText('编辑失败 src/app.ts')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /展开编辑差异 src\/app\.ts/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Could not find the exact text')).not.toBeInTheDocument();
  });

  it('keeps tool details inside the process body instead of the outer summary', () => {
    renderConversation({
      isStreaming: true,
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: '分析搜索范围' },
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'grep',
                arguments: { pattern: 'hello' },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'grep',
          args: { pattern: 'hello' },
          status: 'running',
          partialResult: {
            content: [{ type: 'text', text: '匹配到 2 行' }],
          },
          isError: false,
        },
      },
    });

    expect(screen.queryByRole('button', { name: /收起过程 正在处理/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /正在搜索 hello/ })).not.toBeInTheDocument();
    expect(screen.getByText('正在搜索 hello')).toBeInTheDocument();
    expect(screen.queryByText('正在搜索 hello 等 2 项')).not.toBeInTheDocument();
    expect(screen.getByText('分析搜索范围')).toBeInTheDocument();
    expect(screen.queryByText('匹配到 2 行')).not.toBeInTheDocument();
  });

  it('keeps the turn processing after tools while preserving model phases', () => {
    renderConversation({
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
      isStreaming: true,
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: '先定位文件' },
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'read',
                arguments: { path: 'README.md' },
              },
            ],
            timestamp: 1,
          },
        },
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'read',
            content: [{ type: 'text', text: '文件内容' }],
            isError: false,
            timestamp: 2,
          },
        },
        {
          key: 'assistant-2',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: '根据文件内容继续分析' }],
            timestamp: 3,
          },
        },
      ],
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'read',
          args: { path: 'README.md' },
          status: 'done',
          result: {
            content: [{ type: 'text', text: '文件内容' }],
          },
          isError: false,
        },
      },
    });

    expect(
      screen.queryByRole('button', { name: /展开过程 已阅读 README\.md/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('根据文件内容继续分析')).toBeInTheDocument();
    const thinking = screen.getByText('先定位文件');
    const readActivity = screen.getByText('已阅读 README.md');
    expect(thinking.compareDocumentPosition(readActivity) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    expect(screen.getAllByText('先定位文件')).toHaveLength(1);
    expect(screen.getByText('已阅读 README.md')).toBeInTheDocument();
    expect(
      screen.getByText('先定位文件').closest('[data-assistant-process-phase]'),
    ).toHaveAttribute('data-assistant-process-phase', 'model_responding');
    const readActivityLabels = screen.getAllByText('已阅读 README.md');
    expect(
      readActivityLabels[readActivityLabels.length - 1].closest('[data-assistant-process-phase]'),
    ).toHaveAttribute('data-assistant-process-phase', 'tool_processing');
  });

  it('opens errored tool calls and labels the error output', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'bash',
                arguments: { command: 'pnpm test' },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'bash',
          args: { command: 'pnpm test' },
          status: 'error',
          result: {
            content: [{ type: 'text', text: '测试失败' }],
          },
          isError: true,
        },
      },
    });

    expandCompletedTurn();
    expectToolErrorSummary('运行失败', 'pnpm test');
    expect(
      screen.queryByRole('button', { name: /展开过程 运行失败 pnpm test/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('测试失败')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开工具输出 bash/ }));
    expect(screen.getByText(/测试失败/)).toBeInTheDocument();
    expect(screen.getByText('× 失败')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /收起工具输出 bash/ }));
    expect(screen.queryByText(/测试失败/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /展开工具输出 bash/ })).toBeInTheDocument();
  });

  it('summarizes list tools with the shared folder display category', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'ls',
                arguments: { path: 'src' },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'ls',
          args: { path: 'src' },
          status: 'done',
          result: {
            content: [{ type: 'text', text: 'index.ts' }],
          },
          isError: false,
        },
      },
    });

    expandCompletedTurn();
    expect(screen.getByText('已列出 src')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /展开过程 已列出 src/ })).not.toBeInTheDocument();
    expect(screen.queryByText('处理了 1 项')).not.toBeInTheDocument();
  });

  it('summarizes multiple tools of the same category in one process block', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'bash',
                arguments: { command: 'pnpm lint' },
              },
              {
                type: 'toolCall',
                id: 'tool-2',
                name: 'bash',
                arguments: { command: 'pnpm test' },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'bash',
          args: { command: 'pnpm lint' },
          status: 'done',
          isError: false,
        },
        'tool-2': {
          toolCallId: 'tool-2',
          toolName: 'bash',
          args: { command: 'pnpm test' },
          status: 'done',
          isError: false,
        },
      },
    });

    expandCompletedTurn();
    expect(screen.getByRole('button', { name: /展开过程 已运行 2 条命令/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /展开过程 已运行 pnpm lint/ }),
    ).not.toBeInTheDocument();
  });

  it('uses a single mixed summary for multiple tool categories in one process block', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'bash',
                arguments: { command: 'pnpm test' },
              },
              {
                type: 'toolCall',
                id: 'tool-2',
                name: 'read',
                arguments: { path: 'README.md' },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'bash',
          args: { command: 'pnpm test' },
          status: 'done',
          isError: false,
        },
        'tool-2': {
          toolCallId: 'tool-2',
          toolName: 'read',
          args: { path: 'README.md' },
          status: 'done',
          isError: false,
        },
      },
    });

    expandCompletedTurn();
    expect(screen.getByRole('button', { name: /展开过程 已完成 2 项/ })).toBeInTheDocument();
    expect(screen.queryByText('已运行 1 条命令')).not.toBeInTheDocument();
    expect(screen.queryByText('已阅读 1 个文件')).not.toBeInTheDocument();
  });

  it('collapses process summaries when the assistant turn closes', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: '最终答案内容' },
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'bash',
                arguments: { command: 'pnpm test' },
              },
            ],
            timestamp: 1,
          },
        },
      ],
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'bash',
          args: { command: 'pnpm test' },
          status: 'error',
          result: {
            content: [{ type: 'text', text: '测试失败' }],
          },
          isError: true,
        },
      },
    });

    expandCompletedTurn();
    fireEvent.click(screen.getByRole('button', { name: /展开工具输出 bash/ }));
    expect(screen.getByText('最终答案内容')).toBeInTheDocument();
    expect(screen.getByText(/测试失败/)).toBeInTheDocument();

    const turnNode = Object.values(useConversationExpansionStore.getState().nodesById).find(
      (node) => node.kind === 'assistant_turn',
    );
    if (!turnNode) throw new Error('Expected assistant turn expansion node');

    act(() => {
      useConversationExpansionStore.getState().actions.setExpanded(turnNode.id, false);
    });

    expect(screen.getByRole('button', { name: /展开回复 已处理/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /展开工具输出 bash/ })).not.toBeInTheDocument();
    expect(screen.getByText('最终答案内容')).toBeInTheDocument();
    expect(screen.queryByText('运行失败 pnpm test')).not.toBeInTheDocument();
    expect(screen.queryByText(/测试失败/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开回复 已处理/ }));
    expect(screen.getByRole('button', { name: /展开工具输出 bash/ })).toBeInTheDocument();
    expect(screen.getByText('最终答案内容')).toBeInTheDocument();
    expect(screen.queryByText(/测试失败/)).not.toBeInTheDocument();
  });

  it('keeps expansion state scoped to the active session', () => {
    const items: ConversationItem[] = [
      {
        key: 'assistant-1',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'tool-1',
              name: 'bash',
              arguments: { command: 'pnpm test' },
            },
          ],
          timestamp: 1,
        },
      },
    ];
    const toolExecutionsById: Record<string, ToolExecutionState> = {
      'tool-1': {
        toolCallId: 'tool-1',
        toolName: 'bash',
        args: { command: 'pnpm test' },
        status: 'done',
        result: {
          content: [{ type: 'text', text: '测试输出' }],
        },
        isError: false,
      },
    };
    const { rerender } = renderConversation({
      expansionScope: 'session-one',
      items,
      toolExecutionsById,
    });

    expect(screen.getByRole('button', { name: /展开回复 已处理/ })).toBeInTheDocument();
    expandCompletedTurn();
    expect(screen.getByRole('button', { name: /收起回复 已处理/ })).toBeInTheDocument();

    rerender(
      <ConversationView
        busyState={IDLE_BUSY_STATE}
        expansionScope="session-two"
        isStreaming={false}
        items={items}
        toolExecutionsById={toolExecutionsById}
      />,
    );

    expect(screen.getByRole('button', { name: /展开回复 已处理/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /展开工具输出 bash/ })).not.toBeInTheDocument();
    expandCompletedTurn();
    expect(screen.getByRole('button', { name: /展开工具输出 bash/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /展开过程 已运行 pnpm test/ }),
    ).not.toBeInTheDocument();
  });

  it('falls back to a system block for orphan tool results', () => {
    renderConversation({
      items: [
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'missing-tool',
            toolName: 'orphan',
            content: [{ type: 'text', text: '孤儿工具结果' }],
            isError: false,
            timestamp: 1,
          },
        },
      ],
    });

    expect(screen.getByText('orphan')).toBeInTheDocument();
    expect(screen.getByText('孤儿工具结果')).toBeInTheDocument();
  });
});

describe('conversation rows projector', () => {
  it('reuses unchanged prefix rows when a later streaming assistant updates', () => {
    const firstUserMessage: ConversationItem['message'] = {
      role: 'user',
      content: 'first',
      timestamp: 1,
    };
    const settledAssistantMessage: ConversationItem['message'] = {
      role: 'assistant',
      content: [{ type: 'text', text: 'settled answer' }],
      timestamp: 2,
    };
    const streamingUserMessage: ConversationItem['message'] = {
      role: 'user',
      content: 'second',
      timestamp: 3,
    };
    const streamingAssistantStart: ConversationItem['message'] = {
      role: 'assistant',
      content: [{ type: 'text', text: 'hel' }],
      timestamp: 4,
    };
    const streamingAssistantUpdate: ConversationItem['message'] = {
      role: 'assistant',
      content: [{ type: 'text', text: 'hello' }],
      timestamp: 4,
    };
    const projector = createConversationRowsProjector();

    const firstRows = projector.project({
      isStreaming: true,
      busyState: AGENT_BUSY_STATE,
      toolExecutionsById: {},
      items: [
        { key: 'user-1', message: firstUserMessage },
        { key: 'assistant-1', message: settledAssistantMessage },
        { key: 'user-2', message: streamingUserMessage },
        { key: 'assistant-2', message: streamingAssistantStart },
      ],
    });

    const nextRows = projector.project({
      isStreaming: true,
      busyState: AGENT_BUSY_STATE,
      toolExecutionsById: {},
      items: [
        { key: 'user-1', message: firstUserMessage },
        { key: 'assistant-1', message: settledAssistantMessage },
        { key: 'user-2', message: streamingUserMessage },
        { key: 'assistant-2', message: streamingAssistantUpdate },
      ],
    });

    expect(nextRows[0]).toBe(firstRows[0]);
    expect(nextRows[1]).toBe(firstRows[1]);
    expect(nextRows[2]).toBe(firstRows[2]);
    expect(nextRows[3]).not.toBe(firstRows[3]);
  });
});
describe('buildConversationRows', () => {
  it('projects assistant terminal outcomes by kind', () => {
    const abortedRows = buildConversationRows({
      isStreaming: false,
      busyState: IDLE_BUSY_STATE,
      toolExecutionsById: {},
      items: [
        {
          key: 'assistant-aborted',
          message: {
            role: 'assistant',
            content: [],
            stopReason: 'aborted',
            errorMessage: 'Request was aborted',
            timestamp: 1,
          },
        },
      ],
    });
    const errorRows = buildConversationRows({
      isStreaming: false,
      busyState: IDLE_BUSY_STATE,
      toolExecutionsById: {},
      items: [
        {
          key: 'assistant-error',
          message: {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage: 'Provider request failed',
            timestamp: 1,
          },
        },
      ],
    });

    expect(abortedRows.at(-1)).toMatchObject({
      type: 'assistant_outcome',
      kind: 'aborted',
      text: '你停止了会话',
    });
    expect(errorRows.at(-1)).toMatchObject({
      type: 'assistant_outcome',
      kind: 'error',
      text: 'Provider request failed',
    });

    const compactingRows = buildConversationRows({
      isStreaming: true,
      busyState: { kind: 'compaction', label: 'Compacting', cancellable: true, reason: 'manual' },
      toolExecutionsById: {},
      items: [],
    });
    const compactedRows = buildConversationRows({
      isStreaming: false,
      busyState: IDLE_BUSY_STATE,
      toolExecutionsById: {},
      items: [
        {
          key: 'compaction-1',
          message: {
            role: 'compactionSummary',
            summary: 'Compressed context',
            tokensBefore: 1234,
            timestamp: 1,
          },
        },
      ],
    });

    expect(compactingRows.at(-1)).toMatchObject({
      type: 'assistant_outcome',
      kind: 'compacting',
      text: '正在压缩上下文',
    });
    expect(compactedRows.at(-1)).toMatchObject({
      type: 'assistant_outcome',
      kind: 'compacted',
      text: '上下文已压缩',
      markdown: 'Compressed context',
    });
  });
  it('segments assistant process entries around interleaved text', () => {
    const rows = buildConversationRows({
      isStreaming: true,
      busyState: AGENT_BUSY_STATE,
      toolExecutionsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'read',
          args: { path: 'README.md' },
          status: 'done',
          isError: false,
        },
        'tool-2': {
          toolCallId: 'tool-2',
          toolName: 'grep',
          args: { pattern: 'TODO' },
          status: 'running',
          isError: false,
        },
      },
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: '先说明读取计划' },
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'read',
                arguments: { path: 'README.md' },
              },
              { type: 'text', text: '再说明搜索计划' },
              {
                type: 'toolCall',
                id: 'tool-2',
                name: 'grep',
                arguments: { pattern: 'TODO' },
              },
            ],
            timestamp: 1,
          },
        },
      ],
    });

    const assistantRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { type: 'assistant' }> =>
        row.type === 'assistant',
    );
    if (assistantRow?.type !== 'assistant') {
      throw new Error('Expected assistant row');
    }

    expect(assistantRow.entries.map((entry) => entry.type)).toEqual([
      'content',
      'process',
      'content',
      'process',
    ]);
    expect(assistantRow.entries[1]).toMatchObject({
      type: 'process',
      summary: { status: 'completed', label: '已处理' },
      defaultOpen: false,
    });
    expect(assistantRow.entries[3]).toMatchObject({
      type: 'process',
      summary: { status: 'work_processing', label: '正在处理' },
      defaultOpen: true,
    });
  });

  it('does not carry processing trace from a prior turn into a new waiting turn', () => {
    const rows = buildConversationRows({
      isStreaming: true,
      busyState: AGENT_BUSY_STATE,
      toolExecutionsById: {},
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: '上一轮已完成' }],
            timestamp: 1,
          },
        },
        {
          key: 'user-1',
          message: {
            role: 'user',
            content: '继续',
            timestamp: 2,
          },
        },
      ],
    });

    const latestAssistant = rows.filter((row) => row.type === 'assistant').at(-1);
    const processEntry =
      latestAssistant?.type === 'assistant' ? latestAssistant.entries[0] : undefined;

    expect(processEntry).toMatchObject({
      type: 'process',
      summary: { status: 'model_deciding', label: '正在思考' },
      phases: [],
    });
  });

  it('ignores running tools that do not belong to the current streaming assistant', () => {
    const rows = buildConversationRows({
      isStreaming: true,
      busyState: AGENT_BUSY_STATE,
      toolExecutionsById: {
        'other-tool': {
          toolCallId: 'other-tool',
          toolName: 'bash',
          status: 'running',
          isError: false,
        },
      },
      items: [
        {
          key: 'user-1',
          message: {
            role: 'user',
            content: '继续',
            timestamp: 1,
          },
        },
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [],
            timestamp: 2,
          },
        },
      ],
    });

    const latestAssistant = rows.filter((row) => row.type === 'assistant').at(-1);
    const processEntry =
      latestAssistant?.type === 'assistant' ? latestAssistant.entries[0] : undefined;

    expect(processEntry).toMatchObject({
      type: 'process',
      summary: { status: 'model_deciding', label: '正在思考' },
      phases: [],
    });
  });

  it('pairs duplicate tool call ids with the next unconsumed following result', () => {
    const rows = buildConversationRows({
      isStreaming: false,
      busyState: IDLE_BUSY_STATE,
      toolExecutionsById: {},
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'duplicate-tool',
                name: 'bash',
                arguments: { command: 'printf first' },
              },
            ],
            timestamp: 1,
          },
        },
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'duplicate-tool',
            toolName: 'bash',
            content: [{ type: 'text', text: 'first output' }],
            isError: false,
            timestamp: 2,
          },
        },
        {
          key: 'assistant-2',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'duplicate-tool',
                name: 'bash',
                arguments: { command: 'printf second' },
              },
            ],
            timestamp: 3,
          },
        },
        {
          key: 'tool-result-2',
          message: {
            role: 'toolResult',
            toolCallId: 'duplicate-tool',
            toolName: 'bash',
            content: [{ type: 'text', text: 'second output' }],
            isError: false,
            timestamp: 4,
          },
        },
      ],
    });

    const toolActivities = rows.flatMap((row) =>
      row.type === 'assistant'
        ? row.entries.flatMap((entry) =>
            entry.type === 'process'
              ? entry.phases.flatMap((phase) => phase.activities).filter(isToolActivity)
              : [],
          )
        : [],
    );

    expect(toolActivities.map((activity) => activity.toolResult?.content)).toEqual([
      [{ type: 'text', text: 'first output' }],
      [{ type: 'text', text: 'second output' }],
    ]);
  });

  it('uses final edit result details before transient edit previews', () => {
    const rows = buildConversationRows({
      isStreaming: false,
      busyState: IDLE_BUSY_STATE,
      toolExecutionsById: {},
      toolPreviewsById: {
        'tool-1': {
          toolCallId: 'tool-1',
          toolName: 'edit',
          preview: {
            kind: 'file_edit',
            path: 'src/app.ts',
            diff: '-1 old\n+1 preview',
            additions: 1,
            deletions: 1,
          },
        },
      },
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'edit',
                arguments: {
                  path: 'src/app.ts',
                  edits: [{ oldText: 'old', newText: 'final' }],
                },
              },
            ],
            changesReviews: [
              makeChangesReviewSummary({
                files: [
                  {
                    path: 'src/app.ts',
                    displayPath: 'src/app.ts',
                    additions: 2,
                    deletions: 1,
                  },
                ],
              }),
            ],
            timestamp: 1,
          },
        },
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'edit',
            content: [{ type: 'text', text: 'done' }],
            details: {
              kind: 'file_change',
              path: 'src/app.ts',
              additions: 2,
              deletions: 1,
              firstChangedLine: 1,
              review: {
                turnId: 'turn-1',
                recordId: 'review-1',
              },
              diffPreview: {
                rows: [
                  { type: 'removed', oldLineNumber: 1, text: 'old' },
                  { type: 'added', newLineNumber: 1, text: 'final' },
                ],
              },
            },
            isError: false,
            timestamp: 2,
          },
        },
      ],
    });

    const toolActivity = rows
      .flatMap((row) =>
        row.type === 'assistant'
          ? row.entries.flatMap((entry) =>
              entry.type === 'process'
                ? entry.phases.flatMap((phase) => phase.activities).filter(isToolActivity)
                : [],
            )
          : [],
      )
      .at(0);

    expect(toolActivity?.display).toMatchObject({
      kind: 'file_change',
      detailLabel: '文件变更',
      detailTarget: 'src/app.ts',
      metrics: [
        { key: 'additions', value: 2, prefix: '+', tone: 'added' },
        { key: 'deletions', value: 1, prefix: '-', tone: 'deleted' },
      ],
    });
    expect(toolActivity?.display.detail).toMatchObject({
      kind: 'diff',
      path: 'src/app.ts',
      diffText: '-1 old\n+1 final',
      additions: 2,
      deletions: 1,
    });

    const assistantRow = rows.find((row) => row.type === 'assistant');
    expect(assistantRow?.changesReviews).toMatchObject([
      {
        turnId: 'turn-1',
        fileCount: 1,
        additions: 2,
        deletions: 1,
      },
    ]);
  });

  it('does not render expandable final diff details without a host-enriched preview', () => {
    const rows = buildConversationRows({
      isStreaming: false,
      busyState: IDLE_BUSY_STATE,
      toolExecutionsById: {},
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'edit',
                arguments: { path: 'src/app.ts' },
              },
            ],
            timestamp: 1,
          },
        },
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'edit',
            content: [{ type: 'text', text: 'done' }],
            details: {
              kind: 'file_change',
              path: 'src/app.ts',
              additions: 1,
              deletions: 1,
              review: {
                turnId: 'turn-1',
                recordId: 'review-1',
              },
            },
            isError: false,
            timestamp: 2,
          },
        },
      ],
    });

    const toolActivity = rows
      .flatMap((row) =>
        row.type === 'assistant'
          ? row.entries.flatMap((entry) =>
              entry.type === 'process'
                ? entry.phases.flatMap((phase) => phase.activities).filter(isToolActivity)
                : [],
            )
          : [],
      )
      .at(0);

    expect(toolActivity?.display).toMatchObject({
      kind: 'file_change',
      detailLabel: '文件变更',
      detailTarget: 'src/app.ts',
    });
    expect(toolActivity?.display.detail).toBeUndefined();
  });

  it('does not infer final diff previews from review summaries', () => {
    const rows = buildConversationRows({
      isStreaming: false,
      busyState: IDLE_BUSY_STATE,
      toolExecutionsById: {},
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'edit',
                arguments: { path: 'src/app.ts' },
              },
            ],
            changesReviews: [
              makeChangesReviewSummary({
                files: [
                  { path: 'src/app.ts', displayPath: 'src/app.ts', additions: 1, deletions: 1 },
                ],
              }),
            ],
            timestamp: 1,
          },
        },
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'edit',
            content: [{ type: 'text', text: 'done' }],
            details: {
              kind: 'file_change',
              path: 'src/app.ts',
              additions: 1,
              deletions: 1,
              review: {
                turnId: 'turn-1',
              },
            },
            isError: false,
            timestamp: 2,
          },
        },
      ],
    });

    const toolActivity = rows
      .flatMap((row) =>
        row.type === 'assistant'
          ? row.entries.flatMap((entry) =>
              entry.type === 'process'
                ? entry.phases.flatMap((phase) => phase.activities).filter(isToolActivity)
                : [],
            )
          : [],
      )
      .at(0);

    expect(toolActivity?.display).toMatchObject({
      kind: 'file_change',
      detailLabel: '文件变更',
      detailTarget: 'src/app.ts',
    });
    expect(toolActivity?.display.detail).toBeUndefined();
  });

  it('does not treat unmarked edit diff details as file edit output', () => {
    const rows = buildConversationRows({
      isStreaming: false,
      busyState: IDLE_BUSY_STATE,
      toolExecutionsById: {},
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'edit',
                arguments: { path: 'src/app.ts' },
              },
            ],
            timestamp: 1,
          },
        },
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'edit',
            content: [{ type: 'text', text: 'extension output' }],
            details: {
              diff: '-1 old\n+1 extension',
            },
            isError: false,
            timestamp: 2,
          },
        },
      ],
    });

    const toolActivity = rows
      .flatMap((row) =>
        row.type === 'assistant'
          ? row.entries.flatMap((entry) =>
              entry.type === 'process'
                ? entry.phases.flatMap((phase) => phase.activities).filter(isToolActivity)
                : [],
            )
          : [],
      )
      .at(0);

    expect(toolActivity?.display.kind).toBe('generic');
    if (toolActivity?.display.kind !== 'generic') {
      throw new Error('Expected generic tool display');
    }
    const detail = toolActivity.display.detail;
    expect(detail?.kind).toBe('text');
    if (detail?.kind !== 'text') {
      throw new Error('Expected text tool detail');
    }
    expect(detail.text).toContain('extension output');
  });

  it('keeps a prior matching tool result orphaned instead of attaching it to a later call', () => {
    const rows = buildConversationRows({
      isStreaming: false,
      busyState: IDLE_BUSY_STATE,
      toolExecutionsById: {},
      items: [
        {
          key: 'tool-result-1',
          message: {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'bash',
            content: [{ type: 'text', text: 'orphan output' }],
            isError: false,
            timestamp: 1,
          },
        },
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'bash',
                arguments: { command: 'printf later' },
              },
            ],
            timestamp: 2,
          },
        },
      ],
    });

    expect(rows[0]).toMatchObject({
      type: 'system',
      title: 'bash',
      text: 'orphan output',
    });

    const assistantRow = rows.find((row) => row.type === 'assistant');
    const toolActivity =
      assistantRow?.type === 'assistant'
        ? assistantRow.entries
            .flatMap((entry) =>
              entry.type === 'process'
                ? entry.phases.flatMap((phase) => phase.activities).filter(isToolActivity)
                : [],
            )
            .at(0)
        : undefined;

    expect(toolActivity?.toolResult).toBeUndefined();
    expect(toolActivity?.display.status).toBe('pending');
  });
});
