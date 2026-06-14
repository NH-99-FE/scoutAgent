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
    ...overrides,
  } as unknown as ExtensionSessionCoordinator;
}

describe('TreeProtocolService', () => {
  it('forks a session and refreshes state, tree, and session list', async () => {
    const sessionManager = makeSessionManager();
    const listWorkspace = vi.fn(async () => []);
    const sessionIndex = new SessionIndex({
      listWorkspace,
      listAll: vi.fn(async () => []),
    });
    await sessionIndex.list('workspace');
    const pushState = vi.fn(async () => undefined);
    const requestSessions = vi.fn(async () => undefined);
    const postMessage = vi.fn();
    const service = new TreeProtocolService({
      sessionManager,
      sessionIndex,
      pushState,
      requestSessions,
      postMessage,
    });

    await service.forkSession({ type: 'fork_session', entryId: 'entry-1', position: 'at' }, 'tree');
    await sessionIndex.list('workspace');

    expect(sessionManager.fork).toHaveBeenCalledWith('entry-1', 'at');
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'fork_result', success: true, error: undefined },
      'tree',
    );
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(sessionManager.getTreeData).toHaveBeenCalledTimes(1);
    expect(requestSessions).toHaveBeenCalledTimes(1);
    expect(listWorkspace).toHaveBeenCalledTimes(2);
  });

  it('responds with navigate results and errors', async () => {
    const sessionManager = makeSessionManager();
    const service = new TreeProtocolService({
      sessionManager,
      sessionIndex: new SessionIndex({ listWorkspace: vi.fn(), listAll: vi.fn() }),
      pushState: vi.fn(),
      requestSessions: vi.fn(),
      postMessage: vi.fn(),
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
      postMessage: vi.fn(),
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
