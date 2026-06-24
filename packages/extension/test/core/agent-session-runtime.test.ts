import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession } from '../../src/core/agent-session.ts';
import {
  AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  type CreateAgentSessionRuntimeOptions,
} from '../../src/core/agent-session-runtime.ts';
import { MissingSessionCwdError } from '../../src/core/session-cwd.ts';
import { SessionManager } from '../../src/core/session/index.ts';
import type { Session } from '../../src/core/session/index.ts';
import { mockModel, userMessage } from './test-utils.ts';
import type { Api, Model } from '@scout-agent/ai';
import type { ThinkingLevel } from '@scout-agent/agent';

interface FakeAgentSessionOptions {
  beforeSwitchCancelled?: boolean;
  beforeForkCancelled?: boolean;
  shutdownError?: Error;
  onSessionShutdown?: () => void;
  onSessionStart?: () => void;
  onResourcesDiscover?: () => void;
  onSyncRuntimeMessages?: () => void;
  onDispose?: () => void;
  model?: Model<Api>;
  thinkingLevel?: ThinkingLevel;
  activeToolNames?: string[];
}

function createFakeAgentSession(session: Session, options: FakeAgentSessionOptions = {}) {
  const model = options.model ?? mockModel();
  const thinkingLevel = options.thinkingLevel ?? 'off';
  const activeToolNames = options.activeToolNames ?? ['read'];
  const fake = {
    sessionManager: session,
    sessionFile: session.getSessionFile(),
    model,
    thinkingLevel,
    getActiveToolNames: vi.fn(() => [...activeToolNames]),
    emitSessionBeforeSwitch: vi.fn(async () => options.beforeSwitchCancelled ?? false),
    emitSessionBeforeFork: vi.fn(async () => options.beforeForkCancelled ?? false),
    emitSessionShutdown: vi.fn(async () => {
      options.onSessionShutdown?.();
      if (options.shutdownError) throw options.shutdownError;
    }),
    bindExtensions: vi.fn(async () => {
      options.onSessionStart?.();
      options.onResourcesDiscover?.();
      return [{ type: 'warning' as const, message: 'resources' }];
    }),
    syncRuntimeMessagesFromSession: vi.fn(async () => {
      options.onSyncRuntimeMessages?.();
      return session.buildContext().messages;
    }),
    dispose: vi.fn(() => {
      options.onDispose?.();
    }),
    createReplacedSessionContext: vi.fn(() => ({ marker: session.getSessionId() })),
  };
  return fake as unknown as AgentSession & typeof fake;
}

function writeSessionFile(filePath: string, cwd?: string): void {
  const header: Record<string, unknown> = {
    type: 'session',
    version: 3,
    id: path.basename(filePath, '.jsonl'),
    timestamp: '2025-01-01T00:00:00.000Z',
  };
  if (cwd !== undefined) {
    header.cwd = cwd;
  }

  fs.writeFileSync(
    filePath,
    [
      JSON.stringify(header),
      JSON.stringify({
        type: 'message',
        id: 'message-1',
        parentId: null,
        timestamp: '2025-01-01T00:00:00.000Z',
        message: userMessage('stored message'),
      }),
      '',
    ].join('\n'),
  );
}

describe('AgentSessionRuntime', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-runtime-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a replacement session for newSession and rebinds before withSession', async () => {
    const currentSession = SessionManager.inMemory(tempDir);
    const currentAgentSession = createFakeAgentSession(currentSession);
    const order: string[] = [];
    const sessionStartEvents: unknown[] = [];
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({
      session,
      sessionStartEvent,
    }) => {
      sessionStartEvents.push(sessionStartEvent);
      return {
        session: createFakeAgentSession(session, {
          onSessionStart: () => order.push('session_start'),
          onResourcesDiscover: () => order.push('resources_discover'),
        }),
        diagnostics: [{ type: 'warning', message: 'created' }],
      };
    };
    const runtime = new AgentSessionRuntime(currentAgentSession, {
      cwd: tempDir,
      createRuntime,
    });
    runtime.setRebindSession(async (session) => {
      order.push('rebind');
      return await session.bindExtensions();
    });

    const result = await runtime.newSession({
      withSession: async () => {
        order.push('withSession');
      },
    });

    expect(result.cancelled).toBe(false);
    expect(currentAgentSession.emitSessionShutdown).toHaveBeenCalledWith({
      type: 'session_shutdown',
      reason: 'new',
      targetSessionFile: undefined,
    });
    expect(currentAgentSession.dispose).toHaveBeenCalledOnce();
    expect(sessionStartEvents).toEqual([
      { type: 'session_start', reason: 'new', previousSessionFile: undefined },
    ]);
    expect(order).toEqual(['rebind', 'session_start', 'resources_discover', 'withSession']);
    expect(runtime.diagnostics).toEqual([
      { type: 'warning', message: 'created' },
      { type: 'warning', message: 'resources' },
    ]);
  });

  it('preserves Pi newSession parentSession/setup semantics before lifecycle', async () => {
    const sessionDir = path.join(tempDir, 'sessions');
    const currentSession = SessionManager.create(tempDir, sessionDir);
    const currentAgentSession = createFakeAgentSession(currentSession);
    const parentSession = path.join(sessionDir, 'parent.jsonl');
    const order: string[] = [];
    let replacementSession: Session | undefined;
    let replacementAgentSession:
      | (AgentSession & { syncRuntimeMessagesFromSession: ReturnType<typeof vi.fn> })
      | undefined;
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({ session }) => {
      replacementSession = session;
      const replacement = createFakeAgentSession(session, {
        onSessionStart: () => order.push('session_start'),
        onResourcesDiscover: () => order.push('resources_discover'),
        onSyncRuntimeMessages: () => order.push('sync_runtime_messages'),
      });
      replacementAgentSession = replacement;
      return { session: replacement, diagnostics: [] };
    };
    const runtime = new AgentSessionRuntime(currentAgentSession, {
      cwd: tempDir,
      createRuntime,
    });
    runtime.setRebindSession(async (session) => {
      order.push('rebind');
      return await session.bindExtensions();
    });

    const result = await runtime.newSession({
      parentSession,
      setup: async (sessionManager) => {
        order.push('setup');
        expect(sessionManager).toBe(runtime.session.sessionManager);
        expect(sessionManager.getMetadata().parentSessionPath).toBe(parentSession);
        sessionManager.appendMessage(userMessage('seeded history'));
      },
      withSession: async () => {
        order.push('withSession');
      },
    });

    expect(result.cancelled).toBe(false);
    expect(replacementSession?.getMetadata().parentSessionPath).toBe(parentSession);
    expect(replacementSession?.buildContext().messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'seeded history' }),
    ]);
    expect(replacementAgentSession?.syncRuntimeMessagesFromSession).toHaveBeenCalledOnce();
    expect(order).toEqual([
      'setup',
      'sync_runtime_messages',
      'rebind',
      'session_start',
      'resources_discover',
      'withSession',
    ]);
  });

  it('carries current runtime model, thinking level, and tools into new sessions', async () => {
    const sessionDir = path.join(tempDir, 'sessions');
    const currentSession = SessionManager.create(tempDir, sessionDir);
    const inheritedModel = mockModel({ id: 'third-party-gpt', provider: 'openai' });
    const currentAgentSession = createFakeAgentSession(currentSession, {
      model: inheritedModel,
      thinkingLevel: 'off',
      activeToolNames: ['read', 'grep'],
    });
    let replacementOptions: CreateAgentSessionRuntimeOptions | undefined;
    const createRuntime: CreateAgentSessionRuntimeFactory = async (options) => {
      replacementOptions = options;
      return { session: createFakeAgentSession(options.session), diagnostics: [] };
    };
    const runtime = new AgentSessionRuntime(currentAgentSession, {
      cwd: tempDir,
      createRuntime,
    });

    await runtime.newSession();

    expect(replacementOptions?.initialModel).toBe(inheritedModel);
    expect(replacementOptions?.initialThinkingLevel).toBe('off');
    expect(replacementOptions?.activeToolNames).toEqual(['read', 'grep']);
  });

  it('carries current runtime model, thinking level, and tools into forked sessions', async () => {
    const currentSession = SessionManager.inMemory(tempDir);
    const forkPoint = currentSession.appendMessage(userMessage('fork point'));
    const inheritedModel = mockModel({ id: 'third-party-gpt', provider: 'openai' });
    const currentAgentSession = createFakeAgentSession(currentSession, {
      model: inheritedModel,
      thinkingLevel: 'off',
      activeToolNames: ['read', 'grep'],
    });
    let replacementOptions: CreateAgentSessionRuntimeOptions | undefined;
    const createRuntime: CreateAgentSessionRuntimeFactory = async (options) => {
      replacementOptions = options;
      return { session: createFakeAgentSession(options.session), diagnostics: [] };
    };
    const runtime = new AgentSessionRuntime(currentAgentSession, {
      cwd: tempDir,
      createRuntime,
    });

    await runtime.fork(forkPoint, 'at');

    expect(replacementOptions?.initialModel).toBe(inheritedModel);
    expect(replacementOptions?.initialThinkingLevel).toBe('off');
    expect(replacementOptions?.activeToolNames).toEqual(['read', 'grep']);
  });

  it('invalidates the previous session after shutdown and before replacement rebind', async () => {
    const currentSession = SessionManager.inMemory(tempDir);
    const order: string[] = [];
    const currentAgentSession = createFakeAgentSession(currentSession, {
      onSessionShutdown: () => order.push('session_shutdown'),
      onDispose: () => order.push('dispose'),
    });
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({ session }) => ({
      session: createFakeAgentSession(session, {
        onSessionStart: () => order.push('session_start'),
        onResourcesDiscover: () => order.push('resources_discover'),
      }),
      diagnostics: [],
    });
    const runtime = new AgentSessionRuntime(currentAgentSession, {
      cwd: tempDir,
      createRuntime,
    });
    runtime.setBeforeSessionInvalidate(() => {
      order.push('beforeSessionInvalidate');
    });
    runtime.setRebindSession(async (session) => {
      order.push('rebind');
      return await session.bindExtensions();
    });

    const result = await runtime.newSession();

    expect(result.cancelled).toBe(false);
    expect(order).toEqual([
      'session_shutdown',
      'beforeSessionInvalidate',
      'dispose',
      'rebind',
      'session_start',
      'resources_discover',
    ]);
  });

  it('does not replace the session when session_before_switch cancels', async () => {
    const currentSession = SessionManager.inMemory(tempDir);
    const currentAgentSession = createFakeAgentSession(currentSession, {
      beforeSwitchCancelled: true,
    });
    const createRuntime = vi.fn<CreateAgentSessionRuntimeFactory>();
    const runtime = new AgentSessionRuntime(currentAgentSession, {
      cwd: tempDir,
      createRuntime,
    });

    const result = await runtime.newSession();

    expect(result.cancelled).toBe(true);
    expect(createRuntime).not.toHaveBeenCalled();
    expect(currentAgentSession.dispose).not.toHaveBeenCalled();
  });

  it('propagates shutdown errors without creating the replacement runtime', async () => {
    const currentSession = SessionManager.inMemory(tempDir);
    const shutdownError = new Error('shutdown failed');
    const currentAgentSession = createFakeAgentSession(currentSession, { shutdownError });
    const createRuntime = vi.fn<CreateAgentSessionRuntimeFactory>();
    const runtime = new AgentSessionRuntime(currentAgentSession, {
      cwd: tempDir,
      createRuntime,
    });

    await expect(runtime.newSession()).rejects.toThrow('shutdown failed');

    expect(createRuntime).not.toHaveBeenCalled();
    expect(currentAgentSession.dispose).not.toHaveBeenCalled();
    expect(runtime.session).toBe(currentAgentSession);
  });

  it('propagates withSession errors after rebinding the replacement session', async () => {
    const currentSession = SessionManager.inMemory(tempDir);
    const currentAgentSession = createFakeAgentSession(currentSession);
    const replacementSessions: AgentSession[] = [];
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({ session }) => {
      const replacement = createFakeAgentSession(session);
      replacementSessions.push(replacement);
      return { session: replacement, diagnostics: [] };
    };
    const runtime = new AgentSessionRuntime(currentAgentSession, {
      cwd: tempDir,
      createRuntime,
    });

    await expect(
      runtime.newSession({
        withSession: async () => {
          throw new Error('withSession failed');
        },
      }),
    ).rejects.toThrow('withSession failed');

    expect(runtime.session).toBe(replacementSessions[0]);
  });

  it('forks before a user message and returns selected text', async () => {
    const currentSession = SessionManager.inMemory(tempDir);
    const firstId = currentSession.appendMessage(userMessage('keep'));
    const secondId = currentSession.appendMessage(userMessage('edit this'));
    const currentAgentSession = createFakeAgentSession(currentSession);
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({ session }) => ({
      session: createFakeAgentSession(session),
      diagnostics: [],
    });
    const runtime = new AgentSessionRuntime(currentAgentSession, {
      cwd: tempDir,
      createRuntime,
    });

    const result = await runtime.fork(secondId, 'before');

    expect(result.cancelled).toBe(false);
    expect(result.selectedText).toBe('edit this');
    expect(runtime.session.sessionManager.getLeafId()).toBe(firstId);
    expect(runtime.session.sessionManager.getMetadata().forkPointEntryId).toBe(firstId);
  });

  it('honors fork cancellation before validating the requested entry', async () => {
    const currentSession = SessionManager.inMemory(tempDir);
    const currentAgentSession = createFakeAgentSession(currentSession, {
      beforeForkCancelled: true,
    });
    const createRuntime = vi.fn<CreateAgentSessionRuntimeFactory>();
    const runtime = new AgentSessionRuntime(currentAgentSession, {
      cwd: tempDir,
      createRuntime,
    });

    const result = await runtime.fork('missing-entry', 'at');

    expect(result).toEqual({ cancelled: true });
    expect(currentAgentSession.emitSessionBeforeFork).toHaveBeenCalledWith('missing-entry', 'at');
    expect(createRuntime).not.toHaveBeenCalled();
    expect(currentAgentSession.dispose).not.toHaveBeenCalled();
  });

  it('forks at the selected entry and runs withSession after replacement lifecycle', async () => {
    const currentSession = SessionManager.inMemory(tempDir);
    const firstId = currentSession.appendMessage(userMessage('first'));
    currentSession.appendMessage(userMessage('second'));
    const currentAgentSession = createFakeAgentSession(currentSession);
    const order: string[] = [];
    let callbackMarker: string | undefined;
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({ session }) => ({
      session: createFakeAgentSession(session, {
        onSessionStart: () => order.push('session_start'),
        onResourcesDiscover: () => order.push('resources_discover'),
      }),
      diagnostics: [],
    });
    const runtime = new AgentSessionRuntime(currentAgentSession, {
      cwd: tempDir,
      createRuntime,
    });
    runtime.setRebindSession(async (session) => {
      order.push('rebind');
      return await session.bindExtensions();
    });

    const result = await runtime.fork(firstId, 'at', {
      withSession: async (ctx) => {
        order.push('withSession');
        callbackMarker = (ctx as unknown as { marker: string }).marker;
      },
    });

    expect(result).toEqual({ cancelled: false });
    expect(runtime.session.sessionManager.getLeafId()).toBe(firstId);
    expect(runtime.session.sessionManager.getMetadata().forkPointEntryId).toBe(firstId);
    expect(callbackMarker).toBe(runtime.session.sessionManager.getSessionId());
    expect(order).toEqual(['rebind', 'session_start', 'resources_discover', 'withSession']);
  });

  it('imports a JSONL session through runtime replacement', async () => {
    const currentSession = SessionManager.inMemory(tempDir);
    const currentAgentSession = createFakeAgentSession(currentSession);
    const sourcePath = path.join(tempDir, 'source.jsonl');
    fs.writeFileSync(
      sourcePath,
      [
        JSON.stringify({
          type: 'session',
          version: 3,
          id: 'imported',
          timestamp: '2025-01-01T00:00:00.000Z',
          cwd: tempDir,
        }),
        JSON.stringify({
          type: 'message',
          id: 'message-1',
          parentId: null,
          timestamp: '2025-01-01T00:00:00.000Z',
          message: userMessage('imported message'),
        }),
        '',
      ].join('\n'),
    );
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({ session }) => ({
      session: createFakeAgentSession(session),
      diagnostics: [],
    });
    const runtime = new AgentSessionRuntime(currentAgentSession, {
      cwd: tempDir,
      createRuntime,
    });

    const result = await runtime.importFromJsonl(sourcePath);

    expect(result.cancelled).toBe(false);
    expect(currentAgentSession.emitSessionBeforeSwitch).toHaveBeenCalledWith(
      'resume',
      expect.stringContaining('source.jsonl'),
    );
    expect(currentAgentSession.emitSessionShutdown).toHaveBeenCalledWith({
      type: 'session_shutdown',
      reason: 'resume',
      targetSessionFile: expect.stringContaining('source.jsonl'),
    });
    expect(runtime.session.sessionManager.buildContext().messages[0]).toMatchObject({
      role: 'user',
      content: 'imported message',
    });
    expect(fs.existsSync(path.resolve('source.jsonl'))).toBe(false);
  });

  it('rejects switchSession when the stored session cwd is missing', async () => {
    const currentSession = SessionManager.inMemory(tempDir);
    const currentAgentSession = createFakeAgentSession(currentSession);
    const missingCwd = path.join(tempDir, 'missing-cwd');
    const sessionPath = path.join(tempDir, 'missing-switch.jsonl');
    writeSessionFile(sessionPath, missingCwd);
    const createRuntime = vi.fn<CreateAgentSessionRuntimeFactory>();
    const runtime = new AgentSessionRuntime(currentAgentSession, {
      cwd: tempDir,
      createRuntime,
    });

    await expect(
      runtime.switchSession({
        id: 'missing-switch',
        path: sessionPath,
        cwd: missingCwd,
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(MissingSessionCwdError);

    expect(createRuntime).not.toHaveBeenCalled();
    expect(currentAgentSession.emitSessionShutdown).not.toHaveBeenCalled();
    expect(currentAgentSession.dispose).not.toHaveBeenCalled();
    expect(runtime.session).toBe(currentAgentSession);
  });

  it('uses the current runtime cwd when switching an old session without stored cwd', async () => {
    const currentSession = SessionManager.inMemory(tempDir);
    const currentAgentSession = createFakeAgentSession(currentSession);
    const sessionPath = path.join(tempDir, 'legacy-switch.jsonl');
    writeSessionFile(sessionPath);
    const runtimeCwds: string[] = [];
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({ session, cwd }) => {
      if (cwd) runtimeCwds.push(cwd);
      return {
        session: createFakeAgentSession(session),
        diagnostics: [],
      };
    };
    const runtime = new AgentSessionRuntime(currentAgentSession, {
      cwd: tempDir,
      createRuntime,
    });

    const result = await runtime.switchSession({
      id: 'legacy-switch',
      path: sessionPath,
      cwd: '',
      createdAt: '2025-01-01T00:00:00.000Z',
    });

    expect(result.cancelled).toBe(false);
    expect(runtimeCwds).toEqual([tempDir]);
    expect(runtime.cwd).toBe(tempDir);
    expect(runtime.session.sessionManager.getCwd()).toBe(tempDir);
  });

  it('rejects importFromJsonl when the imported session cwd is missing', async () => {
    const sessionDir = path.join(tempDir, 'sessions');
    const currentSession = SessionManager.create(tempDir, sessionDir);
    const currentAgentSession = createFakeAgentSession(currentSession);
    const missingCwd = path.join(tempDir, 'missing-import-cwd');
    const sourcePath = path.join(tempDir, 'missing-import.jsonl');
    writeSessionFile(sourcePath, missingCwd);
    const createRuntime = vi.fn<CreateAgentSessionRuntimeFactory>();
    const runtime = new AgentSessionRuntime(currentAgentSession, {
      cwd: tempDir,
      createRuntime,
    });

    await expect(runtime.importFromJsonl(sourcePath)).rejects.toBeInstanceOf(
      MissingSessionCwdError,
    );

    expect(createRuntime).not.toHaveBeenCalled();
    expect(currentAgentSession.emitSessionShutdown).not.toHaveBeenCalled();
    expect(currentAgentSession.dispose).not.toHaveBeenCalled();
    expect(runtime.session).toBe(currentAgentSession);
  });

  it('uses the current runtime cwd when importing an old session without stored cwd', async () => {
    const sessionDir = path.join(tempDir, 'sessions');
    const currentSession = SessionManager.create(tempDir, sessionDir);
    const currentAgentSession = createFakeAgentSession(currentSession);
    const sourcePath = path.join(tempDir, 'legacy-import.jsonl');
    writeSessionFile(sourcePath);
    const runtimeCwds: string[] = [];
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({ session, cwd }) => {
      if (cwd) runtimeCwds.push(cwd);
      return {
        session: createFakeAgentSession(session),
        diagnostics: [],
      };
    };
    const runtime = new AgentSessionRuntime(currentAgentSession, {
      cwd: tempDir,
      createRuntime,
    });

    const result = await runtime.importFromJsonl(sourcePath);

    expect(result.cancelled).toBe(false);
    expect(runtimeCwds).toEqual([tempDir]);
    expect(runtime.cwd).toBe(tempDir);
    expect(runtime.session.sessionManager.getCwd()).toBe(tempDir);
  });
});
