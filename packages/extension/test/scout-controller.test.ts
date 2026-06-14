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
      expect.objectContaining({ type: 'tasks_data' }),
    );

    finishTurn.resolve();
    await flushPromises(10);

    expect(chat.postMessage).toHaveBeenCalledWith({ type: 'tasks_data', tasks: [] });

    controller.dispose();
  });
});
