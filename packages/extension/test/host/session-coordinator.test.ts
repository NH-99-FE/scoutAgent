import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtensionSessionCoordinator } from '../../src/host/session-coordinator.ts';
import { ConfigManager } from '../../src/config-manager.ts';
import type { AgentSession } from '../../src/core/agent-session.ts';
import type { FileReviewTurnSnapshot } from '../../src/core/review/file-review.ts';
import {
  mapSessionTreeToScout,
  projectSessionTreeToScout,
  resolveVisibleSessionLeafId,
} from '../../src/host/protocol/session-tree-mapper.ts';
import type { Session, SessionTreeEntry, SessionTreeNode } from '../../src/core/session/index.ts';
import {
  createFileReviewArtifact,
  FILE_REVIEW_ARTIFACT_CUSTOM_TYPE,
  MAX_REVIEW_ARTIFACT_FILES,
  type FileReviewArtifact,
} from '../../src/host/review/file-review-artifact.ts';
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

function createConfiguredConfigManager(cwd: string, userConfigDir: string): ConfigManager {
  fs.writeFileSync(
    path.join(userConfigDir, 'settings.json'),
    JSON.stringify({
      defaultProvider: 'anthropic',
      defaultModel: 'claude-sonnet-4-20250514',
    }),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(userConfigDir, 'models.json'),
    JSON.stringify({
      providers: {
        anthropic: { apiKey: 'test-key' },
      },
    }),
    'utf-8',
  );

  return new ConfigManager({
    cwd,
    userConfigDir,
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

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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
    getActiveToolNames: vi.fn(() => ['read']),
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

function makeReviewSnapshot(): FileReviewTurnSnapshot {
  return {
    turnId: 'turn-1',
    records: [
      {
        recordId: 'review-1',
        turnId: 'turn-1',
        toolCallId: 'tool-1',
        operation: 'edit',
        path: 'src/app.ts',
        absolutePath: '/workspace/src/app.ts',
        sequence: 1,
      },
    ],
    files: [
      {
        absolutePath: '/workspace/src/app.ts',
        path: 'src/app.ts',
        originalContent: 'old\n',
        modifiedContent: 'new\n',
        recordIds: ['review-1'],
        latestRecordId: 'review-1',
        latestSequence: 1,
        additions: 1,
        deletions: 1,
      },
    ],
  };
}

function makeLargeFileCountReviewSnapshot(): FileReviewTurnSnapshot {
  const records = Array.from({ length: MAX_REVIEW_ARTIFACT_FILES + 1 }, (_, index) => {
    const sequence = index + 1;
    return {
      recordId: `review-${sequence}`,
      turnId: 'turn-large',
      toolCallId: `tool-${sequence}`,
      operation: 'edit' as const,
      path: `src/file-${sequence}.ts`,
      absolutePath: `/workspace/src/file-${sequence}.ts`,
      sequence,
    };
  });
  return {
    turnId: 'turn-large',
    records,
    files: records.map((record) => ({
      absolutePath: record.absolutePath,
      path: record.path,
      originalContent: 'old\n',
      modifiedContent: 'new\n',
      recordIds: [record.recordId],
      latestRecordId: record.recordId,
      latestSequence: record.sequence,
      additions: 1,
      deletions: 1,
    })),
  };
}

describe('ExtensionSessionCoordinator lifecycle', () => {
  let tempDir: string;
  let cwd: string;
  let agentDir: string;
  let userConfigDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-session-coordinator-test-'));
    cwd = path.join(tempDir, 'project');
    agentDir = path.join(tempDir, 'agent');
    userConfigDir = path.join(tempDir, 'user-config');
    fs.mkdirSync(path.join(cwd, '.scout', 'extensions'), { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });
    fs.mkdirSync(userConfigDir, { recursive: true });
  });

  afterEach(() => {
    vi.useRealTimers();
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
      configManager: createConfiguredConfigManager(cwd, userConfigDir),
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
      configManager: createConfiguredConfigManager(cwd, userConfigDir),
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

  it('returns protocol-projected tree data with a visible leaf id', async () => {
    const coordinator = new ExtensionSessionCoordinator({
      cwd,
      agentDir,
      outputChannel: createOutputChannel() as never,
      configManager: createConfiguredConfigManager(cwd, userConfigDir),
    });
    const rawTree: SessionTreeNode[] = [
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
              type: 'message',
              id: 'assistant-tool-call',
              parentId: 'root',
              timestamp: '2026-01-01T00:00:01.000Z',
              message: assistantMessage('', {
                content: [
                  {
                    type: 'toolCall',
                    id: 'read-1',
                    name: 'read',
                    arguments: { path: 'src/a.ts' },
                  },
                ],
                stopReason: 'toolUse',
              }),
            },
            children: [],
          },
        ],
      },
    ];
    (coordinator as unknown as { agentSession: unknown }).agentSession = {
      getTree: vi.fn(async () => rawTree),
      leafId: 'assistant-tool-call',
    };

    const result = await coordinator.getTreeData();

    expect(result.tree[0]!.children).toEqual([]);
    expect(result.leafId).toBe('root');
  });

  it('persists review artifacts as hidden custom entries and releases runtime content', async () => {
    const coordinator = new ExtensionSessionCoordinator({
      cwd,
      agentDir,
      outputChannel: createOutputChannel() as never,
      configManager: createConfiguredConfigManager(cwd, userConfigDir),
    });
    const branch: SessionTreeEntry[] = [
      {
        type: 'message',
        id: 'assistant',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: assistantMessage('done'),
      },
    ];
    const releaseFileReviewTurnContent = vi.fn();
    const appendEntry = vi.fn(async (customType: string, data: unknown) => {
      branch.push({
        type: 'custom',
        customType,
        data,
        id: 'review-artifact',
        parentId: 'assistant',
        timestamp: '2026-01-01T00:00:01.000Z',
      });
    });
    (coordinator as unknown as { agentSession: unknown }).agentSession = {
      appendEntry,
      getSessionEntries: () => branch,
      getSessionBranch: () => branch,
      isStreaming: false,
      releaseFileReviewTurnContent,
      sessionId: 'session-1',
    };
    const review = makeReviewSnapshot();
    const agentSession = (coordinator as unknown as { agentSession: AgentSession }).agentSession;

    (
      coordinator as unknown as {
        scheduleFileReviewArtifactSave: (
          agentSession: AgentSession,
          review: FileReviewTurnSnapshot,
        ) => void;
        flushFileReviewArtifactSaves: () => Promise<void>;
      }
    ).scheduleFileReviewArtifactSave(agentSession, review);
    await (
      coordinator as unknown as {
        flushFileReviewArtifactSaves: () => Promise<void>;
      }
    ).flushFileReviewArtifactSaves();

    expect(appendEntry).toHaveBeenCalledWith(
      FILE_REVIEW_ARTIFACT_CUSTOM_TYPE,
      expect.objectContaining({ turnId: 'turn-1' }),
    );
    expect(releaseFileReviewTurnContent).toHaveBeenCalledWith('turn-1');
    await expect(coordinator.getFileReviewArtifact('turn-1')).resolves.toMatchObject({
      turnId: 'turn-1',
      files: [expect.objectContaining({ path: 'src/app.ts' })],
    });
    expect(coordinator.isLatestFileReviewArtifact('turn-1')).toBe(true);
  });

  it('finds hidden review artifact children after navigating back to the visible branch entry', async () => {
    const coordinator = new ExtensionSessionCoordinator({
      cwd,
      agentDir,
      outputChannel: createOutputChannel() as never,
      configManager: createConfiguredConfigManager(cwd, userConfigDir),
    });
    const assistantEntry: SessionTreeEntry = {
      type: 'message',
      id: 'assistant',
      parentId: null,
      timestamp: '2026-01-01T00:00:00.000Z',
      message: assistantMessage('done'),
    };
    const artifact = createFileReviewArtifact('session-1', makeReviewSnapshot());
    const allEntries: SessionTreeEntry[] = [
      assistantEntry,
      {
        type: 'custom',
        customType: FILE_REVIEW_ARTIFACT_CUSTOM_TYPE,
        data: artifact,
        id: 'review-artifact',
        parentId: 'assistant',
        timestamp: '2026-01-01T00:00:01.000Z',
      },
    ];
    const branchAfterNavigation: SessionTreeEntry[] = [assistantEntry];
    (coordinator as unknown as { agentSession: unknown }).agentSession = {
      getSessionEntries: () => allEntries,
      getSessionBranch: () => branchAfterNavigation,
      isStreaming: false,
      sessionId: 'session-1',
    };

    await expect(coordinator.getFileReviewArtifact('turn-1')).resolves.toMatchObject({
      turnId: 'turn-1',
    });
    expect(coordinator.isLatestFileReviewArtifact('turn-1')).toBe(true);
  });

  it('persists bounded review artifacts and releases runtime content when raw artifacts exceed limits', async () => {
    const coordinator = new ExtensionSessionCoordinator({
      cwd,
      agentDir,
      outputChannel: createOutputChannel() as never,
      configManager: createConfiguredConfigManager(cwd, userConfigDir),
    });
    const branch: SessionTreeEntry[] = [
      {
        type: 'message',
        id: 'assistant',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: assistantMessage('done'),
      },
    ];
    const releaseFileReviewTurnContent = vi.fn();
    let persistedArtifact: FileReviewArtifact | undefined;
    const appendEntry = vi.fn(async (customType: string, data: unknown) => {
      persistedArtifact = data as FileReviewArtifact;
      branch.push({
        type: 'custom',
        customType,
        data,
        id: 'bounded-review-artifact',
        parentId: 'assistant',
        timestamp: '2026-01-01T00:00:01.000Z',
      });
    });
    (coordinator as unknown as { agentSession: unknown }).agentSession = {
      appendEntry,
      getSessionEntries: () => branch,
      getSessionBranch: () => branch,
      isStreaming: false,
      releaseFileReviewTurnContent,
      sessionId: 'session-1',
    };
    const agentSession = (coordinator as unknown as { agentSession: AgentSession }).agentSession;
    const review = makeLargeFileCountReviewSnapshot();

    (
      coordinator as unknown as {
        scheduleFileReviewArtifactSave: (
          agentSession: AgentSession,
          review: FileReviewTurnSnapshot,
        ) => void;
        flushFileReviewArtifactSaves: () => Promise<void>;
      }
    ).scheduleFileReviewArtifactSave(agentSession, review);
    await (
      coordinator as unknown as {
        flushFileReviewArtifactSaves: () => Promise<void>;
      }
    ).flushFileReviewArtifactSaves();

    expect(appendEntry).toHaveBeenCalledWith(
      FILE_REVIEW_ARTIFACT_CUSTOM_TYPE,
      expect.objectContaining({ turnId: 'turn-large' }),
    );
    expect(persistedArtifact?.files).toHaveLength(MAX_REVIEW_ARTIFACT_FILES);
    expect(persistedArtifact?.records).toHaveLength(MAX_REVIEW_ARTIFACT_FILES);
    expect(releaseFileReviewTurnContent).toHaveBeenCalledWith('turn-large');
  });

  it('does not persist a late review update into a newer active session', async () => {
    const coordinator = new ExtensionSessionCoordinator({
      cwd,
      agentDir,
      outputChannel: createOutputChannel() as never,
      configManager: createConfiguredConfigManager(cwd, userConfigDir),
    });
    const staleAppendEntry = vi.fn(async () => undefined);
    const staleReleaseFileReviewTurnContent = vi.fn();
    const staleSession = {
      appendEntry: staleAppendEntry,
      isStreaming: false,
      releaseFileReviewTurnContent: staleReleaseFileReviewTurnContent,
      sessionId: 'old-session',
    } as unknown as AgentSession;
    const activeAppendEntry = vi.fn(async () => undefined);
    (coordinator as unknown as { agentSession: unknown }).agentSession = {
      appendEntry: activeAppendEntry,
      getSessionEntries: () => [],
      getSessionBranch: () => [],
      isStreaming: false,
      releaseFileReviewTurnContent: vi.fn(),
      sessionId: 'new-session',
    };

    (
      coordinator as unknown as {
        scheduleFileReviewArtifactSave: (
          agentSession: AgentSession,
          review: FileReviewTurnSnapshot,
        ) => void;
        flushFileReviewArtifactSaves: () => Promise<void>;
      }
    ).scheduleFileReviewArtifactSave(staleSession, makeReviewSnapshot());
    await (
      coordinator as unknown as {
        flushFileReviewArtifactSaves: () => Promise<void>;
      }
    ).flushFileReviewArtifactSaves();

    expect(staleAppendEntry).not.toHaveBeenCalled();
    expect(activeAppendEntry).not.toHaveBeenCalled();
    expect(staleReleaseFileReviewTurnContent).not.toHaveBeenCalled();
  });

  it('flushes pending review artifacts before clearing the active session on dispose', async () => {
    const coordinator = new ExtensionSessionCoordinator({
      cwd,
      agentDir,
      outputChannel: createOutputChannel() as never,
      configManager: createConfiguredConfigManager(cwd, userConfigDir),
    });
    const releaseFileReviewTurnContent = vi.fn();
    const appendEntry = vi.fn(async () => undefined);
    const dispose = vi.fn();
    (coordinator as unknown as { agentSession: unknown }).agentSession = {
      appendEntry,
      dispose,
      getSessionEntries: () => [],
      getSessionBranch: () => [],
      isStreaming: false,
      releaseFileReviewTurnContent,
      sessionId: 'session-1',
    };
    const agentSession = (coordinator as unknown as { agentSession: AgentSession }).agentSession;

    (
      coordinator as unknown as {
        scheduleFileReviewArtifactSave: (
          agentSession: AgentSession,
          review: FileReviewTurnSnapshot,
        ) => void;
      }
    ).scheduleFileReviewArtifactSave(agentSession, makeReviewSnapshot());

    await coordinator.disposeAsync();

    expect(appendEntry).toHaveBeenCalledWith(
      FILE_REVIEW_ARTIFACT_CUSTOM_TYPE,
      expect.objectContaining({ turnId: 'turn-1' }),
    );
    expect(releaseFileReviewTurnContent).toHaveBeenCalledWith('turn-1');
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('flushes debounced review artifacts from the idle lifecycle state', async () => {
    vi.useFakeTimers();
    const coordinator = new ExtensionSessionCoordinator({
      cwd,
      agentDir,
      outputChannel: createOutputChannel() as never,
      configManager: createConfiguredConfigManager(cwd, userConfigDir),
    });
    const releaseFileReviewTurnContent = vi.fn();
    const appendEntry = vi.fn(async () => undefined);
    let isStreaming = true;
    const agentSession = {
      appendEntry,
      getSessionEntries: () => [],
      getSessionBranch: () => [],
      get isStreaming() {
        return isStreaming;
      },
      releaseFileReviewTurnContent,
      sessionId: 'session-1',
    } as unknown as AgentSession;
    (coordinator as unknown as { agentSession: AgentSession }).agentSession = agentSession;

    (
      coordinator as unknown as {
        scheduleFileReviewArtifactSave: (
          agentSession: AgentSession,
          review: FileReviewTurnSnapshot,
        ) => void;
      }
    ).scheduleFileReviewArtifactSave(agentSession, makeReviewSnapshot());

    vi.advanceTimersByTime(100);
    await flushPromises();

    expect(appendEntry).not.toHaveBeenCalled();

    isStreaming = false;
    (
      coordinator as unknown as {
        forwardAgentSessionEvent: (event: { type: 'state_change' }) => void;
      }
    ).forwardAgentSessionEvent({ type: 'state_change' });
    await flushPromises();

    expect(appendEntry).toHaveBeenCalledWith(
      FILE_REVIEW_ARTIFACT_CUSTOM_TYPE,
      expect.objectContaining({ turnId: 'turn-1' }),
    );
    expect(releaseFileReviewTurnContent).toHaveBeenCalledWith('turn-1');
  });

  it('flushes pending review artifacts before exporting the active session', async () => {
    const coordinator = new ExtensionSessionCoordinator({
      cwd,
      agentDir,
      outputChannel: createOutputChannel() as never,
      configManager: createConfiguredConfigManager(cwd, userConfigDir),
    });
    const appendEntry = vi.fn(async () => undefined);
    const exportToJsonl = vi.fn(() => '/workspace/export.jsonl');
    (coordinator as unknown as { agentSession: unknown }).agentSession = {
      appendEntry,
      exportToJsonl,
      getSessionEntries: () => [],
      getSessionBranch: () => [],
      isStreaming: false,
      releaseFileReviewTurnContent: vi.fn(),
      sessionId: 'session-1',
    };
    const agentSession = (coordinator as unknown as { agentSession: AgentSession }).agentSession;

    (
      coordinator as unknown as {
        scheduleFileReviewArtifactSave: (
          agentSession: AgentSession,
          review: FileReviewTurnSnapshot,
        ) => void;
      }
    ).scheduleFileReviewArtifactSave(agentSession, makeReviewSnapshot());

    await expect(coordinator.exportSessionToJsonl('/workspace/export.jsonl')).resolves.toBe(
      '/workspace/export.jsonl',
    );

    expect(appendEntry).toHaveBeenCalledWith(
      FILE_REVIEW_ARTIFACT_CUSTOM_TYPE,
      expect.objectContaining({ turnId: 'turn-1' }),
    );
    expect(exportToJsonl).toHaveBeenCalledWith('/workspace/export.jsonl');
    expect(appendEntry.mock.invocationCallOrder[0]).toBeLessThan(
      exportToJsonl.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('serializes session replacement operations', async () => {
    const coordinator = new ExtensionSessionCoordinator({
      cwd,
      agentDir,
      outputChannel: createOutputChannel() as never,
      configManager: createConfiguredConfigManager(cwd, userConfigDir),
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
      configManager: createConfiguredConfigManager(cwd, userConfigDir),
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

    const staleToken = coordinator.beginUserSessionOperation('new_session_message');
    const staleNewSession = coordinator.newUserSession(staleToken, {
      withSession: async () => {
        calls.push('stale:withSession');
      },
    });
    const latestToken = coordinator.beginUserSessionOperation('open_task');
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
      id: 'new_session_message:1',
      kind: 'new_session_message',
    });
    expect(latestResult).toMatchObject({
      status: 'completed',
      id: 'open_task:2',
      kind: 'open_task',
    });
    expect(fakeRuntime.newSession).toHaveBeenCalledTimes(1);
    expect(fakeRuntime.switchSession).toHaveBeenCalledOnce();
    expect(calls).toEqual(['new:block:start', 'new:block:end', 'restore:start', 'restore:end']);

    await coordinator.disposeAsync();
  });

  it('guards new session withSession when a running user operation becomes stale', async () => {
    const coordinator = new ExtensionSessionCoordinator({
      cwd,
      agentDir,
      outputChannel: createOutputChannel() as never,
      configManager: createConfiguredConfigManager(cwd, userConfigDir),
    });
    const calls: string[] = [];
    const fakeRuntime = {
      cwd,
      diagnostics: [],
      modelFallbackMessage: undefined,
      newSession: vi.fn(async (options?: { withSession?: (ctx: unknown) => Promise<void> }) => {
        calls.push('new:start');
        coordinator.beginUserSessionOperation('open_task');
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

    const staleToken = coordinator.beginUserSessionOperation('new_session_message');
    const result = await coordinator.newUserSession(staleToken, {
      withSession: async (ctx) => {
        calls.push('withSession');
        await ctx.sendUserMessage('queued prompt');
      },
    });

    expect(result).toMatchObject({
      status: 'stale',
      id: 'new_session_message:1',
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
      configManager: createConfiguredConfigManager(cwd, userConfigDir),
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

    expect(calls).toEqual(['create:startup', 'create:new', 'withSession', 'sendUserMessage']);

    await coordinator.disposeAsync();
  });

  it('extracts every user message from the root-to-leaf raw branch as fork candidates', () => {
    const coordinator = new ExtensionSessionCoordinator({
      cwd,
      agentDir,
      outputChannel: createOutputChannel() as never,
      configManager: createConfiguredConfigManager(cwd, userConfigDir),
    });

    // raw 分支按 root-to-leaf 排序：含压缩点之前的旧 user message + 结构化内容 user message。
    // getForkCandidates 读取的是 raw branch（getSessionBranch），不经过压缩展示投影，
    // 因此压缩点前的 'old prompt' 仍应作为候选返回。
    const branch = [
      {
        type: 'message',
        id: 'u1',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: userMessage('old prompt'),
      },
      {
        type: 'message',
        id: 'a1',
        parentId: 'u1',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: assistantMessage('reply'),
      },
      {
        type: 'compaction',
        id: 'c1',
        parentId: 'a1',
        timestamp: '2026-01-01T00:00:02.000Z',
        firstKeptEntryId: 'u2',
        summary: 'summary',
      },
      {
        type: 'message',
        id: 'u2',
        parentId: 'c1',
        timestamp: '2026-01-01T00:00:03.000Z',
        message: {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: 'kept ' },
            { type: 'image' as const, data: 'base64', mimeType: 'image/png' },
            { type: 'text' as const, text: 'prompt' },
          ],
          timestamp: 4,
        },
      },
    ];
    (coordinator as unknown as { agentSession: unknown }).agentSession = {
      getSessionBranch: () => branch,
    };

    expect(coordinator.getForkCandidates()).toEqual([
      { entryId: 'u1', text: 'old prompt' },
      { entryId: 'u2', text: 'kept prompt' },
    ]);
  });

  it('returns no fork candidates when there is no active session', () => {
    const coordinator = new ExtensionSessionCoordinator({
      cwd,
      agentDir,
      outputChannel: createOutputChannel() as never,
      configManager: createConfiguredConfigManager(cwd, userConfigDir),
    });
    expect(coordinator.getForkCandidates()).toEqual([]);
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
        toolCall: undefined,
        stopReason: undefined,
        errorMessage: undefined,
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
            toolCall: undefined,
            stopReason: 'stop',
            errorMessage: undefined,
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

  it('does not expose assistant tool-call placeholders as visible tree nodes', () => {
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
              type: 'message',
              id: 'assistant-tool-call',
              parentId: 'root',
              timestamp: '2026-01-01T00:00:01.000Z',
              message: assistantMessage('', {
                content: [
                  {
                    type: 'toolCall',
                    id: 'read-1',
                    name: 'read',
                    arguments: { path: 'src/a.ts' },
                  },
                ],
                stopReason: 'toolUse',
              }),
            },
            children: [],
          },
        ],
      },
    ];

    const projection = projectSessionTreeToScout(tree, 'assistant-tool-call');

    expect(projection.tree[0]!.children).toEqual([]);
    expect(projection.leafId).toBe('root');
  });

  it('does not expose empty non-failure assistant messages as visible tree nodes', () => {
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
              type: 'message',
              id: 'assistant-empty',
              parentId: 'root',
              timestamp: '2026-01-01T00:00:01.000Z',
              message: assistantMessage('', { content: [], stopReason: 'stop' }),
            },
            children: [],
          },
        ],
      },
    ];

    const projection = projectSessionTreeToScout(tree, 'assistant-empty');

    expect(projection.tree[0]!.children).toEqual([]);
    expect(projection.leafId).toBe('root');
  });

  it('uses the first non-empty assistant text line as the visible preview', () => {
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
              type: 'message',
              id: 'assistant-text',
              parentId: 'root',
              timestamp: '2026-01-01T00:00:01.000Z',
              message: assistantMessage('\n\nreal text\nsecond line'),
            },
            children: [],
          },
        ],
      },
    ];

    const projection = projectSessionTreeToScout(tree, 'assistant-text');

    expect(projection.tree[0]!.children[0]).toMatchObject({
      id: 'assistant-text',
      preview: 'real text',
    });
    expect(projection.leafId).toBe('assistant-text');
  });

  it('uses later non-empty assistant text blocks when earlier text blocks are empty', () => {
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
              type: 'message',
              id: 'assistant-text-block',
              parentId: 'root',
              timestamp: '2026-01-01T00:00:01.000Z',
              message: assistantMessage('', {
                content: [
                  { type: 'text', text: '\n  \n' },
                  {
                    type: 'toolCall',
                    id: 'read-1',
                    name: 'read',
                    arguments: { path: 'src/a.ts' },
                  },
                  { type: 'text', text: '\nreal text from later block\nsecond line' },
                ],
              }),
            },
            children: [],
          },
        ],
      },
    ];

    const projection = projectSessionTreeToScout(tree, 'assistant-text-block');

    expect(projection.tree[0]!.children[0]).toMatchObject({
      id: 'assistant-text-block',
      preview: 'real text from later block',
    });
    expect(projection.leafId).toBe('assistant-text-block');
  });

  it('projects bash execution messages with command previews', () => {
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
              type: 'message',
              id: 'bash-execution',
              parentId: 'root',
              timestamp: '2026-01-01T00:00:01.000Z',
              message: {
                role: 'bashExecution',
                command: 'echo ok',
                output: 'ok',
                exitCode: 0,
                cancelled: false,
                truncated: false,
                timestamp: 2,
              },
            },
            children: [],
          },
        ],
      },
    ];

    const projection = projectSessionTreeToScout(tree, 'bash-execution');

    expect(projection.tree[0]!.children[0]).toMatchObject({
      id: 'bash-execution',
      kind: 'bashExecution',
      role: 'bashExecution',
      preview: 'echo ok',
    });
    expect(projection.leafId).toBe('bash-execution');
  });

  it('maps tool result metadata from the matching assistant tool calls', () => {
    const toolCalls = [
      {
        type: 'toolCall' as const,
        id: 'read-1',
        name: 'read',
        arguments: { path: 'src/a.ts', offset: 2, limit: 4 },
      },
      { type: 'toolCall' as const, id: 'write-1', name: 'write', arguments: { path: 'src/b.ts' } },
      { type: 'toolCall' as const, id: 'edit-1', name: 'edit', arguments: { path: 'src/c.ts' } },
      {
        type: 'toolCall' as const,
        id: 'bash-1',
        name: 'bash',
        arguments: {
          command: 'pnpm test -- --runInBand with a very long suffix that is truncated',
        },
      },
      {
        type: 'toolCall' as const,
        id: 'grep-1',
        name: 'grep',
        arguments: { pattern: 'needle', path: 'src' },
      },
      {
        type: 'toolCall' as const,
        id: 'find-1',
        name: 'find',
        arguments: { pattern: '*.ts', path: 'packages' },
      },
      {
        type: 'toolCall' as const,
        id: 'ls-1',
        name: 'ls',
        arguments: { path: 'packages/webview' },
      },
      {
        type: 'toolCall' as const,
        id: 'custom-1',
        name: 'custom_tool',
        arguments: { alpha: 'abcdefghijklmnopqrstuvwxyz', beta: 123 },
      },
    ];
    const toolResultNodes = toolCalls.map((toolCall) => ({
      entry: {
        type: 'message' as const,
        id: `result-${toolCall.id}`,
        parentId: 'assistant',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: {
          role: 'toolResult' as const,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [{ type: 'text' as const, text: 'raw tool output should not be tree preview' }],
          isError: false,
          timestamp: 3,
        },
      },
      children: [],
    }));
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
              type: 'message',
              id: 'assistant',
              parentId: 'root',
              timestamp: '2026-01-01T00:00:01.000Z',
              message: assistantMessage('', { content: toolCalls, stopReason: 'toolUse' }),
            },
            children: toolResultNodes,
          },
        ],
      },
    ];

    const mappedToolResults = mapSessionTreeToScout(tree)[0]!.children.map((node) => ({
      preview: node.preview,
      toolCall: node.toolCall,
    }));

    expect(mappedToolResults).toEqual([
      {
        preview: undefined,
        toolCall: {
          id: 'read-1',
          name: 'read',
          arguments: { path: 'src/a.ts', offset: 2, limit: 4 },
          truncated: false,
        },
      },
      {
        preview: undefined,
        toolCall: {
          id: 'write-1',
          name: 'write',
          arguments: { path: 'src/b.ts' },
          truncated: false,
        },
      },
      {
        preview: undefined,
        toolCall: {
          id: 'edit-1',
          name: 'edit',
          arguments: { path: 'src/c.ts' },
          truncated: false,
        },
      },
      {
        preview: undefined,
        toolCall: {
          id: 'bash-1',
          name: 'bash',
          arguments: {
            command: 'pnpm test -- --runInBand with a very long suffix that is truncated',
          },
          truncated: false,
        },
      },
      {
        preview: undefined,
        toolCall: {
          id: 'grep-1',
          name: 'grep',
          arguments: { pattern: 'needle', path: 'src' },
          truncated: false,
        },
      },
      {
        preview: undefined,
        toolCall: {
          id: 'find-1',
          name: 'find',
          arguments: { pattern: '*.ts', path: 'packages' },
          truncated: false,
        },
      },
      {
        preview: undefined,
        toolCall: {
          id: 'ls-1',
          name: 'ls',
          arguments: { path: 'packages/webview' },
          truncated: false,
        },
      },
      {
        preview: undefined,
        toolCall: {
          id: 'custom-1',
          name: 'custom_tool',
          arguments: { alpha: 'abcdefghijklmnopqrstuvwxyz', beta: 123 },
          truncated: false,
        },
      },
    ]);
  });

  it('pairs duplicate tool call ids by branch order instead of a global id map', () => {
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
              type: 'message',
              id: 'assistant-1',
              parentId: 'root',
              timestamp: '2026-01-01T00:00:01.000Z',
              message: assistantMessage('', {
                content: [
                  {
                    type: 'toolCall',
                    id: 'duplicate-tool',
                    name: 'bash',
                    arguments: { command: 'printf first' },
                  },
                ],
                stopReason: 'toolUse',
              }),
            },
            children: [
              {
                entry: {
                  type: 'message',
                  id: 'tool-result-1',
                  parentId: 'assistant-1',
                  timestamp: '2026-01-01T00:00:02.000Z',
                  message: {
                    role: 'toolResult',
                    toolCallId: 'duplicate-tool',
                    toolName: 'bash',
                    content: [{ type: 'text', text: 'first output' }],
                    isError: false,
                    timestamp: 3,
                  },
                },
                children: [
                  {
                    entry: {
                      type: 'message',
                      id: 'assistant-2',
                      parentId: 'tool-result-1',
                      timestamp: '2026-01-01T00:00:03.000Z',
                      message: assistantMessage('', {
                        content: [
                          {
                            type: 'toolCall',
                            id: 'duplicate-tool',
                            name: 'bash',
                            arguments: { command: 'printf second' },
                          },
                        ],
                        stopReason: 'toolUse',
                      }),
                    },
                    children: [
                      {
                        entry: {
                          type: 'message',
                          id: 'tool-result-2',
                          parentId: 'assistant-2',
                          timestamp: '2026-01-01T00:00:04.000Z',
                          message: {
                            role: 'toolResult',
                            toolCallId: 'duplicate-tool',
                            toolName: 'bash',
                            content: [{ type: 'text', text: 'second output' }],
                            isError: false,
                            timestamp: 5,
                          },
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
    ];

    const mapped = mapSessionTreeToScout(tree);
    const toolResultArgs = [
      mapped[0]!.children[0]!.toolCall?.arguments,
      mapped[0]!.children[0]!.children[0]!.toolCall?.arguments,
    ];

    expect(toolResultArgs).toEqual([{ command: 'printf first' }, { command: 'printf second' }]);
  });

  it('limits serialized tool arguments without formatting tool-specific UI copy', () => {
    const longCommand = 'x'.repeat(520);
    const largeObject = Object.fromEntries(
      Array.from({ length: 24 }, (_, index) => [`key${index}`, index]),
    );
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
              type: 'message',
              id: 'assistant',
              parentId: 'root',
              timestamp: '2026-01-01T00:00:01.000Z',
              message: assistantMessage('', {
                content: [
                  {
                    type: 'toolCall',
                    id: 'bash-1',
                    name: 'bash',
                    arguments: {
                      command: longCommand,
                      nested: largeObject,
                    },
                  },
                ],
                stopReason: 'toolUse',
              }),
            },
            children: [
              {
                entry: {
                  type: 'message',
                  id: 'result-bash-1',
                  parentId: 'assistant',
                  timestamp: '2026-01-01T00:00:02.000Z',
                  message: {
                    role: 'toolResult',
                    toolCallId: 'bash-1',
                    toolName: 'bash',
                    content: [{ type: 'text', text: 'output' }],
                    isError: false,
                    timestamp: 3,
                  },
                },
                children: [],
              },
            ],
          },
        ],
      },
    ];

    const mappedToolResult = mapSessionTreeToScout(tree)[0]!.children[0]!;

    expect(mappedToolResult.preview).toBeUndefined();
    expect(mappedToolResult.toolCall).toEqual({
      id: 'bash-1',
      name: 'bash',
      arguments: {
        command: longCommand.slice(0, 500),
        nested: Object.fromEntries(
          Array.from({ length: 20 }, (_, index) => [`key${index}`, index]),
        ),
      },
      truncated: true,
    });
  });

  it('preserves assistant failure metadata for tree filtering', () => {
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
              type: 'message',
              id: 'assistant-error',
              parentId: 'root',
              timestamp: '2026-01-01T00:00:01.000Z',
              message: assistantMessage('', {
                content: [],
                stopReason: 'error',
                errorMessage: 'provider exploded\ntry again',
              }),
            },
            children: [],
          },
          {
            entry: {
              type: 'message',
              id: 'assistant-aborted',
              parentId: 'root',
              timestamp: '2026-01-01T00:00:02.000Z',
              message: assistantMessage('', { content: [], stopReason: 'aborted' }),
            },
            children: [],
          },
        ],
      },
    ];

    const failureSummaries = mapSessionTreeToScout(tree)[0]!.children.map((node) => ({
      id: node.id,
      preview: node.preview,
      stopReason: node.stopReason,
      errorMessage: node.errorMessage,
    }));

    expect(failureSummaries).toEqual([
      {
        id: 'assistant-error',
        preview: undefined,
        stopReason: 'error',
        errorMessage: 'provider exploded\ntry again',
      },
      {
        id: 'assistant-aborted',
        preview: undefined,
        stopReason: 'aborted',
        errorMessage: undefined,
      },
    ]);
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
        toolCall: undefined,
        stopReason: undefined,
        errorMessage: undefined,
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
            toolCall: undefined,
            stopReason: 'stop',
            errorMessage: undefined,
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
        toolCall: undefined,
        stopReason: undefined,
        errorMessage: undefined,
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
            toolCall: undefined,
            stopReason: undefined,
            errorMessage: undefined,
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
