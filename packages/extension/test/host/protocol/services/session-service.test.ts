import * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonlSessionMetadata } from '../../../../src/core/session/index.ts';
import type {
  ExtensionSessionCoordinator,
  UserSessionOperationToken,
} from '../../../../src/host/session-coordinator.ts';
import { SessionIndex } from '../../../../src/host/session-index.ts';
import { SessionProtocolService } from '../../../../src/host/protocol/services/session-service.ts';

type TestPublishEvent = (message: unknown, surface?: unknown) => void;

function makeSession(overrides: Partial<JsonlSessionMetadata> = {}): JsonlSessionMetadata {
  return {
    id: 'session-1',
    path: '/workspace/.scout/sessions/session-1.jsonl',
    cwd: '/workspace',
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-02T00:00:00.000Z',
    name: 'Visible session',
    firstMessage: 'hello',
    messageCount: 2,
    ...overrides,
  };
}

function makeOperation(
  kind: UserSessionOperationToken['kind'] = 'new_session_message',
  isLatest = true,
): UserSessionOperationToken {
  return {
    id: `${kind}:test`,
    sequence: 1,
    kind,
    isLatest: vi.fn(() => isLatest),
  };
}

function makeSessionManager(overrides: Record<string, unknown> = {}): ExtensionSessionCoordinator {
  return {
    sessionId: 'session-1',
    sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
    beginUserSessionOperation: vi.fn((kind: UserSessionOperationToken['kind']) =>
      makeOperation(kind),
    ),
    restoreUserSession: vi.fn(async () => ({ status: 'completed', value: { cancelled: false } })),
    newUserSession: vi.fn(async () => ({ status: 'completed', value: { cancelled: false } })),
    prompt: vi.fn(async () => undefined),
    cancelFollowUp: vi.fn(),
    promoteFollowUp: vi.fn(() => false),
    continue: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    abortRetry: vi.fn(async () => undefined),
    compact: vi.fn(async () => undefined),
    newSession: vi.fn(async () => undefined),
    setSessionName: vi.fn(async () => undefined),
    exportSessionToJsonl: vi.fn(() => '/workspace/session.jsonl'),
    importSessionFromJsonl: vi.fn(async () => ({ cancelled: false })),
    deleteSession: vi.fn(async () => undefined),
    restore: vi.fn(async () => ({ cancelled: false })),
    ...overrides,
  } as unknown as ExtensionSessionCoordinator;
}

function makeService(
  options: {
    sessions?: JsonlSessionMetadata[];
    sessionManager?: ExtensionSessionCoordinator;
    pushState?: () => Promise<void>;
    pushTreeData?: () => Promise<void>;
    requestRecentTasks?: () => Promise<void>;
    publishEvent?: TestPublishEvent;
    logError?: (message: string) => void;
  } = {},
) {
  const publishEvent: TestPublishEvent = options.publishEvent ?? vi.fn();
  const logError: (message: string) => void = options.logError ?? vi.fn();
  const sessionIndex = new SessionIndex({
    listWorkspace: vi.fn(async () => options.sessions ?? []),
    listAll: vi.fn(async () => options.sessions ?? []),
  });
  const service = new SessionProtocolService({
    cwd: '/workspace',
    sessionManager: options.sessionManager ?? makeSessionManager(),
    sessionIndex,
    pushState: options.pushState ?? vi.fn(async () => undefined),
    pushTreeData: options.pushTreeData ?? vi.fn(async () => undefined),
    requestRecentTasks: options.requestRecentTasks ?? vi.fn(async () => undefined),
    publishEvent: (message, surface) => publishEvent(message, surface),
    logError: (message) => logError(message),
  });
  return { service, sessionIndex };
}

describe('SessionProtocolService', () => {
  beforeEach(() => {
    vi.mocked(vscode.window.showOpenDialog).mockReset();
    vi.mocked(vscode.window.showSaveDialog).mockReset();
  });

  it('responds with session list data and marks the active session', async () => {
    const respond = vi.fn();
    const { service } = makeService({
      sessions: [
        makeSession({ id: 'session-1', path: '/workspace/.scout/sessions/session-1.jsonl' }),
        makeSession({ id: 'session-2', path: '/workspace/.scout/sessions/session-2.jsonl' }),
      ],
    });

    await service.requestSessions(respond);

    expect(respond).toHaveBeenCalledWith({
      type: 'sessions_result',
      sessions: [
        expect.objectContaining({ id: 'session-1', isCurrent: true }),
        expect.objectContaining({ id: 'session-2', isCurrent: false }),
      ],
    });
  });

  it('opens a task through restoreUserSession and refreshes state and tree', async () => {
    const session = makeSession({
      id: 'task-1',
      path: '/workspace/.scout/sessions/task-1.jsonl',
    });
    const operation = makeOperation('open_task');
    const sessionManager = makeSessionManager({
      beginUserSessionOperation: vi.fn(() => operation),
    });
    const pushState = vi.fn(async () => undefined);
    const pushTreeData = vi.fn(async () => undefined);
    const respond = vi.fn();
    const { service } = makeService({
      sessions: [session],
      sessionManager,
      pushState,
      pushTreeData,
    });

    await service.openTask(
      {
        type: 'open_task',
        taskId: 'task-1',
        sessionPath: '/workspace/.scout/sessions/task-1.jsonl',
        cwdOverride: '/workspace',
      },
      respond,
    );

    expect(sessionManager.beginUserSessionOperation).toHaveBeenCalledWith('open_task');
    expect(sessionManager.restoreUserSession).toHaveBeenCalledWith(operation, session, {
      cwdOverride: '/workspace',
    });
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(pushTreeData).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith({
      type: 'open_task_result',
      sessionPath: '/workspace/.scout/sessions/task-1.jsonl',
      success: true,
      error: undefined,
    });
  });

  it('refreshes recent tasks after a new session initial turn finishes', async () => {
    let resolveTurn: (() => void) | undefined;
    const turn = new Promise<void>((resolve) => {
      resolveTurn = resolve;
    });
    const operation = makeOperation('new_session_message');
    const sessionManager = makeSessionManager({
      beginUserSessionOperation: vi.fn(() => operation),
      newUserSession: vi.fn(
        async (_operation, options: { withSession: (ctx: unknown) => void }) => {
          await options.withSession({
            startUserMessage: vi.fn(async () => ({ turn })),
          });
          return { status: 'completed', value: { cancelled: false } };
        },
      ),
    });
    const pushState = vi.fn(async () => undefined);
    const requestRecentTasks = vi.fn(async () => undefined);
    const respond = vi.fn();
    const { service } = makeService({
      sessionManager,
      pushState,
      requestRecentTasks,
    });

    await service.newSessionMessage({ type: 'new_session_message', text: 'hello' }, respond);
    resolveTurn?.();
    await turn;
    await Promise.resolve();

    expect(respond).toHaveBeenCalledWith({ type: 'new_session_result', success: true });
    expect(pushState).toHaveBeenCalledTimes(2);
    expect(requestRecentTasks).toHaveBeenCalledTimes(1);
  });

  it('refreshes recent tasks after renaming the active session', async () => {
    const sessionManager = makeSessionManager();
    const pushState = vi.fn(async () => undefined);
    const requestRecentTasks = vi.fn(async () => undefined);
    const respond = vi.fn();
    const { service } = makeService({
      sessionManager,
      pushState,
      requestRecentTasks,
    });

    await service.setSessionName({ type: 'set_session_name', name: '新的对话标题' }, respond);

    expect(sessionManager.setSessionName).toHaveBeenCalledWith('新的对话标题');
    expect(respond).toHaveBeenCalledWith({ type: 'set_session_name_result', success: true });
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(requestRecentTasks).toHaveBeenCalledTimes(1);
  });

  it('prompts for an export path and writes the active session jsonl there', async () => {
    const sessionManager = makeSessionManager();
    const respond = vi.fn();
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(
      vscode.Uri.file('/workspace/exported-session.jsonl'),
    );
    const { service } = makeService({ sessionManager });

    await service.exportSession({ type: 'export_session', format: 'jsonl' }, respond);

    expect(vscode.window.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultUri: expect.objectContaining({
          fsPath: expect.stringMatching(/^\/workspace\/session-session-1-/),
        }),
        filters: { 'JSONL Session': ['jsonl'], 'All Files': ['*'] },
        saveLabel: 'Export Session',
      }),
    );
    expect(sessionManager.exportSessionToJsonl).toHaveBeenCalledWith(
      '/workspace/exported-session.jsonl',
    );
    expect(respond).toHaveBeenCalledWith({
      type: 'export_session_result',
      success: true,
      path: '/workspace/session.jsonl',
    });
  });

  it('exports directly to the provided output path without opening a save dialog', async () => {
    const sessionManager = makeSessionManager();
    const respond = vi.fn();
    const { service } = makeService({ sessionManager });

    await service.exportSession(
      { type: 'export_session', format: 'jsonl', outputPath: '/workspace/direct.jsonl' },
      respond,
    );

    expect(vscode.window.showSaveDialog).not.toHaveBeenCalled();
    expect(sessionManager.exportSessionToJsonl).toHaveBeenCalledWith('/workspace/direct.jsonl');
    expect(respond).toHaveBeenCalledWith({
      type: 'export_session_result',
      success: true,
      path: '/workspace/session.jsonl',
    });
  });

  it('does not export when the save dialog is cancelled', async () => {
    const sessionManager = makeSessionManager();
    const respond = vi.fn();
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(undefined);
    const { service } = makeService({ sessionManager });

    await service.exportSession({ type: 'export_session', format: 'jsonl' }, respond);

    expect(sessionManager.exportSessionToJsonl).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith({
      type: 'export_session_result',
      success: false,
      error: 'cancelled',
    });
  });
});
