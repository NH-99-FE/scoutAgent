import { describe, expect, it, vi } from 'vitest';
import type { ExtensionSessionCoordinator } from '../../../../src/host/session-coordinator.ts';
import { SessionIndex } from '../../../../src/host/session-index.ts';
import { TreeProtocolService } from '../../../../src/host/protocol/services/tree-service.ts';

const SESSION = { sessionId: 'session-1', sessionPath: '/sessions/session-1.jsonl' };
const NAVIGATION_ID = 'navigation-1';

function makeSessionManager(
  overrides: Partial<ExtensionSessionCoordinator> = {},
): ExtensionSessionCoordinator {
  const manager = {
    sessionId: SESSION.sessionId,
    sessionFile: SESSION.sessionPath,
    fork: vi.fn(async () => ({ cancelled: false })),
    navigateTree: vi.fn(async () => ({
      navigationId: 'navigation-1',
      status: 'committed' as const,
      editorText: 'restored text',
    })),
    abortTreeNavigation: vi.fn(() => true),
    setPendingComposerIntent: vi.fn(),
    setLabel: vi.fn(async () => undefined),
    getTreeData: vi.fn(async () => ({ tree: [], leafId: 'leaf-1' })),
    getForkCandidates: vi.fn(() => []),
    ...overrides,
  } as unknown as ExtensionSessionCoordinator;
  if (!('sessionIdentity' in overrides)) {
    Object.defineProperty(manager, 'sessionIdentity', {
      configurable: true,
      get: () => {
        const sessionId = manager.sessionId;
        const sessionPath = manager.sessionFile;
        return sessionId && sessionPath ? { sessionId, sessionPath } : undefined;
      },
    });
  }
  if (!('executionSnapshot' in overrides)) {
    Object.defineProperty(manager, 'executionSnapshot', {
      configurable: true,
      get: () => ({
        session: manager.sessionIdentity,
        activity: { kind: 'idle' },
        health: { kind: 'ready' },
      }),
    });
  }
  return manager;
}

describe('TreeProtocolService', () => {
  it('forks a session and refreshes state, tree, and session list', async () => {
    const sessionManager = makeSessionManager({
      fork: vi.fn(async () => ({ cancelled: false, selectedText: 'forked prompt' })),
      sessionId: 'fork-session-id',
      sessionFile: '/sessions/fork.jsonl',
    });
    const listWorkspace = vi.fn(async () => []);
    const sessionIndex = new SessionIndex({
      listWorkspace,
      listAll: vi.fn(async () => []),
    });
    await sessionIndex.list('workspace');
    const pushState = vi.fn(async () => undefined);
    const requestSessions = vi.fn(async () => undefined);
    const publishEvent = vi.fn();
    const respond = vi.fn();
    const service = new TreeProtocolService({
      sessionManager,
      sessionIndex,
      pushState,
      requestSessions,
      publishEvent,
    });

    await service.forkSession(
      {
        type: 'fork_session',
        session: { sessionId: 'fork-session-id', sessionPath: '/sessions/fork.jsonl' },
        entryId: 'entry-1',
        position: 'before',
      },
      respond,
    );
    await sessionIndex.list('workspace');

    expect(sessionManager.fork).toHaveBeenCalledWith('entry-1', 'before');
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(sessionManager.getTreeData).toHaveBeenCalledTimes(1);
    expect(requestSessions).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith({
      type: 'fork_result',
      success: true,
      error: undefined,
      targetSessionId: 'fork-session-id',
      targetSessionPath: '/sessions/fork.jsonl',
      selectedText: 'forked prompt',
    });
    expect(listWorkspace).toHaveBeenCalledTimes(2);
  });

  it('keeps the fork result successful when post-fork refresh fails', async () => {
    const sessionManager = makeSessionManager({
      fork: vi.fn(async () => ({ cancelled: false, selectedText: 'forked prompt' })),
      sessionId: 'session-1',
      sessionFile: SESSION.sessionPath,
    });
    const publishEvent = vi.fn();
    const service = new TreeProtocolService({
      sessionManager,
      sessionIndex: new SessionIndex({ listWorkspace: vi.fn(), listAll: vi.fn() }),
      pushState: vi.fn(async () => {
        throw new Error('state unavailable');
      }),
      requestSessions: vi.fn(),
      publishEvent,
    });
    const respond = vi.fn();

    await service.forkSession(
      { type: 'fork_session', session: SESSION, entryId: 'entry-1', position: 'before' },
      respond,
    );

    expect(respond).toHaveBeenCalledWith({
      type: 'fork_result',
      success: true,
      error: undefined,
      targetSessionId: 'session-1',
      targetSessionPath: SESSION.sessionPath,
      selectedText: 'forked prompt',
    });
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'notification',
      level: 'error',
      message: 'Fork succeeded, but refresh failed: state unavailable',
    });
  });

  it('responds with fork candidates from the session raw branch', async () => {
    const candidates = [
      { entryId: 'u1', text: 'first user message' },
      { entryId: 'u2', text: 'second user message' },
    ];
    const sessionManager = makeSessionManager({
      getForkCandidates: vi.fn(() => candidates),
      sessionId: 'session-1',
    });
    const service = new TreeProtocolService({
      sessionManager,
      sessionIndex: new SessionIndex({ listWorkspace: vi.fn(), listAll: vi.fn() }),
      pushState: vi.fn(),
      requestSessions: vi.fn(),
      publishEvent: vi.fn(),
    });
    const respond = vi.fn();

    await service.requestForkCandidates(
      { type: 'request_fork_candidates', sessionId: 'session-1' },
      respond,
    );

    expect(sessionManager.getForkCandidates).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith({
      type: 'fork_candidates_result',
      sessionId: 'session-1',
      candidates,
    });
  });

  it('does not read fork candidates for a stale session request', async () => {
    const sessionManager = makeSessionManager({
      getForkCandidates: vi.fn(() => [{ entryId: 'u1', text: 'stale' }]),
      sessionId: 'session-current',
    });
    const service = new TreeProtocolService({
      sessionManager,
      sessionIndex: new SessionIndex({ listWorkspace: vi.fn(), listAll: vi.fn() }),
      pushState: vi.fn(),
      requestSessions: vi.fn(),
      publishEvent: vi.fn(),
    });
    const respond = vi.fn();

    await service.requestForkCandidates(
      { type: 'request_fork_candidates', sessionId: 'session-old' },
      respond,
    );

    expect(sessionManager.getForkCandidates).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith({
      type: 'fork_candidates_result',
      sessionId: 'session-old',
      candidates: [],
    });
  });

  it('responds with navigate results and errors', async () => {
    const sessionManager = makeSessionManager();
    const openChatSurface = vi.fn(async () => undefined);
    const publishEvent = vi.fn();
    const pushState = vi.fn();
    const service = new TreeProtocolService({
      sessionManager,
      sessionIndex: new SessionIndex({ listWorkspace: vi.fn(), listAll: vi.fn() }),
      pushState,
      requestSessions: vi.fn(),
      publishEvent,
      openChatSurface,
    });
    const respond = vi.fn();
    const requestSignal = new AbortController().signal;

    await service.navigateTree(
      {
        type: 'navigate_tree',
        navigationId: NAVIGATION_ID,
        session: SESSION,
        targetId: 'entry-1',
        summarize: true,
        customInstructions: 'brief',
        replaceInstructions: true,
        label: 'branch',
      },
      respond,
      requestSignal,
    );

    expect(sessionManager.navigateTree).toHaveBeenCalledWith(
      'entry-1',
      {
        navigationId: NAVIGATION_ID,
        summarize: true,
        customInstructions: 'brief',
        replaceInstructions: true,
        label: 'branch',
      },
      requestSignal,
    );
    expect(respond).toHaveBeenCalledWith({
      type: 'navigate_tree_result',
      navigationId: NAVIGATION_ID,
      status: 'committed',
      error: undefined,
    });
    expect(openChatSurface).toHaveBeenCalledTimes(1);
    expect(sessionManager.setPendingComposerIntent).toHaveBeenCalledWith({
      commandId: NAVIGATION_ID,
      session: SESSION,
      kind: 'replace_text',
      text: 'restored text',
    });
    expect(pushState).toHaveBeenCalledWith('chat');
  });

  it('keeps a committed composer intent targeted to the requested session identity', async () => {
    let finishNavigation!: (result: {
      navigationId: string;
      status: 'committed';
      editorText: string;
    }) => void;
    const sessionManager = makeSessionManager({
      sessionId: 'session-1',
      sessionFile: '/sessions/session-1.jsonl',
      navigateTree: vi.fn(
        async () =>
          await new Promise<{
            navigationId: string;
            status: 'committed';
            editorText: string;
          }>((resolve) => {
            finishNavigation = resolve;
          }),
      ),
    });
    const openChatSurface = vi.fn(async () => undefined);
    const publishEvent = vi.fn();
    const respond = vi.fn();
    const service = new TreeProtocolService({
      sessionManager,
      sessionIndex: new SessionIndex({ listWorkspace: vi.fn(), listAll: vi.fn() }),
      pushState: vi.fn(),
      requestSessions: vi.fn(),
      publishEvent,
      openChatSurface,
    });

    const navigation = service.navigateTree(
      {
        type: 'navigate_tree',
        navigationId: NAVIGATION_ID,
        session: SESSION,
        targetId: 'entry-1',
        summarize: false,
      },
      respond,
    );
    Object.assign(sessionManager, {
      sessionId: 'session-2',
      sessionFile: '/sessions/session-2.jsonl',
    });
    finishNavigation({
      navigationId: NAVIGATION_ID,
      status: 'committed',
      editorText: 'restored text',
    });
    await navigation;

    expect(openChatSurface).toHaveBeenCalledTimes(1);
    expect(sessionManager.setPendingComposerIntent).toHaveBeenCalledWith(
      expect.objectContaining({ session: SESSION, commandId: NAVIGATION_ID }),
    );
    expect(respond).toHaveBeenCalledWith({
      type: 'navigate_tree_result',
      navigationId: NAVIGATION_ID,
      status: 'committed',
      error: undefined,
    });
  });

  it('supersedes an earlier composer prefill with a clear intent', async () => {
    const sessionManager = makeSessionManager({
      navigateTree: vi.fn(async () => ({
        navigationId: NAVIGATION_ID,
        status: 'committed' as const,
      })),
    });
    const openChatSurface = vi.fn();
    const pushState = vi.fn();
    const service = new TreeProtocolService({
      sessionManager,
      sessionIndex: new SessionIndex({ listWorkspace: vi.fn(), listAll: vi.fn() }),
      pushState,
      requestSessions: vi.fn(),
      publishEvent: vi.fn(),
      openChatSurface,
    });

    await service.navigateTree(
      {
        type: 'navigate_tree',
        navigationId: NAVIGATION_ID,
        session: SESSION,
        targetId: 'assistant-entry',
        summarize: false,
      },
      vi.fn(),
    );

    expect(sessionManager.setPendingComposerIntent).toHaveBeenCalledWith({
      commandId: NAVIGATION_ID,
      session: SESSION,
      kind: 'clear',
    });
    expect(openChatSurface).not.toHaveBeenCalled();
    expect(pushState).toHaveBeenCalledWith('chat');
  });

  it('persists the composer intent before opening chat and preserves the committed result when refresh fails', async () => {
    const sessionManager = makeSessionManager({
      sessionId: 'session-1',
      sessionFile: '/sessions/session-1.jsonl',
    });
    const publishEvent = vi.fn();
    const respond = vi.fn();
    const openChatSurface = vi.fn(async () => {
      expect(sessionManager.setPendingComposerIntent).toHaveBeenCalledWith({
        commandId: NAVIGATION_ID,
        session: SESSION,
        kind: 'replace_text',
        text: 'restored text',
      });
    });
    const service = new TreeProtocolService({
      sessionManager,
      sessionIndex: new SessionIndex({ listWorkspace: vi.fn(), listAll: vi.fn() }),
      pushState: vi.fn(async () => {
        throw new Error('state unavailable');
      }),
      requestSessions: vi.fn(),
      publishEvent,
      openChatSurface,
    });

    await service.navigateTree(
      {
        type: 'navigate_tree',
        navigationId: NAVIGATION_ID,
        session: SESSION,
        targetId: 'entry-1',
        summarize: false,
      },
      respond,
    );

    expect(sessionManager.setPendingComposerIntent).toHaveBeenCalledWith(
      expect.objectContaining({ session: SESSION, commandId: NAVIGATION_ID }),
    );
    expect(respond).toHaveBeenCalledWith({
      type: 'navigate_tree_result',
      navigationId: NAVIGATION_ID,
      status: 'committed',
      error: undefined,
    });
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'notification',
        level: 'warning',
        message: expect.stringContaining('state unavailable'),
      }),
      'tree',
    );
  });

  it('does not create a composer intent for cancelled navigation', async () => {
    const publishEvent = vi.fn();
    const service = new TreeProtocolService({
      sessionManager: makeSessionManager({
        navigateTree: vi.fn(async () => ({
          navigationId: NAVIGATION_ID,
          status: 'cancelled' as const,
        })),
      }),
      sessionIndex: new SessionIndex({ listWorkspace: vi.fn(), listAll: vi.fn() }),
      pushState: vi.fn(),
      requestSessions: vi.fn(),
      publishEvent,
    });
    const respond = vi.fn();

    await service.navigateTree(
      {
        type: 'navigate_tree',
        navigationId: NAVIGATION_ID,
        session: SESSION,
        targetId: 'entry-1',
        summarize: true,
      },
      respond,
    );

    expect(respond).toHaveBeenCalledWith({
      type: 'navigate_tree_result',
      navigationId: NAVIGATION_ID,
      status: 'cancelled',
      error: undefined,
    });
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('keeps navigation successful when opening the chat surface fails', async () => {
    const publishEvent = vi.fn();
    const sessionManager = makeSessionManager();
    const service = new TreeProtocolService({
      sessionManager,
      sessionIndex: new SessionIndex({ listWorkspace: vi.fn(), listAll: vi.fn() }),
      pushState: vi.fn(),
      requestSessions: vi.fn(),
      publishEvent,
      openChatSurface: vi.fn(async () => {
        throw new Error('view unavailable');
      }),
    });
    const respond = vi.fn();

    await service.navigateTree(
      {
        type: 'navigate_tree',
        navigationId: NAVIGATION_ID,
        session: SESSION,
        targetId: 'entry-1',
        summarize: false,
      },
      respond,
    );

    expect(respond).toHaveBeenCalledWith({
      type: 'navigate_tree_result',
      navigationId: NAVIGATION_ID,
      status: 'committed',
      error: undefined,
    });
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'notification',
        level: 'warning',
        message: expect.stringContaining('view unavailable'),
      }),
      'tree',
    );
    expect(sessionManager.setPendingComposerIntent).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: NAVIGATION_ID, session: SESSION }),
    );
  });

  it('accepts cancellation only while the matching navigation is in preflight', async () => {
    const abortTreeNavigation = vi.fn(() => true);
    const sessionManager = makeSessionManager({ abortTreeNavigation });
    Object.defineProperty(sessionManager, 'executionSnapshot', {
      configurable: true,
      value: {
        session: SESSION,
        activity: {
          kind: 'tree_navigation',
          operationId: NAVIGATION_ID,
          phase: 'preflight',
        },
        health: { kind: 'ready' },
      },
    });
    const service = new TreeProtocolService({
      sessionManager,
      sessionIndex: new SessionIndex({ listWorkspace: vi.fn(), listAll: vi.fn() }),
      pushState: vi.fn(),
      requestSessions: vi.fn(),
      publishEvent: vi.fn(),
    });
    const respond = vi.fn();

    await service.abortTreeNavigation(
      { type: 'abort_tree_navigation', navigationId: NAVIGATION_ID, session: SESSION },
      respond,
    );

    expect(abortTreeNavigation).toHaveBeenCalledWith(NAVIGATION_ID);
    expect(respond).toHaveBeenCalledWith({
      type: 'abort_tree_navigation_result',
      status: 'accepted',
    });
  });

  it('rejects cancellation while navigation is reconciling', async () => {
    const abortTreeNavigation = vi.fn(() => true);
    const sessionManager = makeSessionManager({ abortTreeNavigation });
    Object.defineProperty(sessionManager, 'executionSnapshot', {
      configurable: true,
      value: {
        session: SESSION,
        activity: {
          kind: 'tree_navigation',
          operationId: NAVIGATION_ID,
          phase: 'reconciling',
        },
        health: { kind: 'ready' },
      },
    });
    const service = new TreeProtocolService({
      sessionManager,
      sessionIndex: new SessionIndex({ listWorkspace: vi.fn(), listAll: vi.fn() }),
      pushState: vi.fn(),
      requestSessions: vi.fn(),
      publishEvent: vi.fn(),
    });
    const respond = vi.fn();

    await service.abortTreeNavigation(
      { type: 'abort_tree_navigation', navigationId: NAVIGATION_ID, session: SESSION },
      respond,
    );

    expect(abortTreeNavigation).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith({
      type: 'abort_tree_navigation_result',
      status: 'not_running',
    });
  });

  it('responds with label errors when renaming fails', async () => {
    const service = new TreeProtocolService({
      sessionManager: makeSessionManager({
        setLabel: vi.fn(async () => {
          throw new Error('rename failed');
        }),
      }),
      sessionIndex: new SessionIndex({ listWorkspace: vi.fn(), listAll: vi.fn() }),
      pushState: vi.fn(),
      requestSessions: vi.fn(),
      publishEvent: vi.fn(),
    });
    const respond = vi.fn();

    await service.setLabel(
      { type: 'set_label', session: SESSION, entryId: 'entry-1', label: 'New label' },
      respond,
    );

    expect(respond).toHaveBeenCalledWith({
      type: 'label_result',
      success: false,
      error: 'rename failed',
    });
  });
});
