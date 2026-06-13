import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatApp } from '@/surfaces/chat/ChatApp';
import { useConversationStore } from '@/store/conversation-store';
import { useSessionStore } from '@/store/session-store';
import { useTaskStore } from '@/store/task-store';
import type { ScoutBusyState, ScoutMessage, ScoutWebviewState } from '@scout-agent/shared';

const postMessage = vi.fn();

function makeState(
  messages: ScoutMessage[],
  overrides: Partial<Pick<ScoutWebviewState, 'isStreaming' | 'busyState' | 'queueState'>> = {},
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
    sessionId: 'session-1',
    sessionName: '检查未提交更改',
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
    useConversationStore.getState().actions.reset();
    useSessionStore.getState().actions.reset();
    useTaskStore.getState().actions.reset();
  });

  it('renders the task home and sends composer text', () => {
    render(<ChatApp />);

    fireEvent.change(screen.getByLabelText('随心输入'), {
      target: { value: '中文回答' },
    });
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });

    expect(postMessage).toHaveBeenCalledWith({
      type: 'user_message',
      text: '中文回答',
      deliverAs: undefined,
    });
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
      taskId: 'task-1',
      sessionPath: '/sessions/session-1.jsonl',
      cwdOverride: undefined,
    });
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
    fireEvent.click(screen.getByRole('button', { name: /检查未提交更改/ }));

    expect(screen.getByText('任务')).toBeInTheDocument();
    expect(postMessage).not.toHaveBeenCalledWith({ type: 'clear_conversation' });
  });
});
