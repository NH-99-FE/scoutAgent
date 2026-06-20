import { describe, expect, it, vi } from 'vitest';
import { ScoutController } from '../src/scout-controller.ts';
import * as vscode from 'vscode';
import {
  SCOUT_PROTOCOL,
  type ScoutProtocolService,
  type WebviewRequestPayload,
} from '@scout-agent/shared';
import type { JsonlSessionMetadata } from '../src/core/session/index.ts';
import { SessionIndex } from '../src/host/session-index.ts';
import type { ScoutProtocolHostServices } from '../src/host/protocol/scout-protocol-host-services.ts';
import { SessionProtocolService } from '../src/host/protocol/services/session-service.ts';
import { TaskProtocolService } from '../src/host/protocol/services/task-service.ts';

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

function installTaskProtocolService(
  controller: ScoutController,
  listSessions: () => Promise<JsonlSessionMetadata[]>,
): void {
  getProtocolHostServices(controller).task = new TaskProtocolService({
    sessionIndex: new SessionIndex({
      listWorkspace: listSessions,
      listAll: listSessions,
    }),
    getActiveSessionFile: () => '/workspace/.scout/sessions/current.jsonl',
    logError: vi.fn(),
  });
}

function installSessionProtocolService(
  controller: ScoutController,
  service: SessionProtocolService,
): void {
  getProtocolHostServices(controller).session = service;
}

function getProtocolHostServices(controller: ScoutController): ScoutProtocolHostServices {
  return (controller as unknown as { protocolHostServices: ScoutProtocolHostServices })
    .protocolHostServices;
}

function protocolRequest(payload: WebviewRequestPayload, requestId = `request:${payload.type}`) {
  const route = resolveRoute(payload);
  return {
    type: 'protocol_request' as const,
    requestId,
    service: route.service,
    method: route.method,
    payload,
  };
}

function resolveRoute(payload: WebviewRequestPayload): {
  service: ScoutProtocolService;
  method: string;
} {
  const route = SCOUT_PROTOCOL[payload.type];
  return { service: route.service, method: route.method };
}

describe('ScoutController webview surfaces', () => {
  it('handles control abort messages without routing through the protocol server', () => {
    const controller = makeController();
    const internals = controller as unknown as {
      sessionManager: { abort: () => Promise<void>; abortRetry: () => Promise<void> };
      protocolServer: { handleRequest: (message: unknown, surface: string) => Promise<void> };
    };
    const abort = vi.spyOn(internals.sessionManager, 'abort').mockResolvedValue(undefined);
    const abortRetry = vi
      .spyOn(internals.sessionManager, 'abortRetry')
      .mockResolvedValue(undefined);
    const handleRequest = vi.spyOn(internals.protocolServer, 'handleRequest');

    controller.handleWebviewMessage({ type: 'control_abort' }, 'chat');
    controller.handleWebviewMessage({ type: 'control_abort_retry' }, 'chat');

    expect(abort).toHaveBeenCalledTimes(1);
    expect(abortRetry).toHaveBeenCalledTimes(1);
    expect(handleRequest).not.toHaveBeenCalled();
  });

  it('directs request-scoped messages to the source webview surface', () => {
    const controller = makeController();
    const chat = makeWebview();
    const tree = makeWebview();
    const settings = makeWebview();

    controller.bindWebview(chat as never, 'chat');
    controller.bindWebview(tree as never, 'tree');
    controller.bindWebview(settings as never, 'settings');

    controller.handleWebviewMessage(protocolRequest({ type: 'request_config' }), 'chat');

    expect(chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'protocol_response',
        payload: expect.objectContaining({ type: 'config_result' }),
      }),
    );
    expect(tree.postMessage).not.toHaveBeenCalled();
    expect(settings.postMessage).not.toHaveBeenCalled();

    controller.dispose();
  });

  it('stops sending to a webview after its binding is disposed', () => {
    const controller = makeController();
    const chat = makeWebview();
    const tree = makeWebview();
    const treeMessageDisposable = { dispose: vi.fn() };
    tree.onDidReceiveMessage.mockReturnValue(treeMessageDisposable);

    controller.bindWebview(chat as never, 'chat');
    const treeBinding = controller.bindWebview(tree as never, 'tree');

    treeBinding.dispose();
    controller.handleWebviewMessage(protocolRequest({ type: 'request_config' }), 'chat');

    expect(chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'protocol_response',
        payload: expect.objectContaining({ type: 'config_result' }),
      }),
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
    installTaskProtocolService(controller, listSessions);

    controller.bindWebview(chat as never, 'chat');
    controller.handleWebviewMessage(
      protocolRequest(
        {
          type: 'request_task_history',
          query: '',
          limit: 3,
          offset: 0,
          purpose: 'recent',
        },
        'recent-1',
      ),
    );
    await flushPromises();
    controller.handleWebviewMessage(
      protocolRequest(
        {
          type: 'request_task_history',
          query: '',
          offset: 20,
          purpose: 'panel',
        },
        'history-1',
      ),
    );
    await flushPromises();

    expect(listSessions).toHaveBeenCalledTimes(1);
    expect(listSessions.mock.calls[0]).toEqual([]);
    const taskHistoryMessages = chat.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === 'protocol_response')
      .map((message) => message.payload)
      .filter((payload) => payload?.type === 'task_history_result') as Array<{
      purpose?: string;
      tasks: Array<{ sessionId: string }>;
      offset: number;
      hasMore: boolean;
      nextOffset: number;
    }>;
    const tasksMessage = taskHistoryMessages.find((message) => message.purpose === 'recent');
    const historyMessage = taskHistoryMessages.find((message) => message.purpose === 'panel');

    expect(tasksMessage?.tasks).toHaveLength(3);
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
    installTaskProtocolService(controller, listSessions);

    controller.bindWebview(chat as never, 'chat');
    controller.handleWebviewMessage(
      protocolRequest(
        {
          type: 'request_task_history',
          query: 'visible',
          offset: 0,
        },
        'history-search',
      ),
    );
    await flushPromises(10);

    const historyMessage = chat.postMessage.mock.calls.find(
      ([message]) =>
        message.type === 'protocol_response' && message.payload?.type === 'task_history_result',
    )?.[0].payload as {
      tasks: Array<{ sessionId: string }>;
      hasMore: boolean;
      nextOffset: number;
    };

    expect(historyMessage.tasks).toHaveLength(1);
    expect(historyMessage.tasks[0]?.sessionId).toBe('session-1');
    expect(historyMessage.hasMore).toBe(false);
    expect(historyMessage.nextOffset).toBe(1);

    chat.postMessage.mockClear();
    controller.handleWebviewMessage(
      protocolRequest(
        {
          type: 'request_task_history',
          query: 'hidden-search-token',
          offset: 0,
        },
        'history-body-search',
      ),
    );
    await flushPromises(10);

    const bodySearchMessage = chat.postMessage.mock.calls.find(
      ([message]) =>
        message.type === 'protocol_response' && message.payload?.type === 'task_history_result',
    )?.[0].payload as { tasks: unknown[] };
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
      sequence: 1,
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
    installSessionProtocolService(
      controller,
      new SessionProtocolService({
        cwd: '/workspace',
        sessionManager: sessionManager as never,
        sessionIndex: new SessionIndex({
          listWorkspace: vi.fn(async () => []),
          listAll: vi.fn(async () => []),
        }),
        pushState: vi.fn(async () => undefined),
        pushTreeData: vi.fn(async () => undefined),
        requestRecentTasks: vi.fn(async () => {
          await chat.postMessage({
            type: 'task_history_update',
            query: '',
            purpose: 'recent',
            tasks: [],
            offset: 0,
            hasMore: false,
            nextOffset: 0,
          });
        }),
        publishEvent: (message) => {
          void chat.postMessage(message);
        },
        logError: vi.fn(),
      }),
    );

    controller.bindWebview(chat as never, 'chat');
    controller.handleWebviewMessage(
      protocolRequest({ type: 'new_session_message', text: 'hello' }, 'request-1'),
    );
    await flushPromises();

    expect(chat.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'new_session_result' }),
    );

    acceptPrompt.resolve();
    await flushPromises(20);

    expect(chat.postMessage).toHaveBeenCalledWith({
      type: 'protocol_response',
      requestId: 'request-1',
      payload: { type: 'new_session_result', success: true },
    });
    expect(chat.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task_history_update', purpose: 'recent' }),
    );

    finishTurn.resolve();
    await flushPromises(30);

    expect(chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task_history_update',
        purpose: 'recent',
        tasks: [],
      }),
    );

    controller.dispose();
  });
});
