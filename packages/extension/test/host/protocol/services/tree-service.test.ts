import { describe, expect, it, vi } from 'vitest';
import type { ExtensionSessionCoordinator } from '../../../../src/host/session-coordinator.ts';
import { SessionIndex } from '../../../../src/host/session-index.ts';
import { TreeProtocolService } from '../../../../src/host/protocol/services/tree-service.ts';

function makeSessionManager(
  overrides: Partial<ExtensionSessionCoordinator> = {},
): ExtensionSessionCoordinator {
  return {
    fork: vi.fn(async () => ({ cancelled: false })),
    navigateTree: vi.fn(async () => ({ cancelled: false, editorText: 'restored text' })),
    setLabel: vi.fn(async () => undefined),
    getTreeData: vi.fn(async () => ({ tree: [], leafId: 'leaf-1' })),
    getForkCandidates: vi.fn(() => []),
    ...overrides,
  } as unknown as ExtensionSessionCoordinator;
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
      { type: 'fork_session', entryId: 'entry-1', position: 'before' },
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
      selectedText: 'forked prompt',
    });
    expect(listWorkspace).toHaveBeenCalledTimes(2);
  });

  it('keeps the fork result successful when post-fork refresh fails', async () => {
    const sessionManager = makeSessionManager({
      fork: vi.fn(async () => ({ cancelled: false, selectedText: 'forked prompt' })),
      sessionId: 'fork-session-id',
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
      { type: 'fork_session', entryId: 'entry-1', position: 'before' },
      respond,
    );

    expect(respond).toHaveBeenCalledWith({
      type: 'fork_result',
      success: true,
      error: undefined,
      targetSessionId: 'fork-session-id',
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
    const service = new TreeProtocolService({
      sessionManager,
      sessionIndex: new SessionIndex({ listWorkspace: vi.fn(), listAll: vi.fn() }),
      pushState: vi.fn(),
      requestSessions: vi.fn(),
      publishEvent: vi.fn(),
    });
    const respond = vi.fn();

    await service.navigateTree(
      {
        type: 'navigate_tree',
        targetId: 'entry-1',
        summarize: true,
        customInstructions: 'brief',
        replaceInstructions: true,
        label: 'branch',
      },
      respond,
    );

    expect(sessionManager.navigateTree).toHaveBeenCalledWith('entry-1', {
      summarize: true,
      customInstructions: 'brief',
      replaceInstructions: true,
      label: 'branch',
    });
    expect(respond).toHaveBeenCalledWith({
      type: 'navigate_tree_result',
      success: true,
      editorText: 'restored text',
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

    await service.setLabel({ type: 'set_label', entryId: 'entry-1', label: 'New label' }, respond);

    expect(respond).toHaveBeenCalledWith({
      type: 'label_result',
      success: false,
      error: 'rename failed',
    });
  });
});
