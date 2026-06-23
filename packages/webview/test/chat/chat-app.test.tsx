import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeExtensionMessage } from '@/bridge/extension-message-router';
import { projectTaskHistoryResult as routeTaskHistoryResponse } from '@/bridge/protocol-response-projector';
import { resetProtocolTransport } from '@/bridge/transport-client';
import { ChatApp } from '@/surfaces/chat/ChatApp';
import { useConfigStore } from '@/store/config-store';
import { HOME_COMPOSER_SESSION_ID, useComposerStore } from '@/store/composer-store';
import { useConversationStore } from '@/store/conversation-store';
import { useRuntimeOverlayStore } from '@/store/runtime-overlay-store';
import { useSessionStore } from '@/store/session-store';
import { useTaskStore } from '@/store/task-store';
import { useUiStore } from '@/store/ui-store';
import type {
  ScoutBusyState,
  ScoutCommandInfo,
  ScoutImageContent,
  ScoutMessage,
  ScoutProtocolResponsePayload,
  ScoutTaskItem,
  ScoutWebviewState,
  SourceInfo,
} from '@scout-agent/shared';

const postMessage = vi.fn();
const TEST_IMAGE: ScoutImageContent = {
  type: 'image',
  data: 'aW1hZ2U=',
  mimeType: 'image/png',
};
const TEST_SOURCE_INFO: SourceInfo = {
  path: '<test>',
  source: 'test',
  scope: 'temporary',
  origin: 'top-level',
};
const intersectionObservers: MockIntersectionObserver[] = [];

class MockIntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();
  readonly takeRecords = vi.fn(() => [] as IntersectionObserverEntry[]);
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.root = options?.root ?? null;
    this.rootMargin = options?.rootMargin ?? '';
    this.thresholds = Array.isArray(options?.threshold)
      ? options.threshold
      : [options?.threshold ?? 0];
    intersectionObservers.push(this);
  }

  trigger(isIntersecting = true): void {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function makeState(
  messages: ScoutMessage[],
  overrides: Partial<
    Pick<
      ScoutWebviewState,
      | 'isStreaming'
      | 'busyState'
      | 'queueState'
      | 'sessionId'
      | 'sessionName'
      | 'sessionFile'
      | 'modelProvider'
      | 'modelId'
      | 'thinkingLevel'
    >
  > = {},
): ScoutWebviewState {
  return {
    messages,
    isStreaming: overrides.isStreaming ?? false,
    busyState: overrides.busyState ?? ({ kind: 'idle', cancellable: false } as ScoutBusyState),
    queueState: overrides.queueState,
    modelProvider: overrides.modelProvider ?? 'openai',
    modelId: overrides.modelId ?? 'gpt-test',
    thinkingLevel: overrides.thinkingLevel ?? 'off',
    tools: [],
    activeToolNames: [],
    commands: [],
    sessionId: overrides.sessionId ?? 'session-1',
    sessionName: overrides.sessionName ?? '检查未提交更改',
    sessionFile: overrides.sessionFile,
    cwd: '/workspace',
  };
}

function getLatestSearchTaskMessage() {
  const messages = postMessage.mock.calls
    .map(([message]) => message)
    .filter(
      (message) =>
        message.type === 'protocol_request' && message.payload?.type === 'request_task_history',
    );
  return messages.at(-1) as
    | {
        type: 'protocol_request';
        payload: {
          type: 'request_task_history';
          query: string;
          limit?: number;
          offset?: number;
          purpose?: string;
        };
        requestId: string;
      }
    | undefined;
}

function routeTaskHistoryResult(
  queryToken: string,
  tasks: ScoutTaskItem[],
  overrides: Partial<{
    query: string;
    offset: number;
    hasMore: boolean;
    nextOffset: number;
  }> = {},
): void {
  routeTaskHistoryResponse(
    {
      type: 'task_history_result',
      query: overrides.query ?? '',
      purpose: 'panel',
      tasks,
      offset: overrides.offset ?? 0,
      hasMore: overrides.hasMore ?? false,
      nextOffset: overrides.nextOffset ?? tasks.length,
    },
    queryToken,
  );
}

function getPostedProtocolRequests(payloadType: string) {
  return postMessage.mock.calls
    .map(([message]) => message)
    .filter(
      (message) => message.type === 'protocol_request' && message.payload?.type === payloadType,
    ) as Array<{ requestId: string; payload: Record<string, unknown> }>;
}

function getLatestPostedProtocolRequest(payloadType: string) {
  return getPostedProtocolRequests(payloadType).at(-1);
}

function getPostedControlMessages(type: string) {
  return postMessage.mock.calls
    .map(([message]) => message)
    .filter((message) => message.type === type);
}

function expectPostedPayload(payloadType: string, payload: Record<string, unknown>): void {
  expect(getLatestPostedProtocolRequest(payloadType)?.payload).toEqual(payload);
}

function getHistoryQueryToken(): string | undefined {
  return useTaskStore.getState().historyQueryToken;
}

function routeProtocolResult(
  request: { requestId: string } | undefined,
  payload: ScoutProtocolResponsePayload,
): void {
  if (!request) return;
  routeExtensionMessage({
    type: 'protocol_response',
    requestId: request.requestId,
    payload,
  });
}

function routeProtocolError(
  request: { requestId: string } | undefined,
  message = 'Protocol failed',
): void {
  if (!request) return;
  routeExtensionMessage({
    type: 'protocol_response',
    requestId: request.requestId,
    error: { code: 'handler_failed', message },
  });
}

function makeCommand(
  name: string,
  source: ScoutCommandInfo['source'],
  description?: string,
): ScoutCommandInfo {
  return {
    name,
    description,
    source,
    sourceInfo: TEST_SOURCE_INFO,
  };
}

function routeCommands(commands: ScoutCommandInfo[]): void {
  act(() => {
    routeExtensionMessage({
      type: 'commands_update',
      commands,
    });
  });
}

function routeDetailState(overrides: Partial<ScoutWebviewState> = {}): void {
  act(() => {
    routeExtensionMessage({
      type: 'state_update',
      state: makeState([{ role: 'user', content: 'hello', timestamp: 1 }], overrides),
    });
  });
}

function typeComposerText(label: string, value: string): HTMLTextAreaElement {
  const textarea = screen.getByLabelText(label) as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value } });
  textarea.setSelectionRange(value.length, value.length);
  fireEvent.select(textarea);
  return textarea;
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
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      configurable: true,
      value: MockIntersectionObserver,
    });
  });

  beforeEach(() => {
    intersectionObservers.length = 0;
    postMessage.mockClear();
  });

  afterEach(() => {
    cleanup();
    useConfigStore.getState().actions.reset();
    useComposerStore.getState().actions.reset();
    useConversationStore.getState().actions.reset();
    useRuntimeOverlayStore.getState().actions.reset();
    useSessionStore.getState().actions.reset();
    useTaskStore.getState().actions.reset();
    useUiStore.getState().actions.reset();
    resetProtocolTransport();
  });

  it('renders the task home and starts a new session with composer text', () => {
    render(<ChatApp />);

    fireEvent.change(screen.getByLabelText('随心输入'), {
      target: { value: '中文回答' },
    });
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });

    expectPostedPayload('new_session_message', {
      type: 'new_session_message',
      text: '中文回答',
    });
    expect(screen.getByLabelText('随心输入')).toHaveValue('');
  });

  it('starts a new session from the task home send button', () => {
    render(<ChatApp />);

    fireEvent.change(screen.getByLabelText('随心输入'), {
      target: { value: '按钮发送' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expectPostedPayload('new_session_message', {
      type: 'new_session_message',
      text: '按钮发送',
    });
    expect(screen.getByLabelText('随心输入')).toHaveValue('');
  });

  it('opens settings actions from the header menu', () => {
    render(<ChatApp />);

    fireEvent.pointerDown(screen.getByRole('button', { name: '设置' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Scout 设置' }));

    expectPostedPayload('open_settings_panel', { type: 'open_settings_panel' });

    fireEvent.pointerDown(screen.getByRole('button', { name: '设置' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: '导入会话' }));

    expectPostedPayload('pick_import_session', { type: 'pick_import_session' });
    routeProtocolResult(getLatestPostedProtocolRequest('pick_import_session'), {
      type: 'import_session_result',
      success: false,
      error: 'cancelled',
    });
    expect(useUiStore.getState().notification).toBeUndefined();
  });

  it('shows extension notifications in the chat surface', async () => {
    routeDetailState();
    render(<ChatApp />);

    act(() => {
      routeExtensionMessage({
        type: 'notification',
        level: 'warning',
        message: '当前没有可压缩的上下文',
      });
    });

    expect(await screen.findByText('当前没有可压缩的上下文')).toBeInTheDocument();
    await waitFor(() => {
      expect(useUiStore.getState().notification).toBeUndefined();
    });
  });

  it('opens slash commands and filters them by the typed query', () => {
    routeCommands([
      makeCommand('settings', 'builtin', 'Open Scout settings'),
      makeCommand('compact', 'builtin', 'Manually compact the current session'),
      makeCommand('review', 'prompt', 'Review pending changes'),
      makeCommand('model', 'builtin', 'Change the active model'),
      makeCommand('continue', 'builtin', 'Continue the current response'),
    ]);
    render(<ChatApp />);

    typeComposerText('随心输入', '/');

    expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /压缩/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /review/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /settings/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /model/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /continue/ })).not.toBeInTheDocument();

    typeComposerText('随心输入', '/co');

    expect(screen.getByRole('option', { name: /压缩/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /settings/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /review/ })).not.toBeInTheDocument();
  });

  it('hides extension slash commands while the current session is streaming', () => {
    routeCommands([
      makeCommand('tree', 'builtin', 'Open the conversation tree'),
      makeCommand('deploy', 'extension', 'Run extension command'),
      makeCommand('review', 'prompt', 'Review pending changes'),
      makeCommand('docs', 'skill', 'Use docs skill'),
    ]);
    routeDetailState({ isStreaming: true });
    render(<ChatApp />);

    typeComposerText('要求后续变更', '/');

    expect(screen.getByRole('option', { name: /会话树/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /review/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /docs/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /deploy/ })).not.toBeInTheDocument();
  });

  it('selects slash commands with the keyboard without sending the message', () => {
    routeCommands([
      makeCommand('tree', 'builtin', 'Open the conversation tree'),
      makeCommand('review', 'prompt', 'Review pending changes'),
    ]);
    render(<ChatApp />);
    const textarea = typeComposerText('随心输入', '/');

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(textarea).toHaveValue('/review ');
    expect(getPostedProtocolRequests('new_session_message')).toHaveLength(0);
  });

  it('selects slash commands with pointer activation', () => {
    routeCommands([makeCommand('review', 'prompt', 'Review pending changes')]);
    render(<ChatApp />);
    const textarea = typeComposerText('随心输入', '/');

    const option = screen.getByRole('option', { name: /review/ });
    fireEvent.mouseDown(option);
    fireEvent.click(option);

    expect(textarea).toHaveValue('/review ');
    expect(getPostedProtocolRequests('new_session_message')).toHaveLength(0);
  });

  it('does not handle tab while slash commands are open', () => {
    routeCommands([makeCommand('tree', 'builtin', 'Open the conversation tree')]);
    render(<ChatApp />);
    const textarea = typeComposerText('随心输入', '/');

    fireEvent.keyDown(textarea, { key: 'Tab' });

    expect(textarea).toHaveValue('/');
    expect(getPostedProtocolRequests('open_tree_panel')).toHaveLength(0);
  });

  it('resets slash command highlight to the first item when reopening from input', () => {
    routeCommands([
      makeCommand('tree', 'builtin', 'Open the conversation tree'),
      makeCommand('compact', 'builtin', 'Manually compact the current session'),
    ]);
    render(<ChatApp />);
    const textarea = typeComposerText('随心输入', '/');

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /压缩/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    typeComposerText('随心输入', '');
    typeComposerText('随心输入', '/');

    expect(screen.getByRole('option', { name: /会话树/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('executes supported builtin slash commands and clears the slash token', () => {
    routeCommands([
      makeCommand('tree', 'builtin', 'Open the conversation tree'),
      makeCommand('compact', 'builtin', 'Manually compact the current session'),
    ]);
    routeDetailState();
    render(<ChatApp />);

    let textarea = typeComposerText('要求后续变更', '/tree');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expectPostedPayload('open_tree_panel', { type: 'open_tree_panel' });
    expect(textarea).toHaveValue('');

    textarea = typeComposerText('要求后续变更', '/compact');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expectPostedPayload('compact', { type: 'compact', customInstructions: undefined });
    expect(textarea).toHaveValue('');

  });

  it('closes slash commands for arguments and escape while respecting composing input', () => {
    routeCommands([makeCommand('review', 'prompt', 'Review pending changes')]);
    render(<ChatApp />);
    typeComposerText('随心输入', '/review ');

    expect(screen.queryByRole('listbox', { name: 'Slash commands' })).not.toBeInTheDocument();

    let textarea = typeComposerText('随心输入', '/');
    expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
    fireEvent.keyDown(textarea, { key: 'Escape' });
    fireEvent.keyUp(textarea, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Slash commands' })).not.toBeInTheDocument();

    textarea = typeComposerText('随心输入', '/');
    fireEvent.keyDown(textarea, { key: 'Process' });
    expect(textarea).toHaveValue('/');
    expect(getPostedProtocolRequests('new_session_message')).toHaveLength(0);
  });

  it('prevents duplicate new session submits while creation is pending', () => {
    render(<ChatApp />);

    fireEvent.change(screen.getByLabelText('随心输入'), {
      target: { value: '只创建一次' },
    });
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });

    const newSessionMessages = getPostedProtocolRequests('new_session_message');
    expect(newSessionMessages).toHaveLength(1);
    expect(screen.getByRole('button', { name: '发送中' })).toBeDisabled();
  });

  it('clears new session pending state when the protocol request fails', () => {
    render(<ChatApp />);

    fireEvent.change(screen.getByLabelText('随心输入'), {
      target: { value: '会失败的新会话' },
    });
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });
    const newSessionMessage = getLatestPostedProtocolRequest('new_session_message');
    expect(screen.getByLabelText('随心输入')).toHaveValue('');

    act(() => {
      routeProtocolError(newSessionMessage, 'new session failed');
    });

    expect(useUiStore.getState().newSessionPending).toBe(false);
    expect(useUiStore.getState().chatView).toBe('home');
    expect(screen.getByLabelText('随心输入')).toHaveValue('会失败的新会话');
    expect(screen.queryByRole('button', { name: '发送中' })).not.toBeInTheDocument();
  });

  it('starts a new session with composer images', () => {
    useComposerStore.getState().actions.addImages(HOME_COMPOSER_SESSION_ID, [TEST_IMAGE]);

    render(<ChatApp />);
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });

    expectPostedPayload('new_session_message', {
      type: 'new_session_message',
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
      const newSessionMessage = getLatestPostedProtocolRequest('new_session_message');
      routeProtocolResult(newSessionMessage, {
        type: 'new_session_result',
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
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '检查未提交更改',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: /检查未提交更改/ }));

    expectPostedPayload('open_task', {
      type: 'open_task',
      taskId: 'task-1',
      sessionPath: '/sessions/session-1.jsonl',
      cwdOverride: undefined,
    });
  });

  it('clears open task pending state when the protocol request fails', () => {
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '检查未提交更改',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: /检查未提交更改/ }));
    const openTaskMessage = getLatestPostedProtocolRequest('open_task');

    act(() => {
      routeProtocolError(openTaskMessage, 'open task failed');
    });

    expect(useUiStore.getState().openingTaskSessionPath).toBeUndefined();
    expect(useUiStore.getState().chatView).toBe('home');
  });

  it('opens a task while a new session message is pending without applying stale creation results', () => {
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-2',
        sessionId: 'session-2',
        sessionPath: '/sessions/session-2.jsonl',
        title: '会话二',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('随心输入'), {
      target: { value: '还在创建的新会话' },
    });
    fireEvent.keyDown(screen.getByLabelText('随心输入'), { key: 'Enter' });
    expect(screen.getByRole('button', { name: '发送中' })).toBeDisabled();

    const newSessionMessage = getLatestPostedProtocolRequest('new_session_message');

    fireEvent.click(screen.getByRole('button', { name: /会话二/ }));

    const openTaskMessage = getLatestPostedProtocolRequest('open_task');
    expect(openTaskMessage?.payload).toEqual({
      type: 'open_task',
      taskId: 'task-2',
      sessionPath: '/sessions/session-2.jsonl',
      cwdOverride: undefined,
    });
    expect(screen.getByText('任务')).toBeInTheDocument();
    expect(screen.getByLabelText('随心输入')).toHaveValue('还在创建的新会话');
    expect(screen.queryByRole('button', { name: '发送中' })).not.toBeInTheDocument();

    act(() => {
      routeProtocolResult(newSessionMessage, {
        type: 'new_session_result',
        success: true,
      });
    });

    expect(screen.getByText('任务')).toBeInTheDocument();
    expect(screen.getByLabelText('随心输入')).toHaveValue('还在创建的新会话');

    act(() => {
      routeProtocolResult(openTaskMessage, {
        type: 'open_task_result',
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
    useTaskStore.getState().actions.setRecentTasks(
      Array.from({ length: 4 }, (_, index) => ({
        id: `task-${index + 1}`,
        sessionId: `session-${index + 1}`,
        sessionPath: `/sessions/session-${index + 1}.jsonl`,
        title: `历史任务 ${index + 1}`,
        createdAt: '2026-06-13T00:00:00.000Z',
      })),
    );

    render(<ChatApp />);

    expect(screen.queryByText('历史任务 4')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));

    expect(screen.getByText('历史任务 4')).toBeInTheDocument();
    expect(screen.getByLabelText('搜索历史任务')).toBeInTheDocument();
    expect(screen.queryByText('本地任务')).not.toBeInTheDocument();
    expectPostedPayload('request_task_history', {
      type: 'request_task_history',
      query: '',
      purpose: 'panel',
      limit: 20,
      offset: 0,
    });
  });

  it('opens and closes task history from the home header action', async () => {
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '检查未提交更改',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: '历史任务' }));

    expect(screen.getByLabelText('搜索历史任务')).toBeInTheDocument();
    expectPostedPayload('request_task_history', {
      type: 'request_task_history',
      query: '',
      purpose: 'panel',
      limit: 20,
      offset: 0,
    });

    fireEvent.click(screen.getByRole('button', { name: '历史任务' }));
    await waitFor(() => {
      expect(screen.queryByLabelText('搜索历史任务')).not.toBeInTheDocument();
    });
  });

  it('does not mark the current detail session in the home task history panel', () => {
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '检查未提交更改',
        createdAt: '2026-06-13T00:00:00.000Z',
        isCurrent: true,
      },
      {
        id: 'task-2',
        sessionId: 'session-2',
        sessionPath: '/sessions/session-2.jsonl',
        title: '另一个历史任务',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: '历史任务' }));

    expect(screen.getByRole('button', { name: /检查未提交更改/ })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('opens task history from the conversation header action', async () => {
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '检查未提交更改',
        createdAt: '2026-06-13T00:00:00.000Z',
        isCurrent: true,
      },
      {
        id: 'task-2',
        sessionId: 'session-2',
        sessionPath: '/sessions/session-2.jsonl',
        title: '另一个历史任务',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);
    useConversationStore
      .getState()
      .actions.applyStateSnapshot(makeState([{ role: 'user', content: 'hello', timestamp: 1 }]));
    useSessionStore
      .getState()
      .actions.applyState(makeState([{ role: 'user', content: 'hello', timestamp: 1 }]));

    render(<ChatApp />);
    expect(screen.queryByRole('button', { name: '继续会话' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '历史任务' }));

    expect(screen.getByLabelText('搜索历史任务')).toBeInTheDocument();
    expectPostedPayload('request_task_history', {
      type: 'request_task_history',
      query: '',
      purpose: 'panel',
      limit: 20,
      offset: 0,
    });

    fireEvent.click(screen.getByRole('button', { name: '历史任务' }));
    await waitFor(() => {
      expect(screen.queryByLabelText('搜索历史任务')).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: '历史任务' }));
    postMessage.mockClear();

    const currentTask = screen.getByRole('button', { name: /检查未提交更改/ });
    expect(currentTask).toHaveAttribute('aria-current', 'page');
    expect(currentTask).not.toBeDisabled();
    fireEvent.click(currentTask);
    await waitFor(() => {
      expect(screen.queryByLabelText('搜索历史任务')).not.toBeInTheDocument();
    });
    expect(getPostedProtocolRequests('open_task')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '历史任务' }));
    postMessage.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /另一个历史任务/ }));

    await waitFor(() => {
      expect(screen.queryByLabelText('搜索历史任务')).not.toBeInTheDocument();
    });
    expectPostedPayload('open_task', {
      type: 'open_task',
      taskId: 'task-2',
      sessionPath: '/sessions/session-2.jsonl',
      cwdOverride: undefined,
    });
  });

  it('collapses the expanded task panel when clicking outside it', async () => {
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '检查未提交更改',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));
    expect(screen.getByLabelText('搜索历史任务')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /收起/ })).not.toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(screen.queryByLabelText('搜索历史任务')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /查看全部/ })).toBeInTheDocument();
    });
  });

  it('requests backend task search from the expanded task panel', () => {
    vi.useFakeTimers();
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '检查未提交更改',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
      {
        id: 'task-2',
        sessionId: 'session-2',
        sessionPath: '/sessions/session-2.jsonl',
        title: '修复 ChatComposer effect 报错',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));
    postMessage.mockClear();

    fireEvent.change(screen.getByLabelText('搜索历史任务'), {
      target: { value: 'ChatComposer' },
    });

    expect(postMessage).not.toHaveBeenCalled();
    expect(screen.getByLabelText('搜索历史任务')).toHaveValue('ChatComposer');
    expect(screen.getByText('检查未提交更改')).toBeInTheDocument();
    expect(screen.getByText('修复 ChatComposer effect 报错')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    const searchMessage = getLatestSearchTaskMessage();
    expect(searchMessage?.payload).toEqual({
      type: 'request_task_history',
      query: 'ChatComposer',
      purpose: 'panel',
      limit: 20,
      offset: 0,
    });
    expect(postMessage.mock.calls.some(([message]) => message.type === 'protocol_cancel')).toBe(
      true,
    );

    vi.useRealTimers();
  });

  it('ignores stale task history results for an older request', () => {
    vi.useFakeTimers();
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '检查未提交更改',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));
    const initialQueryToken = getHistoryQueryToken();
    postMessage.mockClear();

    fireEvent.change(screen.getByLabelText('搜索历史任务'), {
      target: { value: '第二次' },
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    const currentQueryToken = getHistoryQueryToken();

    act(() => {
      routeTaskHistoryResult(
        initialQueryToken ?? 'stale',
        [
          {
            id: 'task-1',
            sessionId: 'session-1',
            sessionPath: '/sessions/session-1.jsonl',
            title: '第一次搜索结果',
            createdAt: '2026-06-13T00:00:00.000Z',
          },
        ],
        { query: '', offset: 0, nextOffset: 1 },
      );
    });

    expect(screen.queryByText('第一次搜索结果')).not.toBeInTheDocument();

    act(() => {
      routeTaskHistoryResult(
        currentQueryToken ?? 'current',
        [
          {
            id: 'task-2',
            sessionId: 'session-2',
            sessionPath: '/sessions/session-2.jsonl',
            title: '第二次搜索结果',
            createdAt: '2026-06-13T00:00:00.000Z',
          },
        ],
        { query: '第二次', offset: 0, nextOffset: 1 },
      );
    });

    expect(screen.getByText('第二次搜索结果')).toBeInTheDocument();
    expect(screen.queryByText('第一次搜索结果')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('keeps task history separate from recent task updates while searching', () => {
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '初始任务',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));
    const historyQueryToken = getHistoryQueryToken();
    fireEvent.change(screen.getByLabelText('搜索历史任务'), {
      target: { value: '目标' },
    });

    act(() => {
      routeExtensionMessage({
        type: 'task_history_update',
        query: '',
        purpose: 'recent',
        tasks: [
          {
            id: 'task-old',
            sessionId: 'session-old',
            sessionPath: '/sessions/session-old.jsonl',
            title: '旧的全量结果',
            createdAt: '2026-06-13T00:00:00.000Z',
          },
        ],
        offset: 0,
        hasMore: false,
        nextOffset: 1,
      });
      routeTaskHistoryResult(historyQueryToken ?? 'history', [
        {
          id: 'task-new',
          sessionId: 'session-new',
          sessionPath: '/sessions/session-new.jsonl',
          title: '目标搜索结果',
          createdAt: '2026-06-13T00:00:00.000Z',
        },
      ]);
    });

    expect(screen.getByText('目标搜索结果')).toBeInTheDocument();
    expect(screen.queryByText('旧的全量结果')).not.toBeInTheDocument();
  });

  it('loads the next task history page when the sentinel intersects', async () => {
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-1',
        sessionId: 'session-1',
        sessionPath: '/sessions/session-1.jsonl',
        title: '第一页任务',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: /查看全部/ }));
    const initialQueryToken = getHistoryQueryToken();

    act(() => {
      routeTaskHistoryResult(
        initialQueryToken ?? 'history-1',
        [
          {
            id: 'task-1',
            sessionId: 'session-1',
            sessionPath: '/sessions/session-1.jsonl',
            title: '第一页任务',
            createdAt: '2026-06-13T00:00:00.000Z',
          },
        ],
        { hasMore: true, nextOffset: 20 },
      );
    });

    await waitFor(() => {
      expect(intersectionObservers.length).toBeGreaterThan(0);
    });

    postMessage.mockClear();
    act(() => {
      intersectionObservers.at(-1)?.trigger();
    });

    const nextSearch = getLatestSearchTaskMessage();
    const nextQueryToken = getHistoryQueryToken();
    expect(nextSearch?.payload).toEqual({
      type: 'request_task_history',
      query: '',
      purpose: 'panel',
      limit: 20,
      offset: 20,
    });

    act(() => {
      routeTaskHistoryResult(
        nextQueryToken ?? 'history-2',
        [
          {
            id: 'task-2',
            sessionId: 'session-2',
            sessionPath: '/sessions/session-2.jsonl',
            title: '第二页任务',
            createdAt: '2026-06-13T00:00:00.000Z',
          },
        ],
        { offset: 20, hasMore: false, nextOffset: 21 },
      );
    });

    expect(screen.getByText('第一页任务')).toBeInTheDocument();
    expect(screen.getByText('第二页任务')).toBeInTheDocument();
  });

  it('sends follow-up messages with Enter while streaming', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
    });
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '现在改方向' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Enter' });

    expectPostedPayload('user_message', {
      type: 'user_message',
      text: '现在改方向',
      deliverAs: 'followUp',
    });
  });

  it('shows retry runtime status inline in the conversation', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      isStreaming: true,
      busyState: {
        kind: 'retry',
        label: 'Retrying',
        cancellable: true,
        attempt: 2,
        maxAttempts: 3,
        reason: 'rate limit',
      },
    });
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);

    expect(screen.getByText('正在重试 2/3')).toBeInTheDocument();
    expect(screen.getByText('rate limit')).toBeInTheDocument();
  });

  it('does not surface internal agent busy labels in the header loading action', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }], {
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
    });
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);

    expect(screen.getByRole('button', { name: '正在回复' })).toBeInTheDocument();
    expect(screen.queryByText('Working')).not.toBeInTheDocument();
  });

  it('projects runtime state updates to the header and conversation body', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }]);
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    expect(screen.queryByRole('button', { name: '正在回复' })).not.toBeInTheDocument();

    act(() => {
      routeExtensionMessage({
        type: 'runtime_state_update',
        isStreaming: true,
        busyState: { kind: 'agent', label: 'Working', cancellable: true },
      });
    });
    expect(screen.getByRole('button', { name: '正在回复' })).toBeInTheDocument();
    expect(screen.queryByText('Working')).not.toBeInTheDocument();

    act(() => {
      routeExtensionMessage({
        type: 'runtime_state_update',
        isStreaming: true,
        busyState: {
          kind: 'retry',
          label: 'Retrying',
          cancellable: true,
          attempt: 2,
          maxAttempts: 3,
          reason: 'rate limit',
        },
      });
    });
    expect(screen.getByText('正在重试 2/3')).toBeInTheDocument();
    expect(screen.getByText('rate limit')).toBeInTheDocument();

    act(() => {
      routeExtensionMessage({
        type: 'runtime_state_update',
        isStreaming: true,
        busyState: {
          kind: 'compaction',
          label: 'Compacting',
          cancellable: true,
          reason: 'overflow',
        },
      });
    });
    expect(screen.getByText('正在压缩上下文')).toBeInTheDocument();
    expect(screen.queryByText('上下文溢出恢复')).not.toBeInTheDocument();

    act(() => {
      routeExtensionMessage({
        type: 'runtime_state_update',
        isStreaming: false,
        busyState: { kind: 'idle', cancellable: false },
      });
    });
    expect(screen.queryByText('正在压缩上下文')).not.toBeInTheDocument();
  });

  it('sends current session messages with composer images', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }]);
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);
    useComposerStore.getState().actions.addImages('session-1', [TEST_IMAGE]);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '看这张图' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Enter' });

    expectPostedPayload('user_message', {
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
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '立刻引导' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), {
      key: 'Enter',
      ctrlKey: true,
    });

    expectPostedPayload('user_message', {
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
    useConversationStore.getState().actions.applyStateSnapshot(state);
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
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Escape' });
    expect(getPostedProtocolRequests('abort')).toHaveLength(0);
    expect(getPostedControlMessages('control_abort')).toHaveLength(0);
    expect(screen.getByRole('button', { name: '确认中断' })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Escape' });
    expect(getPostedControlMessages('control_abort')).toEqual([{ type: 'control_abort' }]);
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
    useConversationStore.getState().actions.applyStateSnapshot(sessionOne);
    useSessionStore.getState().actions.applyState(sessionOne);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: 'session one draft' },
    });

    act(() => {
      useConversationStore.getState().actions.applyStateSnapshot(sessionTwo);
      useSessionStore.getState().actions.applyState(sessionTwo);
    });

    expect(screen.getByLabelText('要求后续变更')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: 'session two draft' },
    });

    act(() => {
      useConversationStore.getState().actions.applyStateSnapshot(sessionOne);
      useSessionStore.getState().actions.applyState(sessionOne);
    });

    expect(screen.getByLabelText('要求后续变更')).toHaveValue('session one draft');
  });

  it('does not reuse the conversation draft on the task home composer', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }]);
    useConversationStore.getState().actions.applyStateSnapshot(state);
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
    useTaskStore.getState().actions.setRecentTasks([
      {
        id: 'task-2',
        sessionId: 'session-2',
        sessionPath: '/sessions/session-2.jsonl',
        title: '会话二',
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    ]);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: 'old draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    postMessage.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /会话二/ }));

    expectPostedPayload('open_task', {
      type: 'open_task',
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
    const state = makeState(
      [
        { role: 'user', content: 'hello', timestamp: 1 },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'partial answer' }],
          timestamp: 2,
          entryId: 'assistant-1',
        },
      ],
      {
        isStreaming: true,
        busyState: { kind: 'agent', label: 'Working', cancellable: true },
      },
    );
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    expect(screen.getByText('partial answer')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '停止' }));

    expect(getPostedControlMessages('control_abort')).toEqual([{ type: 'control_abort' }]);
    expect(screen.queryByRole('button', { name: '确认中断' })).not.toBeInTheDocument();

    act(() => {
      routeExtensionMessage({
        type: 'agent_event',
        event: {
          type: 'message_update',
          messageId: 'assistant-1',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'partial answer stale queued text' }],
            timestamp: 2,
          },
        },
      });
    });

    expect(screen.getByText('partial answer')).toBeInTheDocument();
    expect(screen.queryByText('partial answer stale queued text')).not.toBeInTheDocument();
  });

  it('shows provider abort errors as a conversation row after the assistant turn', () => {
    const state = makeState([
      { role: 'user', content: 'hello', timestamp: 1 },
      {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'working' }],
        stopReason: 'aborted',
        errorMessage: 'Request was aborted',
        timestamp: 2,
      },
    ]);
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    const { container } = render(<ChatApp />);

    const notice = container.querySelector('[data-manual-abort-notice="true"]');
    const assistantText = screen.getByText('working');
    expect(screen.getByText('你停止了会话')).toBeInTheDocument();
    expect(screen.queryByText('Request was aborted')).not.toBeInTheDocument();
    expect(notice).toHaveClass('justify-end', 'border-b');
    expect(notice?.querySelector('span')).toHaveClass('text-muted-foreground');
    expect(
      assistantText.compareDocumentPosition(notice as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('does not re-enable stop while an aborted run is settling', () => {
    const messages: ScoutMessage[] = [
      { role: 'user', content: 'hello', timestamp: 1 },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'partial answer' }],
        timestamp: 2,
        entryId: 'assistant-1',
      },
    ];
    const state = makeState(messages, {
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
    });
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: '停止' }));

    act(() => {
      routeExtensionMessage({
        type: 'runtime_state_update',
        isStreaming: false,
        busyState: { kind: 'idle', cancellable: false },
      });
    });
    expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument();

    act(() => {
      routeExtensionMessage({
        type: 'state_update',
        state: makeState(messages, {
          isStreaming: true,
          busyState: { kind: 'agent', label: 'Working', cancellable: true },
        }),
      });
    });

    expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument();
  });

  it('keeps immediate post-abort submits in the follow-up channel until runtime idle', () => {
    const messages: ScoutMessage[] = [
      { role: 'user', content: 'hello', timestamp: 1 },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'partial answer' }],
        timestamp: 2,
        entryId: 'assistant-1',
      },
    ];
    const state = makeState(messages, {
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
    });
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    postMessage.mockClear();

    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '马上继续提问' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Enter' });

    expectPostedPayload('user_message', {
      type: 'user_message',
      text: '马上继续提问',
      deliverAs: 'followUp',
    });
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
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);

    expect(screen.getByText('由于你中断了当前响应，队列已暂停')).toBeInTheDocument();
    expect(screen.getByText('先继续这个')).toBeInTheDocument();

    postMessage.mockClear();
    fireEvent.click(screen.getAllByRole('button', { name: '引导' })[0]);
    expectPostedPayload('promote_follow_up', {
      type: 'promote_follow_up',
      id: 'follow-1',
      resume: true,
      preserveFollowUpQueue: true,
    });

    fireEvent.click(screen.getAllByRole('button', { name: '删除跟进' })[1]);
    expectPostedPayload('cancel_follow_up', { type: 'cancel_follow_up', id: 'follow-2' });
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
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    postMessage.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '继续' }));

    expectPostedPayload('continue_session', { type: 'continue_session' });
    expect(getLatestPostedProtocolRequest('continue_session')?.payload).not.toEqual(
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
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '发送新的消息' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Enter' });

    expect(screen.getByText('发送消息？')).toBeInTheDocument();
    expect(screen.getByText(/之前已排队的 7 条消息/)).toBeInTheDocument();
    expect(getPostedProtocolRequests('user_message')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '清空队列' }));
    expectPostedPayload('user_message', {
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
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);
    fireEvent.change(screen.getByLabelText('要求后续变更'), {
      target: { value: '保留队列发送' },
    });
    fireEvent.keyDown(screen.getByLabelText('要求后续变更'), { key: 'Enter' });
    postMessage.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    expectPostedPayload('user_message', {
      type: 'user_message',
      text: '保留队列发送',
      deliverAs: undefined,
    });
    expect(getLatestPostedProtocolRequest('user_message')?.payload).not.toEqual(
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
    useConversationStore.getState().actions.applyStateSnapshot(state);
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
    useConversationStore.getState().actions.applyStateSnapshot(state);
    useSessionStore.getState().actions.applyState(state);

    render(<ChatApp />);

    expect(screen.getByRole('button', { name: '停止' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '发送' })).not.toBeInTheDocument();
  });

  it('switches from an active conversation back to the task home locally', () => {
    const state = makeState([{ role: 'user', content: 'hello', timestamp: 1 }]);
    useConversationStore.getState().actions.applyStateSnapshot(state);
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
    useConversationStore.getState().actions.applyStateSnapshot(state);
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
