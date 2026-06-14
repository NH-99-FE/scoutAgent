import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtensionSessionCoordinator } from '../../src/host/session-coordinator.ts';
import { ConfigManager } from '../../src/config-manager.ts';
import type { AgentSession } from '../../src/core/agent-session.ts';
import {
  mapSessionTreeToScout,
  resolveVisibleSessionLeafId,
} from '../../src/host/protocol/session-tree-mapper.ts';
import type { Session, SessionTreeNode } from '../../src/core/session/index.ts';
import { assistantMessage, userMessage } from '../core/test-utils.ts';

function createOutputChannel() {
  return {
    name: 'scout-test',
    append: () => undefined,
    appendLine: () => undefined,
    replace: () => undefined,
    clear: () => undefined,
    show: () => undefined,
    hide: () => undefined,
    dispose: () => undefined,
  };
}

function createConfiguredConfigManager(cwd: string, agentDir: string): ConfigManager {
  const values: Record<string, unknown> = {
    anthropicApiKey: 'test-key',
    defaultModel: 'claude-sonnet-4-20250514',
  };

  return new ConfigManager({
    cwd,
    agentDir,
    getConfiguration: () =>
      ({
        get: <T>(key: string) => values[key] as T,
        has: (key: string) => key in values,
        inspect: () => undefined,
        update: async () => undefined,
      }) as never,
  });
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createFakeAgentSession(session: Session, calls: string[] = []): AgentSession {
  const fake = {
    sessionManager: session,
    sessionFile: session.getSessionFile(),
    sessionId: session.getSessionId(),
    parentSessionPath: session.getMetadata().parentSessionPath,
    leafId: session.getLeafId(),
    model: undefined,
    thinkingLevel: 'off',
    isStreaming: false,
    emitSessionBeforeSwitch: vi.fn(async () => false),
    emitSessionShutdown: vi.fn(async () => undefined),
    bindExtensions: vi.fn(async () => []),
    subscribe: vi.fn(() => () => undefined),
    dispose: vi.fn(() => undefined),
    createReplacedSessionContext: vi.fn(() => ({
      sessionManager: session,
      sendMessage: vi.fn(async () => undefined),
      sendUserMessage: vi.fn(async () => {
        calls.push('sendUserMessage');
      }),
    })),
  };
  return fake as unknown as AgentSession;
}

describe('ExtensionSessionCoordinator lifecycle', () => {
  let tempDir: string;
  let cwd: string;
  let agentDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-session-coordinator-test-'));
    cwd = path.join(tempDir, 'project');
    agentDir = path.join(tempDir, 'agent');
    fs.mkdirSync(path.join(cwd, '.scout', 'extensions'), { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('preserves newSession options when creating the initial runtime', async () => {
    fs.writeFileSync(
      path.join(cwd, '.scout', 'extensions', 'lifecycle.ts'),
      `export default function(scout) {
        scout.on("session_start", async (event) => {
          await scout.appendEntry("session-start", { reason: event.reason });
        });
      }`,
    );

    const parentSession = path.join(tempDir, 'parent.jsonl');
    const coordinator = new ExtensionSessionCoordinator({
      cwd,
      agentDir,
      outputChannel: createOutputChannel() as never,
      configManager: createConfiguredConfigManager(cwd, agentDir),
    });
    let setupSawParentSession: string | undefined;
    let withSessionEntries: unknown[] = [];

    const result = await coordinator.newSession({
      parentSession,
      setup: async (session) => {
        setupSawParentSession = session.getMetadata().parentSessionPath;
        session.appendMessage(userMessage('seeded setup message'));
      },
      withSession: async (ctx) => {
        withSessionEntries = ctx.sessionManager.getEntries();
      },
    });

    expect(result.cancelled).toBe(false);
    expect(coordinator.parentSessionPath).toBe(parentSession);
    expect(setupSawParentSession).toBe(parentSession);

    const seededMessage = withSessionEntries.find(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { type?: string }).type === 'message' &&
        (entry as { message?: { content?: unknown } }).message?.content === 'seeded setup message',
    ) as { id: string } | undefined;
    const sessionStartEntry = withSessionEntries.find(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { type?: string }).type === 'custom' &&
        (entry as { customType?: string }).customType === 'session-start',
    ) as { parentId: string | null; data?: { reason?: string } } | undefined;

    expect(seededMessage).toBeDefined();
    expect(sessionStartEntry).toMatchObject({
      parentId: seededMessage?.id,
      data: { reason: 'new' },
    });

    await coordinator.disposeAsync();
  });

  it('routes webview prompts to steer or followUp while the session is streaming', async () => {
    const coordinator = new ExtensionSessionCoordinator({
      cwd,
      agentDir,
      outputChannel: createOutputChannel() as never,
      configManager: createConfiguredConfigManager(cwd, agentDir),
    });
    const prompt = vi.fn();
    const steer = vi.fn();
    const followUp = vi.fn();
    (coordinator as unknown as { agentSession: unknown }).agentSession = {
      isStreaming: true,
      prompt,
      steer,
      followUp,
    };

    await coordinator.prompt('turn now');
    await coordinator.prompt('after turn', { deliverAs: 'followUp' });

    expect(steer).toHaveBeenCalledWith('turn now');
    expect(followUp).toHaveBeenCalledWith('after turn');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('serializes session replacement operations', async () => {
    const coordinator = new ExtensionSessionCoordinator({
      cwd,
      agentDir,
      outputChannel: createOutputChannel() as never,
      configManager: createConfiguredConfigManager(cwd, agentDir),
    });
    const releaseNewSession = createDeferred();
    const calls: string[] = [];
    const fakeRuntime = {
      cwd,
      diagnostics: [],
      modelFallbackMessage: undefined,
      newSession: vi.fn(async () => {
        calls.push('new:start');
        await releaseNewSession.promise;
        calls.push('new:end');
        return { cancelled: false };
      }),
      switchSession: vi.fn(async () => {
        calls.push('restore:start');
        calls.push('restore:end');
        return { cancelled: false };
      }),
      dispose: vi.fn(async () => undefined),
    };
    (coordinator as unknown as { sessionRuntime: unknown }).sessionRuntime = fakeRuntime;

    const newSessionPromise = coordinator.newSession();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(['new:start']);

    const restorePromise = coordinator.restore({
      id: 'restored-session',
      path: path.join(tempDir, 'restored-session.jsonl'),
      cwd,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual(['new:start']);

    releaseNewSession.resolve();
    await Promise.all([newSessionPromise, restorePromise]);

    expect(calls).toEqual(['new:start', 'new:end', 'restore:start', 'restore:end']);
    expect(fakeRuntime.switchSession).toHaveBeenCalledOnce();

    await coordinator.disposeAsync();
  });

  it('skips queued stale user session operations before replacement side effects', async () => {
    const coordinator = new ExtensionSessionCoordinator({
      cwd,
      agentDir,
      outputChannel: createOutputChannel() as never,
      configManager: createConfiguredConfigManager(cwd, agentDir),
    });
    const releaseBlockingNewSession = createDeferred();
    const calls: string[] = [];
    const fakeRuntime = {
      cwd,
      diagnostics: [],
      modelFallbackMessage: undefined,
      newSession: vi.fn(async () => {
        calls.push('new:block:start');
        await releaseBlockingNewSession.promise;
        calls.push('new:block:end');
        return { cancelled: false };
      }),
      switchSession: vi.fn(async () => {
        calls.push('restore:start');
        calls.push('restore:end');
        return { cancelled: false };
      }),
      dispose: vi.fn(async () => undefined),
    };
    (coordinator as unknown as { sessionRuntime: unknown }).sessionRuntime = fakeRuntime;

    const blockingNewSession = coordinator.newSession();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(['new:block:start']);

    const staleToken = coordinator.beginUserSessionOperation(
      'new_session_message',
      'request-stale',
    );
    const staleNewSession = coordinator.newUserSession(staleToken, {
      withSession: async () => {
        calls.push('stale:withSession');
      },
    });
    const latestToken = coordinator.beginUserSessionOperation('open_task', 'request-latest');
    const latestRestore = coordinator.restoreUserSession(latestToken, {
      id: 'restored-session',
      path: path.join(tempDir, 'restored-session.jsonl'),
      cwd,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual(['new:block:start']);

    releaseBlockingNewSession.resolve();
    const [, staleResult, latestResult] = await Promise.all([
      blockingNewSession,
      staleNewSession,
      latestRestore,
    ]);

    expect(staleResult).toMatchObject({
      status: 'stale',
      id: 'request-stale',
      kind: 'new_session_message',
    });
    expect(latestResult).toMatchObject({
      status: 'completed',
      id: 'request-latest',
      kind: 'open_task',
    });
    expect(fakeRuntime.newSession).toHaveBeenCalledTimes(1);
    expect(fakeRuntime.switchSession).toHaveBeenCalledOnce();
    expect(calls).toEqual([
      'new:block:start',
      'new:block:end',
      'restore:start',
      'restore:end',
    ]);

    await coordinator.disposeAsync();
  });

  it('guards new session withSession when a running user operation becomes stale', async () => {
    const coordinator = new ExtensionSessionCoordinator({
      cwd,
      agentDir,
      outputChannel: createOutputChannel() as never,
      configManager: createConfiguredConfigManager(cwd, agentDir),
    });
    const calls: string[] = [];
    const fakeRuntime = {
      cwd,
      diagnostics: [],
      modelFallbackMessage: undefined,
      newSession: vi.fn(async (options?: { withSession?: (ctx: unknown) => Promise<void> }) => {
        calls.push('new:start');
        coordinator.beginUserSessionOperation('open_task', 'request-latest');
        await options?.withSession?.({
          sendUserMessage: async () => {
            calls.push('sendUserMessage');
          },
        });
        calls.push('new:end');
        return { cancelled: false };
      }),
      switchSession: vi.fn(async () => ({ cancelled: false })),
      dispose: vi.fn(async () => undefined),
    };
    (coordinator as unknown as { sessionRuntime: unknown }).sessionRuntime = fakeRuntime;

    const staleToken = coordinator.beginUserSessionOperation(
      'new_session_message',
      'request-stale',
    );
    const result = await coordinator.newUserSession(staleToken, {
      withSession: async (ctx) => {
        calls.push('withSession');
        await ctx.sendUserMessage('queued prompt');
      },
    });

    expect(result).toMatchObject({
      status: 'stale',
      id: 'request-stale',
      kind: 'new_session_message',
    });
    expect(calls).toEqual(['new:start', 'new:end']);

    await coordinator.disposeAsync();
  });

  it('waits for in-flight initialization before running newSession withSession', async () => {
    const coordinator = new ExtensionSessionCoordinator({
      cwd,
      agentDir,
      outputChannel: createOutputChannel() as never,
      configManager: createConfiguredConfigManager(cwd, agentDir),
    });
    const releaseStartup = createDeferred();
    const calls: string[] = [];
    (
      coordinator as unknown as {
        createRuntime: ExtensionSessionCoordinator['createRuntime'];
      }
    ).createRuntime = async ({ session, sessionStartEvent }) => {
      calls.push(`create:${sessionStartEvent?.reason}`);
      if (sessionStartEvent?.reason === 'startup') {
        await releaseStartup.promise;
      }
      return {
        session: createFakeAgentSession(session, calls),
        diagnostics: [],
      };
    };

    const initializePromise = coordinator.initialize();
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual(['create:startup']);

    const newSessionPromise = coordinator.newSession({
      withSession: async (ctx) => {
        calls.push('withSession');
        await ctx.sendUserMessage('queued prompt');
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual(['create:startup']);

    releaseStartup.resolve();
    await Promise.all([initializePromise, newSessionPromise]);

    expect(calls).toEqual([
      'create:startup',
      'create:new',
      'withSession',
      'sendUserMessage',
    ]);

    await coordinator.disposeAsync();
  });
});

describe('session tree mapper', () => {
  it('hides metadata nodes and keeps visible descendants under the nearest visible parent', () => {
    const tree: SessionTreeNode[] = [
      {
        entry: {
          type: 'message',
          id: 'root',
          parentId: null,
          timestamp: '2026-01-01T00:00:00.000Z',
          message: userMessage('root prompt'),
        },
        label: 'Root',
        children: [
          {
            entry: {
              type: 'label',
              id: 'label-meta',
              parentId: 'root',
              timestamp: '2026-01-01T00:00:01.000Z',
              targetId: 'root',
              label: 'Root',
            },
            children: [
              {
                entry: {
                  type: 'message',
                  id: 'assistant',
                  parentId: 'label-meta',
                  timestamp: '2026-01-01T00:00:02.000Z',
                  message: assistantMessage('assistant reply'),
                },
                children: [],
              },
            ],
          },
        ],
      },
    ];

    expect(mapSessionTreeToScout(tree)).toEqual([
      {
        id: 'root',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'message',
        kind: 'user',
        role: 'user',
        label: 'Root',
        labelTimestamp: undefined,
        preview: 'root prompt',
        children: [
          {
            id: 'assistant',
            parentId: 'root',
            timestamp: '2026-01-01T00:00:02.000Z',
            type: 'message',
            kind: 'assistant',
            role: 'assistant',
            label: undefined,
            labelTimestamp: undefined,
            preview: 'assistant reply',
            children: [],
          },
        ],
      },
    ]);
    expect(resolveVisibleSessionLeafId(tree, 'label-meta')).toBe('root');
    expect(resolveVisibleSessionLeafId(tree, 'assistant')).toBe('assistant');
  });

  it('resolves hidden session metadata leaves to the nearest visible ancestor', () => {
    const tree: SessionTreeNode[] = [
      {
        entry: {
          type: 'message',
          id: 'root',
          parentId: null,
          timestamp: '2026-01-01T00:00:00.000Z',
          message: userMessage('root prompt'),
        },
        children: [
          {
            entry: {
              type: 'session_info',
              id: 'session-name',
              parentId: 'root',
              timestamp: '2026-01-01T00:00:01.000Z',
              name: 'Named session',
            },
            children: [
              {
                entry: {
                  type: 'model_change',
                  id: 'model-change',
                  parentId: 'session-name',
                  timestamp: '2026-01-01T00:00:02.000Z',
                  provider: 'openai',
                  modelId: 'gpt-test',
                },
                children: [
                  {
                    entry: {
                      type: 'thinking_level_change',
                      id: 'thinking-change',
                      parentId: 'model-change',
                      timestamp: '2026-01-01T00:00:03.000Z',
                      thinkingLevel: 'low',
                    },
                    children: [
                      {
                        entry: {
                          type: 'custom',
                          id: 'custom-meta',
                          parentId: 'thinking-change',
                          timestamp: '2026-01-01T00:00:04.000Z',
                          customType: 'extension-state',
                          data: { ready: true },
                        },
                        children: [
                          {
                            entry: {
                              type: 'message',
                              id: 'assistant',
                              parentId: 'custom-meta',
                              timestamp: '2026-01-01T00:00:05.000Z',
                              message: assistantMessage('assistant reply'),
                            },
                            children: [],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    expect(mapSessionTreeToScout(tree)).toEqual([
      {
        id: 'root',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'message',
        kind: 'user',
        role: 'user',
        label: undefined,
        labelTimestamp: undefined,
        preview: 'root prompt',
        children: [
          {
            id: 'assistant',
            parentId: 'root',
            timestamp: '2026-01-01T00:00:05.000Z',
            type: 'message',
            kind: 'assistant',
            role: 'assistant',
            label: undefined,
            labelTimestamp: undefined,
            preview: 'assistant reply',
            children: [],
          },
        ],
      },
    ]);
    expect(resolveVisibleSessionLeafId(tree, 'session-name')).toBe('root');
    expect(resolveVisibleSessionLeafId(tree, 'model-change')).toBe('root');
    expect(resolveVisibleSessionLeafId(tree, 'thinking-change')).toBe('root');
    expect(resolveVisibleSessionLeafId(tree, 'custom-meta')).toBe('root');
    expect(resolveVisibleSessionLeafId(tree, 'assistant')).toBe('assistant');
  });

  it('only exposes displayable custom messages in the webview tree', () => {
    const tree: SessionTreeNode[] = [
      {
        entry: {
          type: 'message',
          id: 'root',
          parentId: null,
          timestamp: '2026-01-01T00:00:00.000Z',
          message: userMessage('root prompt'),
        },
        children: [
          {
            entry: {
              type: 'custom_message',
              id: 'hidden-custom',
              parentId: 'root',
              timestamp: '2026-01-01T00:00:01.000Z',
              customType: 'hidden',
              content: 'hidden content',
              display: false,
            },
            children: [
              {
                entry: {
                  type: 'custom_message',
                  id: 'visible-custom',
                  parentId: 'hidden-custom',
                  timestamp: '2026-01-01T00:00:02.000Z',
                  customType: 'visible',
                  content: 'visible content',
                  display: true,
                },
                children: [],
              },
            ],
          },
        ],
      },
    ];

    expect(mapSessionTreeToScout(tree)).toEqual([
      {
        id: 'root',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'message',
        kind: 'user',
        role: 'user',
        label: undefined,
        labelTimestamp: undefined,
        preview: 'root prompt',
        children: [
          {
            id: 'visible-custom',
            parentId: 'root',
            timestamp: '2026-01-01T00:00:02.000Z',
            type: 'custom_message',
            kind: 'custom',
            role: undefined,
            label: undefined,
            labelTimestamp: undefined,
            preview: 'visible content',
            children: [],
          },
        ],
      },
    ]);
    expect(resolveVisibleSessionLeafId(tree, 'hidden-custom')).toBe('root');
    expect(resolveVisibleSessionLeafId(tree, 'visible-custom')).toBe('visible-custom');
  });
});
