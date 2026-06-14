import { describe, expect, it, vi } from 'vitest';
import { ScoutController } from '../src/scout-controller.ts';
import * as vscode from 'vscode';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function flushPromises(count = 5): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

function makeOutputChannel() {
  return {
    name: 'scout-test',
    append: vi.fn(),
    appendLine: vi.fn(),
    replace: vi.fn(),
    clear: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  };
}

function makeWebview() {
  return {
    onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
    postMessage: vi.fn(),
  };
}

function makeController(): ScoutController {
  return new ScoutController({
    extensionUri: vscode.Uri.file('/ext'),
    outputChannel: makeOutputChannel() as never,
    cwd: '/workspace',
  });
}

describe('ScoutController webview surfaces', () => {
  it('broadcasts extension messages to every bound webview surface', () => {
    const controller = makeController();
    const chat = makeWebview();
    const tree = makeWebview();
    const settings = makeWebview();

    controller.bindWebview(chat as never, 'chat');
    controller.bindWebview(tree as never, 'tree');
    controller.bindWebview(settings as never, 'settings');

    controller.handleWebviewMessage({ type: 'request_config' }, 'chat');

    expect(chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'config_update' }),
    );
    expect(tree.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'config_update' }),
    );
    expect(settings.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'config_update' }),
    );

    controller.dispose();
  });

  it('stops broadcasting to a webview after its binding is disposed', () => {
    const controller = makeController();
    const chat = makeWebview();
    const tree = makeWebview();
    const treeMessageDisposable = { dispose: vi.fn() };
    tree.onDidReceiveMessage.mockReturnValue(treeMessageDisposable);

    controller.bindWebview(chat as never, 'chat');
    const treeBinding = controller.bindWebview(tree as never, 'tree');

    treeBinding.dispose();
    controller.handleWebviewMessage({ type: 'request_config' }, 'chat');

    expect(chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'config_update' }),
    );
    expect(tree.postMessage).not.toHaveBeenCalled();
    expect(treeMessageDisposable.dispose).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it('lists recent tasks and paged task history from the current workspace scope', async () => {
    const controller = makeController();
    const chat = makeWebview();
    const listSessions = vi.fn(async () =>
      Array.from({ length: 45 }, (_, index) => ({
        id: `session-${index + 1}`,
        path: `/workspace/.scout/sessions/session-${index + 1}.jsonl`,
        cwd: '/workspace',
        createdAt: '2026-01-01T00:00:00.000Z',
        modifiedAt: '2026-01-01T00:00:00.000Z',
        name: `当前路径任务 ${index + 1}`,
        firstMessage: 'hello',
        allMessagesText: `hello body ${index + 1}`,
        messageCount: 1,
      })),
    );
    (controller as unknown as { sessionManager: unknown }).sessionManager = {
      listSessions,
      sessionFile: '/workspace/.scout/sessions/current.jsonl',
      disposeAsync: vi.fn(async () => undefined),
    };

    controller.bindWebview(chat as never, 'chat');
    controller.handleWebviewMessage({
      type: 'request_task_history',
      query: '',
      requestId: 'recent-1',
      limit: 3,
      offset: 0,
      purpose: 'recent',
    });
    await flushPromises();
    controller.handleWebviewMessage({
      type: 'request_task_history',
      query: '',
      requestId: 'history-1',
      offset: 20,
      purpose: 'panel',
    });
    await flushPromises();

    expect(listSessions.mock.calls[0]).toEqual([]);
    expect(listSessions.mock.calls[1]).toEqual([]);
    const taskHistoryMessages = chat.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === 'task_history_data') as Array<{
      requestId: string;
      purpose?: string;
      tasks: Array<{ sessionId: string }>;
      offset: number;
      hasMore: boolean;
      nextOffset: number;
    }>;
    const tasksMessage = taskHistoryMessages.find((message) => message.purpose === 'recent');
    const historyMessage = taskHistoryMessages.find((message) => message.purpose === 'panel');

    expect(tasksMessage?.requestId).toBe('recent-1');
    expect(tasksMessage?.tasks).toHaveLength(3);
    expect(historyMessage?.requestId).toBe('history-1');
    expect(historyMessage?.tasks).toHaveLength(20);
    expect(historyMessage?.tasks[0]?.sessionId).toBe('session-21');
    expect(historyMessage?.offset).toBe(20);
    expect(historyMessage?.hasMore).toBe(true);
    expect(historyMessage?.nextOffset).toBe(40);

    controller.dispose();
  });

  it('searches task history against displayed task titles only', async () => {
    const controller = makeController();
    const chat = makeWebview();
    const listSessions = vi.fn(async () => [
      {
        id: 'session-1',
        path: '/workspace/.scout/sessions/session-1.jsonl',
        cwd: '/workspace',
        createdAt: '2026-01-01T00:00:00.000Z',
        modifiedAt: '2026-01-01T00:00:00.000Z',
        name: 'Visible title',
        firstMessage: 'hello',
        allMessagesText: 'hello assistant response hidden-search-token',
        messageCount: 2,
      },
      {
        id: 'session-2',
        path: '/workspace/.scout/sessions/session-2.jsonl',
        cwd: '/workspace',
        createdAt: '2026-01-01T00:00:00.000Z',
        modifiedAt: '2026-01-01T00:00:00.000Z',
        name: 'Other title',
        firstMessage: 'hello',
        allMessagesText: 'hello unrelated response',
        messageCount: 2,
      },
    ]);
    (controller as unknown as { sessionManager: unknown }).sessionManager = {
      listSessions,
      sessionFile: '/workspace/.scout/sessions/current.jsonl',
      disposeAsync: vi.fn(async () => undefined),
    };

    controller.bindWebview(chat as never, 'chat');
    controller.handleWebviewMessage({
      type: 'request_task_history',
      query: 'visible',
      requestId: 'history-search',
      offset: 0,
    });
    await flushPromises();

    const historyMessage = chat.postMessage.mock.calls.find(
      ([message]) => message.type === 'task_history_data',
    )?.[0] as {
      requestId: string;
      tasks: Array<{ sessionId: string }>;
      hasMore: boolean;
      nextOffset: number;
    };

    expect(historyMessage.requestId).toBe('history-search');
    expect(historyMessage.tasks).toHaveLength(1);
    expect(historyMessage.tasks[0]?.sessionId).toBe('session-1');
    expect(historyMessage.hasMore).toBe(false);
    expect(historyMessage.nextOffset).toBe(1);

    chat.postMessage.mockClear();
    controller.handleWebviewMessage({
      type: 'request_task_history',
      query: 'hidden-search-token',
      requestId: 'history-body-search',
      offset: 0,
    });
    await flushPromises();

    const bodySearchMessage = chat.postMessage.mock.calls.find(
      ([message]) => message.type === 'task_history_data',
    )?.[0] as { requestId: string; tasks: unknown[] };
    expect(bodySearchMessage.requestId).toBe('history-body-search');
    expect(bodySearchMessage.tasks).toHaveLength(0);

    controller.dispose();
  });

  it('completes a new session request after the prompt is accepted without waiting for the turn', async () => {
    const controller = makeController();
    const chat = makeWebview();
    const acceptPrompt = createDeferred();
    const finishTurn = createDeferred();
    const operation = {
      id: 'request-1',
      kind: 'new_session_message',
      isLatest: vi.fn(() => true),
    };
    const sessionManager = {
      beginUserSessionOperation: vi.fn(() => operation),
      newUserSession: vi.fn(
        async (
          _operation: unknown,
          options?: {
            withSession?: (ctx: {
              startUserMessage: (content: unknown) => Promise<{ turn: Promise<void> }>;
            }) => Promise<void>;
          },
        ) => {
          await options?.withSession?.({
            startUserMessage: vi.fn(async () => {
              await acceptPrompt.promise;
              return { turn: finishTurn.promise };
            }),
          });
          return { status: 'completed' as const, value: { cancelled: false } };
        },
      ),
      getSessionName: vi.fn(async () => undefined),
      getSessionStats: vi.fn(async () => undefined),
      getVisibleLeafId: vi.fn(async () => null),
      getScoutMessages: vi.fn(() => []),
      getQueueState: vi.fn(() => ({ messages: [], followUps: [], paused: false })),
      getAllToolInfos: vi.fn(() => []),
      getActiveToolNames: vi.fn(() => []),
      getCommands: vi.fn(() => []),
      listSessions: vi.fn(async () => []),
      dispose: vi.fn(),
      disposeAsync: vi.fn(async () => undefined),
      diagnostics: [],
      isStreaming: true,
      model: { provider: 'anthropic', id: 'claude-test' },
      thinkingLevel: 'off',
      currentCwd: '/workspace',
      sessionId: 'new-session',
      sessionFile: '/workspace/.scout/new-session.jsonl',
      parentSessionPath: undefined,
      leafId: null,
      modelFallbackMessage: undefined,
    };
    (controller as unknown as { sessionManager: unknown }).sessionManager = sessionManager;

    controller.bindWebview(chat as never, 'chat');
    controller.handleWebviewMessage({
      type: 'new_session_message',
      requestId: 'request-1',
      text: 'hello',
    });
    await flushPromises();

    expect(chat.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'new_session_result' }),
    );

    acceptPrompt.resolve();
    await flushPromises(10);

    expect(chat.postMessage).toHaveBeenCalledWith({
      type: 'new_session_result',
      requestId: 'request-1',
      success: true,
    });
    expect(chat.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task_history_data', purpose: 'recent' }),
    );

    finishTurn.resolve();
    await flushPromises(10);

    expect(chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task_history_data',
        requestId: 'recent-after-turn',
        purpose: 'recent',
        tasks: [],
      }),
    );

    controller.dispose();
  });
});
