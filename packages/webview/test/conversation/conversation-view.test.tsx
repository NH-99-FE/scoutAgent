import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScoutBusyState } from '@scout-agent/shared';
import { ConversationView } from '@/features/conversation/ConversationView';
import {
  buildConversationRows,
  type AssistantProcessActivity,
} from '@/features/conversation/conversation-view-model';
import type {
  ConversationItem,
  ToolCallPreviewState,
  ToolExecutionState,
} from '@/store/conversation-store';

const IDLE_BUSY_STATE: ScoutBusyState = { kind: 'idle', cancellable: false };
const AGENT_BUSY_STATE: ScoutBusyState = { kind: 'agent', label: 'Working', cancellable: true };

function renderConversation({
  busyState,
  items,
  isStreaming = false,
  showScrollToBottomButton = false,
  toolExecutionsById = {},
  toolPreviewsById = {},
}: {
  busyState?: ScoutBusyState;
  items: ConversationItem[];
  isStreaming?: boolean;
  showScrollToBottomButton?: boolean;
  toolExecutionsById?: Record<string, ToolExecutionState>;
  toolPreviewsById?: Record<string, ToolCallPreviewState>;
}) {
  const resolvedBusyState = busyState ?? (isStreaming ? AGENT_BUSY_STATE : IDLE_BUSY_STATE);
  return render(
    <ConversationView
      busyState={resolvedBusyState}
      isStreaming={isStreaming}
      items={items}
      showScrollToBottomButton={showScrollToBottomButton}
      toolExecutionsById={toolExecutionsById}
      toolPreviewsById={toolPreviewsById}
    />,
  );
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

function isToolActivity(
  activity: AssistantProcessActivity,
): activity is Extract<AssistantProcessActivity, { type: 'tool' }> {
  return activity.type === 'tool';
}

describe('ConversationView', () => {
  afterEach(() => {
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

    fireEvent.click(screen.getByRole('button', { name: /收起过程 正在思考/ }));
    expect(screen.queryByText('分析当前布局')).not.toBeInTheDocument();

    rerender(
      <ConversationView
        busyState={IDLE_BUSY_STATE}
        isStreaming={false}
        items={items}
        toolExecutionsById={{}}
      />,
    );

    expect(screen.getByText('已处理')).toBeInTheDocument();
    expect(container.querySelector('[data-process-disclosure-icon]')).toBeTruthy();
    expect(screen.queryByText('分析当前布局')).not.toBeInTheDocument();
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

    expect(screen.getByText('正在思考')).toBeInTheDocument();
    expect(screen.queryByText('分析当前布局')).not.toBeInTheDocument();
    expect(screen.getByText('最终答案开始输出')).toBeInTheDocument();
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

    expect(screen.getByText('已处理')).toBeInTheDocument();
    expect(screen.getByText('正在思考')).toBeInTheDocument();
    expect(screen.queryByText('上一轮思考')).not.toBeInTheDocument();
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

    const userBubble = container.querySelector('article > div');
    expect(userBubble).toHaveClass('scout-user-message');
    expect(userBubble).toHaveClass('min-w-0', 'max-w-[77%]');
    expect(userBubble).toHaveClass('whitespace-pre-wrap');
    expect(userBubble).toHaveClass('[overflow-wrap:anywhere]');
    expect(userBubble).not.toHaveClass('overflow-hidden');
    expect(userBubble?.className).not.toContain('sm:max-w');
    expect(userBubble?.className).not.toContain('lg:max-w');
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

  it('renders compaction and retry status inline at the bottom of the conversation', () => {
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

    expect(screen.getByText('压缩中')).toBeInTheDocument();
    expect(screen.getByText('上下文溢出恢复')).toBeInTheDocument();
    expect(screen.queryByText('正在思考')).not.toBeInTheDocument();
    expect(screen.queryByText('正在处理')).not.toBeInTheDocument();
    expect(container.querySelector('[data-runtime-inline-status="compaction"]')).toBeTruthy();

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
    expect(screen.getByRole('button', { name: /收起过程 处理失败/ })).toBeInTheDocument();
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

    let frameTimestamp = 0;
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        frameTimestamp += 80;
        callback(frameTimestamp);
        return frameTimestamp;
      });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    fireEvent.click(button);

    expect(requestAnimationFrame).toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(resolvedViewport.scrollTop).toBe(840);
    expect(screen.queryByRole('button', { name: '滚动到底部' })).not.toBeInTheDocument();
  });

  it('does not render an inline status for normal agent streaming', () => {
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
    expect(screen.getByText('正在思考')).toHaveClass('scout-running-text-shimmer');
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

    expect(screen.getByText('正在思考')).toBeInTheDocument();
    expect(screen.queryByText('等待模型响应')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /展开过程 正在思考/ })).toBeDisabled();
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
    expect(screen.queryByText('等待模型响应')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /展开过程 正在思考/ })).toBeDisabled();
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

    expect(screen.getByRole('button', { name: /展开过程 正在思考/ })).toBeDisabled();
    expect(screen.queryByText('等待模型响应')).not.toBeInTheDocument();
  });

  it('shows stopped turns as expanded process history', () => {
    renderConversation({
      items: [
        {
          key: 'assistant-1',
          message: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: '已经检查到这里' }],
            stopReason: 'aborted',
            timestamp: 1,
          },
        },
      ],
    });

    expect(screen.getByRole('button', { name: /收起过程 已停止/ })).toBeInTheDocument();
    expect(screen.getByText('已经检查到这里')).toBeInTheDocument();
  });

  it('shows failed turns only for assistant error stop reasons', () => {
    renderConversation({
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

    expect(screen.getByRole('button', { name: /收起过程 处理失败/ })).toBeInTheDocument();
    expect(screen.getByText('Provider request failed')).toBeInTheDocument();
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

    expect(screen.getByRole('button', { name: /展开过程 已处理/ })).toBeInTheDocument();
    expect(screen.getByText('已经给出可用结果')).toBeInTheDocument();
    expect(screen.queryByText('某个内部状态需要注意')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开过程 已处理/ }));
    expect(screen.getByText('某个内部状态需要注意')).toBeInTheDocument();
  });

  it('respects manual process expansion across streaming updates', () => {
    const firstItems: ConversationItem[] = [
      {
        key: 'message-1',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: '第一段思考' }],
          timestamp: 1,
        },
      },
    ];
    const nextItems: ConversationItem[] = [
      {
        key: 'message-1',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: '第二段思考' }],
          timestamp: 1,
        },
      },
    ];
    const { rerender } = renderConversation({
      items: firstItems,
      isStreaming: true,
    });

    expect(screen.getByText('第一段思考')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /收起过程 正在思考/ }));
    expect(screen.queryByText('第一段思考')).not.toBeInTheDocument();

    rerender(
      <ConversationView
        busyState={AGENT_BUSY_STATE}
        isStreaming={true}
        items={nextItems}
        toolExecutionsById={{}}
      />,
    );

    expect(screen.getByText('正在思考')).toBeInTheDocument();
    expect(screen.queryByText('第二段思考')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开过程 正在思考/ }));
    expect(screen.getByText('第二段思考')).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: /展开过程 已处理/ })).toBeInTheDocument();
    expect(screen.queryByText('已读取 README.md')).not.toBeInTheDocument();
    expect(screen.queryByText('文件内容')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开过程 已处理/ }));

    expect(screen.getAllByText('已读取 README.md').length).toBeGreaterThan(0);
    expect(screen.queryByText('文件内容')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /展开工具输出 read/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/"path": "README.md"/)).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: /展开过程 已处理/ }));
    expect(screen.getAllByText('读取失败 missing.md').length).toBeGreaterThan(0);
    expect(screen.queryByText(/ENOENT/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开工具输出 read/ }));
    expect(screen.getByText(/ENOENT: no such file or directory/)).toBeInTheDocument();
    expect(screen.getByText('× 失败')).toBeInTheDocument();
    expect(screen.queryByText(/"path": "missing.md"/)).not.toBeInTheDocument();
  });

  it('shows write progress as a compact line count and expands generated content', () => {
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
    expect(screen.getByText('+3')).toBeInTheDocument();
    expect(screen.queryByText('-0')).not.toBeInTheDocument();
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开写入内容 src\/generated\.ts/ }));
    expect(screen.getByText(/secret/)).toBeInTheDocument();
  });

  it('shows growing write line counts while exposing generated content on expand', () => {
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
    });

    expect(screen.getByText('正在创建 src/generated.ts')).toBeInTheDocument();
    expect(screen.getByText('+3')).toBeInTheDocument();
    expect(screen.queryByText('-0')).not.toBeInTheDocument();
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开写入内容 src\/generated\.ts/ }));
    expect(screen.getByText(/secret/)).toBeInTheDocument();
  });

  it('preserves raw write content when counting and rendering lines', () => {
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
                name: 'write',
                arguments: { path: 'src/spaced.ts', content: '  indented\n   \nlast\n' },
              },
            ],
            timestamp: 1,
          },
        },
      ],
    });

    expect(screen.getByText('+3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开写入内容 src\/spaced\.ts/ }));
    const lineContents = Array.from(container.querySelectorAll('[data-write-line-content]')).map(
      (node) => node.textContent,
    );
    expect(lineContents).toEqual(['  indented', '   ', 'last']);
    expect(screen.queryByText('+4')).not.toBeInTheDocument();
  });

  it('allows expanding purely blank write content', () => {
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
                name: 'write',
                arguments: { path: 'src/blank.txt', content: '   \n' },
              },
            ],
            timestamp: 1,
          },
        },
      ],
    });

    expect(screen.getByText('+1')).toBeInTheDocument();
    const expandButton = screen.getByRole('button', { name: /展开写入内容 src\/blank\.txt/ });
    expect(expandButton).not.toBeDisabled();

    fireEvent.click(expandButton);
    const lineContents = Array.from(container.querySelectorAll('[data-write-line-content]')).map(
      (node) => node.textContent,
    );
    expect(lineContents).toEqual(['   ']);
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

    fireEvent.click(screen.getByRole('button', { name: /展开过程 已处理/ }));
    expect(screen.getAllByText('写入失败 src/generated.ts').length).toBeGreaterThan(0);
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.queryByText('-0')).not.toBeInTheDocument();
    expect(screen.queryByText(/EACCES/)).not.toBeInTheDocument();
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开写入内容 src\/generated\.ts/ }));
    expect(screen.getByText(/EACCES: permission denied/)).toBeInTheDocument();
    expect(screen.getByText(/secret/)).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: /展开过程 已处理/ }));
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

    fireEvent.click(screen.getByRole('button', { name: /展开过程 已处理/ }));

    expect(screen.getAllByText('已运行 pnpm test').length).toBeGreaterThan(0);
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

    rerender(
      <ConversationView
        busyState={AGENT_BUSY_STATE}
        isStreaming={true}
        items={nextItems}
        toolExecutionsById={{}}
      />,
    );

    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'auto' });
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
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'auto' });
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

    expect(screen.getByRole('button', { name: /收起过程 正在处理/ })).toBeInTheDocument();
    expect(container.querySelector('[data-process-disclosure-icon]')).toBeNull();
    expect(screen.getByText('正在处理')).not.toHaveClass('scout-running-text-shimmer');
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

    expect(screen.getByRole('button', { name: /收起过程 正在处理/ })).toBeInTheDocument();
    expect(screen.getByText('正在搜索 hello')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开工具输出 grep/ }));
    expect(screen.getByText(/来自运行事实的部分输出/)).toBeInTheDocument();
  });

  it('renders pending tool calls before execution starts', () => {
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

    expect(screen.getByRole('button', { name: /收起过程 正在处理/ })).toBeInTheDocument();
    expect(screen.getByText('等待搜索 hello')).toBeInTheDocument();
  });

  it('renders edit previews with change counts and an expandable diff', () => {
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

    expect(screen.getByRole('button', { name: /收起过程 正在处理/ })).toBeInTheDocument();
    expect(screen.getByText('将编辑 src/app.ts')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开编辑差异 src\/app\.ts/ }));

    expect(screen.queryByText('Diff')).not.toBeInTheDocument();
    expect(screen.getAllByText('+1')).toHaveLength(1);
    expect(screen.getAllByText('-1')).toHaveLength(1);
    expect(screen.getByText('-2 old')).toBeInTheDocument();
    expect(screen.getByText('+2 new')).toBeInTheDocument();
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

    expect(screen.getByText('编辑预览失败 src/app.ts')).toBeInTheDocument();
    expect(screen.queryByText('编辑失败 src/app.ts')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开编辑差异 src\/app\.ts/ }));

    expect(screen.getByText('Could not find the exact text')).toBeInTheDocument();
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

    expect(screen.getByRole('button', { name: /收起过程 正在处理/ })).toBeInTheDocument();
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

    expect(screen.getByRole('button', { name: /展开过程 正在处理/ })).toBeInTheDocument();
    expect(screen.getByText('根据文件内容继续分析')).toBeInTheDocument();
    expect(screen.queryByText('先定位文件')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开过程 正在处理/ }));

    expect(screen.getByText('先定位文件')).toBeInTheDocument();
    expect(screen.getAllByText('已读取 README.md').length).toBeGreaterThan(0);
    expect(
      screen.getByText('先定位文件').closest('[data-assistant-process-phase]'),
    ).toHaveAttribute('data-assistant-process-phase', 'model_responding');
    expect(
      screen.getAllByText('已读取 README.md')[0].closest('[data-assistant-process-phase]'),
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

    expect(screen.getByRole('button', { name: /展开过程 已处理/ })).toBeInTheDocument();
    expect(screen.queryByText('运行失败 pnpm test')).not.toBeInTheDocument();
    expect(screen.queryByText('测试失败')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开过程 已处理/ }));
    expect(screen.getAllByText('运行失败 pnpm test').length).toBeGreaterThan(0);
    expect(screen.queryByText('测试失败')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开工具输出 bash/ }));
    expect(screen.getByText(/测试失败/)).toBeInTheDocument();
    expect(screen.getByText('× 失败')).toBeInTheDocument();
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

describe('buildConversationRows', () => {
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
      summary: { label: '正在思考' },
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
      summary: { label: '正在思考' },
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
              kind: 'file_edit',
              diff: '-1 old\n+1 final\n+2 extra',
              patch: '',
              firstChangedLine: 1,
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
      kind: 'file_edit',
      additions: 2,
      deletions: 1,
      detail: {
        kind: 'diff',
        diffText: '-1 old\n+1 final\n+2 extra',
      },
    });
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
