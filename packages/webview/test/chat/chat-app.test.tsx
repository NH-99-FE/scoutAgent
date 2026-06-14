import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeExtensionMessage } from '@/bridge/extension-message-router';
import { resetProtocolRequests } from '@/bridge/request-tracker';
import { ChatApp } from '@/surfaces/chat/ChatApp';
import { HOME_COMPOSER_SESSION_ID, useComposerStore } from '@/store/composer-store';
import { useConversationStore } from '@/store/conversation-store';
import { useSessionStore } from '@/store/session-store';
import { useTaskStore } from '@/store/task-store';
import { useUiStore } from '@/store/ui-store';
import type {
  ScoutBusyState,
  ScoutImageContent,
  ScoutMessage,
  ScoutWebviewState,
} from '@scout-agent/shared';

const postMessage = vi.fn();
const TEST_IMAGE: ScoutImageContent = {
  type: 'image',
  data: 'aW1hZ2U=',
  mimeType: 'image/png',
};

function makeState(
  messages: ScoutMessage[],
  overrides: Partial<
    Pick<
      ScoutWebviewState,
      'isStreaming' | 'busyState' | 'queueState' | 'sessionId' | 'sessionName' | 'sessionFile'
    >
  > = {},
): ScoutWebviewState {
  return {
    messages,
    isStreaming: overrides.isStreaming ?? false,
    busyState: overrides.busyState ?? ({ kind: 'idle', cancellable: false } as ScoutBusyState),
    queueState: overrides.queueState,
    modelProvider: 'openai',
    modelId: 'gpt-test',
    thinkingLevel: 'off',
    tools: [],
    activeToolNames: [],
    commands: [],
    sessionId: overrides.sessionId ?? 'session-1',
    sessionName: overrides.sessionName ?? '检查未提交更改',
    sessionFile: overrides.sessionFile,
    cwd: '/workspace',
  };
}

describe('ChatApp', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'acquireVsCodeApi', {
      configurable: true,
      value: () => ({
        getState: () => undefined,
        setState: () => undefined,
        postMessage,
      }),
    });
  });

  beforeEach(() => {
    postMessage.mockClear();
  });

  afterEach(() => {
    cleanup();
    useComposerStore.getState().actions.reset();
    useConversationStore.getState().actions.reset();
    useSessionStore.getState().actions.reset();
    useTaskStore.getState().actions.reset();
    useUiStore.getState().actions.reset();
    resetProtocolRequests();
  });

  it('renders the task home and starts a new session with composer text', () => {
    render(<ChatApp />);

    fireEvent.change(screen.getByLabelText('随心输入'), {
      target: { value: '中文回答' },
    });
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });

    expect(postMessage).toHaveBeenCalledWith({
      type: 'new_session_message',
      requestId: expect.any(String),
      text: '中文回答',
    });
    expect(screen.getByLabelText('随心输入')).toHaveValue('中文回答');
  });

  it('prevents duplicate new session submits while creation is pending', () => {
    render(<ChatApp />);

    fireEvent.change(screen.getByLabelText('随心输入'), {
      target: { value: '只创建一次' },
    });
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });

    const newSessionMessages = postMessage.mock.calls.filter(
      ([message]) => message.type === 'new_session_message',
    );
    expect(newSessionMessages).toHaveLength(1);
    expect(screen.getByRole('button', { name: '发送中' })).toBeDisabled();
  });

  it('starts a new session with composer images', () => {
    useComposerStore.getState().actions.addImages(HOME_COMPOSER_SESSION_ID, [TEST_IMAGE]);

    render(<ChatApp />);
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });

    expect(postMessage).toHaveBeenCalledWith({
      type: 'new_session_message',
      requestId: expect.any(String),
      text: '',
      images: [TEST_IMAGE],
    });
  });

  it('clears the home draft and shows the new session after creation succeeds', () => {
    render(<ChatApp />);

    fireEvent.change(screen.getByLabelText('随心输入'), {
      target: { value: '开始新的任务' },
    });
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });

    act(() => {
      routeExtensionMessage({
        type: 'state_update',
        state: makeState([], {
          sessionId: 'session-new',
          sessionName: '新会话',
          sessionFile: '/sessions/session-new.jsonl',
        }),
      });
      const newSessionMessage = postMessage.mock.calls.find(
        ([message]) => message.type === 'new_session_message',
      )?.[0] as { requestId: string };
      routeExtensionMessage({
        type: 'new_session_result',
        requestId: newSessionMessage.requestId,
        success: true,
      });
      routeExtensionMessage({
        type: 'agent_event',
        event: {
          type: 'message_start',
          messageId: 'session-new:message:1',
          message: { role: 'user', content: '开始新的任务', timestamp: 1 },
        },
      });
    });

    expect(screen.getByText('开始新的任务')).toBeInTheDocument();
    expect(screen.getByLabelText('要求后续变更')).toHaveValue('');
  });

  it('keeps the home draft when clicking new session on the task home', () => {
    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('随心输入'), {
      target: { value: '准备开始的新任务' },
    });
    postMessage.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '新会话' }));

    expect(screen.getByLabelText('随心输入')).toHaveValue('准备开始的新任务');
    expect(postMessage).not.toHaveBeenCalledWith({ type: 'clear_conversation' });
  });

  it('opens a task with the session path as operation target', () => {
    useTaskStore.getState().actions.setTasks({
      tasks: [
        {
          id: 'task-1',
          sessionId: 'session-1',
          sessionPath: '/sessions/session-1.jsonl',
          title: '检查未提交更改',
          createdAt: '2026-06-13T00:00:00.000Z',
        },
      ],
    });

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: /检查未提交更改/ }));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'open_task',
      requestId: expect.any(String),
      taskId: 'task-1',
      sessionPath: '/sessions/session-1.jsonl',
      cwdOverride: undefined,
    });
  });

  it('opens a task while a new session message is pending without applying stale creation results', () => {
    useTaskStore.getState().actions.setTasks({
      tasks: [
        {
          id: 'task-2',
          sessionId: 'session-2',
          sessionPath: '/sessions/session-2.jsonl',
          title: '会话二',
          createdAt: '2026-06-13T00:00:00.000Z',
        },
      ],
    });

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('随心输入'), {
      target: { value: '还在创建的新会话' },
    });
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });
    expect(screen.getByRole('button', { name: '发送中' })).toBeDisabled();

    const newSessionMessage = postMessage.mock.calls.find(
      ([message]) => message.type === 'new_session_message',
    )?.[0] as { requestId: string };

    fireEvent.click(screen.getByRole('button', { name: /会话二/ }));

    const openTaskMessage = postMessage.mock.calls.find(
      ([message]) => message.type === 'open_task',
    )?.[0] as { requestId: string };
    expect(openTaskMessage).toEqual({
      type: 'open_task',
      requestId: expect.any(String),
      taskId: 'task-2',
      sessionPath: '/sessions/session-2.jsonl',
      cwdOverride: undefined,
    });
    expect(screen.getByText('任务')).toBeInTheDocument();
    expect(screen.getByLabelText('随心输入')).toHaveValue('还在创建的新会话');
    expect(screen.queryByRole('button', { name: '发送中' })).not.toBeInTheDocument();

    act(() => {
      routeExtensionMessage({
        type: 'new_session_result',
        requestId: newSessionMessage.requestId,
        success: true,
      });
    });

    expect(screen.getByText('任务')).toBeInTheDocument();
    expect(screen.getByLabelText('随心输入')).toHaveValue('还在创建的新会话');

    act(() => {
      routeExtensionMessage({
        type: 'open_task_result',
        requestId: openTaskMessage.requestId,
        sessionPath: '/sessions/session-2.jsonl',
        success: true,
      });
      routeExtensionMessage({
        type: 'state_update',
        state: makeState([{ role: 'user', content: '任务里的消息', timestamp: 1 }], {
          sessionId: 'session-2',
          sessionName: '会话二',
          sessionFile: '/sessions/session-2.jsonl',
        }),
      });
    });

    expect(screen.getByText('任务里的消息')).toBeInTheDocument();
    expect(screen.getByLabelText('要求后续变更')).toHaveValue('');
  });

  it('expands the task list when viewing all tasks', () => {
    useTaskStore.getState().actions.setTasks({
      tasks: Array.from({ length: 4 }, (_, index) => ({
        id: `task-${index + 1}`,
        sessionId: `session-${index + 1}`,
        sessionPath: `/sessions/session-${index + 1}.jsonl`,
        title: `历史任务 ${index + 1}`,
        createdAt: '2026-06-13T00:00:00.000Z',
      })),
    });

    render(<ChatApp />);

    expect(screen.queryByText('历史任务 4')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));

    expect(screen.getByText('历史任务 4')).toBeInTheDocument();
    expect(postMessage).toHaveBeenCalledWith({ type: 'request_tasks', limit: 50 });
  });

  it('sends follow-up messages with Enter while streaming', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
    });
    useConversationStore.getState().actions.applyState(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '现在改方向' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Enter' });

    expect(postMessage).toHaveBeenCalledWith({
      type: 'user_message',
      text: '现在改方向',
      deliverAs: 'followUp',
    });
  });

  it('sends current session messages with composer images', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }]);
    useConversationStore.getState().actions.applyState(state);
    useSessionStore.getState().actions.applyState(state);
    useComposerStore.getState().actions.addImages('session-1', [TEST_IMAGE]);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '看这张图' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Enter' });

    expect(postMessage).toHaveBeenCalledWith({
      type: 'user_message',
      text: '看这张图',
      deliverAs: undefined,
      images: [TEST_IMAGE],
    });
  });

  it('sends steering messages with Ctrl Enter while streaming', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
    });
    useConversationStore.getState().actions.applyState(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '立刻引导' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), {
      key: 'Enter',
      ctrlKey: true,
    });

    expect(postMessage).toHaveBeenCalledWith({
      type: 'user_message',
      text: '立刻引导',
      deliverAs: 'steer',
    });
  });

  it('shows streaming send shortcuts when send button is active', async () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
    });
    useConversationStore.getState().actions.applyState(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '准备排队' },
    });
    fireEvent.focus(screen.getByRole('button', { name: '发送' }));

    expect((await screen.findAllByText('队列')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('引导').length).toBeGreaterThan(0);
  });

  it('confirms streaming abort with Escape', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
    });
    useConversationStore.getState().actions.applyState(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Escape' });
    expect(postMessage).not.toHaveBeenCalledWith({ type: 'abort' });
    expect(screen.getByRole('button', { name: '确认中断' })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Escape' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'abort' });
  });

  it('keeps composer drafts isolated by session id', () => {
    const sessionOne = makeState([{ role: 'user', content: 'one', timestamp: 1 }], {
      sessionId: 'session-1',
      sessionName: '会话一',
    });
    const sessionTwo = makeState([{ role: 'user', content: 'two', timestamp: 1 }], {
      sessionId: 'session-2',
      sessionName: '会话二',
    });
    useConversationStore.getState().actions.applyState(sessionOne);
    useSessionStore.getState().actions.applyState(sessionOne);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: 'session one draft' },
    });

    act(() => {
      useConversationStore.getState().actions.applyState(sessionTwo);
      useSessionStore.getState().actions.applyState(sessionTwo);
    });

    expect(screen.getByLabelText('要求后续变更')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: 'session two draft' },
    });

    act(() => {
      useConversationStore.getState().actions.applyState(sessionOne);
      useSessionStore.getState().actions.applyState(sessionOne);
    });

    expect(screen.getByLabelText('要求后续变更')).toHaveValue('session one draft');
  });

  it('does not reuse the conversation draft on the task home composer', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }]);
    useConversationStore.getState().actions.applyState(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: 'conversation draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: '返回' }));

    expect(screen.getByLabelText('随心输入')).toHaveValue('');
  });

  it('stays on the task home until the opened task state is current', () => {
    routeExtensionMessage({
      type: 'state_update',
      state: makeState([{ role: 'user', content: 'old conversation', timestamp: 1 }], {
        sessionId: 'session-1',
        sessionName: '会话一',
        sessionFile: '/sessions/session-1.jsonl',
      }),
    });
    useTaskStore.getState().actions.setTasks({
      tasks: [
        {
          id: 'task-2',
          sessionId: 'session-2',
          sessionPath: '/sessions/session-2.jsonl',
          title: '会话二',
          createdAt: '2026-06-13T00:00:00.000Z',
        },
      ],
    });

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: 'old draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    postMessage.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /会话二/ }));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'open_task',
      requestId: expect.any(String),
      taskId: 'task-2',
      sessionPath: '/sessions/session-2.jsonl',
      cwdOverride: undefined,
    });
    expect(screen.getByText('任务')).toBeInTheDocument();
    expect(screen.queryByText('old conversation')).not.toBeInTheDocument();
    expect(screen.getByLabelText('随心输入')).toHaveValue('');

    act(() => {
      routeExtensionMessage({
        type: 'state_update',
        state: makeState([{ role: 'user', content: 'new conversation', timestamp: 1 }], {
          sessionId: 'session-2',
          sessionName: '会话二',
          sessionFile: '/sessions/session-2.jsonl',
        }),
      });
    });

    expect(screen.getByText('new conversation')).toBeInTheDocument();
    expect(screen.getByLabelText('要求后续变更')).toHaveValue('');
  });

  it('aborts immediately when clicking the stop button', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
    });
    useConversationStore.getState().actions.applyState(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: '停止' }));

    expect(postMessage).toHaveBeenCalledWith({ type: 'abort' });
    expect(screen.queryByRole('button', { name: '确认中断' })).not.toBeInTheDocument();
  });

  it('shows queued follow-ups and exposes promote/delete actions', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      queueState: {
        paused: true,
        pauseReason: 'aborted',
        messages: [
          { id: 'follow-1', delivery: 'followUp', text: '先继续这个', timestamp: 2 },
          { id: 'follow-2', delivery: 'followUp', text: '再处理那个', timestamp: 3 },
        ],
        followUps: [
          { id: 'follow-1', text: '先继续这个', timestamp: 2 },
          { id: 'follow-2', text: '再处理那个', timestamp: 3 },
        ],
      },
    });
    useConversationStore.getState().actions.applyState(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);

    expect(screen.getByText('由于你中断了当前响应，队列已暂停')).toBeInTheDocument();
    expect(screen.getByText('先继续这个')).toBeInTheDocument();

    postMessage.mockClear();
    fireEvent.click(screen.getAllByRole('button', { name: '引导' })[0]);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'promote_follow_up',
      id: 'follow-1',
      resume: true,
      preserveFollowUpQueue: true,
    });

    fireEvent.click(screen.getAllByRole('button', { name: '删除跟进' })[1]);
    expect(postMessage).toHaveBeenCalledWith({ type: 'cancel_follow_up', id: 'follow-2' });
  });

  it('resumes the full paused follow-up queue from the queue header', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      queueState: {
        paused: true,
        pauseReason: 'aborted',
        messages: [{ id: 'follow-1', delivery: 'followUp', text: '继续排队', timestamp: 2 }],
        followUps: [{ id: 'follow-1', text: '继续排队', timestamp: 2 }],
      },
    });
    useConversationStore.getState().actions.applyState(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    postMessage.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '继续' }));

    expect(postMessage).toHaveBeenCalledWith({ type: 'continue_session' });
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ preserveFollowUpQueue: true }),
    );
  });

  it('confirms sending a new message while a paused follow-up queue exists', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      queueState: {
        paused: true,
        pauseReason: 'aborted',
        messages: Array.from({ length: 7 }, (_, index) => ({
          id: `follow-${index}`,
          delivery: 'followUp',
          text: `排队 ${index}`,
          timestamp: index,
        })),
        followUps: Array.from({ length: 7 }, (_, index) => ({
          id: `follow-${index}`,
          text: `排队 ${index}`,
          timestamp: index,
        })),
      },
    });
    useConversationStore.getState().actions.applyState(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '发送新的消息' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Enter' });

    expect(screen.getByText('发送消息？')).toBeInTheDocument();
    expect(screen.getByText(/之前已排队的 7 条消息/)).toBeInTheDocument();
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'user_message', text: '发送新的消息' }),
    );

    fireEvent.click(screen.getByRole('button', { name: '清空队列' }));
    expect(postMessage).toHaveBeenCalledWith({
      type: 'user_message',
      text: '发送新的消息',
      deliverAs: undefined,
      clearFollowUpQueue: true,
    });
  });

  it('sends a new message without clearing a paused follow-up queue', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      queueState: {
        paused: true,
        pauseReason: 'aborted',
        messages: [
          { id: 'follow-1', delivery: 'followUp', text: '保留这个', timestamp: 1 },
          { id: 'follow-2', delivery: 'followUp', text: '也保留这个', timestamp: 2 },
        ],
        followUps: [
          { id: 'follow-1', text: '保留这个', timestamp: 1 },
          { id: 'follow-2', text: '也保留这个', timestamp: 2 },
        ],
      },
    });
    useConversationStore.getState().actions.applyState(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '保留队列发送' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Enter' });
    postMessage.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'user_message',
      text: '保留队列发送',
      deliverAs: undefined,
    });
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ clearFollowUpQueue: true }),
    );
    expect(screen.getByLabelText('要求后续变更')).toHaveValue('');
  });

  it('keeps the draft and does not send when closing the paused queue dialog', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      queueState: {
        paused: true,
        pauseReason: 'aborted',
        messages: [{ id: 'follow-1', delivery: 'followUp', text: '等一下处理', timestamp: 1 }],
        followUps: [{ id: 'follow-1', text: '等一下处理', timestamp: 1 }],
      },
    });
    useConversationStore.getState().actions.applyState(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '先别发' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Enter' });
    expect(screen.getByText('发送消息？')).toBeInTheDocument();
    postMessage.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByText('发送消息？')).not.toBeInTheDocument();
    expect(screen.getByLabelText('要求后续变更')).toHaveValue('先别发');
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'user_message' }));
  });

  it('keeps the stop affordance while streaming even when cancellation is unavailable', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: false },
    });
    useConversationStore.getState().actions.applyState(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);

    expect(screen.getByRole('button', { name: '停止' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '发送' })).not.toBeInTheDocument();
  });

  it('switches from an active conversation back to the task home locally', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }]);
    useConversationStore.getState().actions.applyState(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    const title = screen.getByRole('heading', { name: '检查未提交更改' });
    expect(title).toHaveClass('truncate');
    expect(screen.queryByRole('button', { name: /检查未提交更改/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '返回' }));

    expect(screen.getByText('任务')).toBeInTheDocument();
    expect(postMessage).not.toHaveBeenCalledWith({ type: 'clear_conversation' });
  });

  it('opens the new session composer from the conversation header', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }]);
    useConversationStore.getState().actions.applyState(state);
    useSessionStore.getState().actions.applyState(state);
    useComposerStore.getState().actions.setText(HOME_COMPOSER_SESSION_ID, '旧首页草稿');

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: '新会话' }));

    expect(screen.getByText('任务')).toBeInTheDocument();
    expect(screen.getByLabelText('随心输入')).toHaveValue('');
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '发送中' })).not.toBeInTheDocument();
    expect(postMessage).not.toHaveBeenCalledWith({ type: 'clear_conversation' });
  });
});
