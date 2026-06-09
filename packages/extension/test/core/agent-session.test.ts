import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSession } from '../../src/core/agent-session.ts';
import { SessionManager } from '../../src/core/session/index.ts';
import { createConfigManager, mockModel, userMessage, assistantMessage } from './test-utils.ts';

function createSession(tempDir: string): AgentSession {
  return new AgentSession({
    session: SessionManager.inMemory(tempDir),
    configManager: createConfigManager(tempDir),
    cwd: tempDir,
    logger: { appendLine: vi.fn() },
    skills: [],
  });
}

function attachFakeAgent(session: AgentSession, agent: unknown): void {
  (session as unknown as { agent: unknown }).agent = agent;
}

describe('AgentSession', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-agent-session-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('aborts and disconnects the current agent before manual compaction', async () => {
    const session = createSession(tempDir);
    const order: string[] = [];
    const unsubscribe = vi.fn(() => order.push('unsubscribe'));
    const subscribe = vi.fn(() => {
      order.push('subscribe');
      return vi.fn();
    });
    attachFakeAgent(session, {
      abort: vi.fn(() => order.push('abort')),
      hasQueuedMessages: vi.fn(() => false),
      subscribe,
      state: {
        messages: [],
        model: mockModel(),
        thinkingLevel: 'off',
        tools: [],
      },
    });
    (session as unknown as { unsubscribeAgent?: () => void }).unsubscribeAgent = unsubscribe;
    (session as unknown as { runCompactionCore: unknown }).runCompactionCore = vi.fn(
      async ({ signal }: { signal: AbortSignal }) => {
        expect(signal.aborted).toBe(false);
        order.push('compact');
        return {
          summary: 'summary',
          firstKeptEntryId: 'entry-1',
          tokensBefore: 100,
        };
      },
    );
    (
      session as unknown as { syncRuntimeMessagesFromSession: unknown }
    ).syncRuntimeMessagesFromSession = vi.fn(async () => []);
    (session as unknown as { rebuildCachedMessages: unknown }).rebuildCachedMessages = vi.fn(
      async () => undefined,
    );

    await session.compact();

    expect(order).toEqual(['unsubscribe', 'abort', 'compact', 'subscribe']);
  });

  it('ignores extension-provided tree summaries unless navigation requests summarization', async () => {
    const session = createSession(tempDir);
    const backingSession = session.sessionManager;
    const firstId = backingSession.appendMessage(userMessage('first'));
    backingSession.appendMessage(assistantMessage('response'));
    backingSession.appendMessage(userMessage('second'));
    attachFakeAgent(session, {
      state: {
        messages: [],
        model: mockModel(),
        thinkingLevel: 'off',
        tools: [],
      },
    });
    (session as unknown as { extensionRunner: unknown }).extensionRunner = {
      emitSessionBeforeTree: vi.fn(async () => ({
        summary: { summary: 'should not be written' },
      })),
      emit: vi.fn(async () => undefined),
    };

    const result = await session.navigateTree(firstId);

    expect(result.cancelled).toBe(false);
    expect(backingSession.getEntries().some((entry) => entry.type === 'branch_summary')).toBe(
      false,
    );
  });

  it('rebuilds runtime context from the session tree after navigation', async () => {
    const session = createSession(tempDir);
    const backingSession = session.sessionManager;
    const firstId = backingSession.appendMessage(userMessage('first draft'));
    backingSession.appendMessage(assistantMessage('first reply'));
    backingSession.appendMessage(userMessage('second prompt'));
    const runtimeMessages: unknown[] = backingSession.buildContext().messages.slice();
    attachFakeAgent(session, {
      state: {
        get messages() {
          return runtimeMessages;
        },
        set messages(nextMessages: unknown[]) {
          runtimeMessages.splice(0, runtimeMessages.length, ...nextMessages);
        },
        model: mockModel(),
        thinkingLevel: 'off',
        tools: [],
      },
    });

    const result = await session.navigateTree(firstId, { summarize: false });

    expect(result).toEqual({ cancelled: false, editorText: 'first draft' });
    expect(backingSession.getLeafId()).toBeNull();
    expect(runtimeMessages).toEqual([]);
    expect(session.getSessionMessages()).toEqual([]);
  });

  it('reports session stats from the runtime context', async () => {
    const session = createSession(tempDir);
    attachFakeAgent(session, {
      state: {
        messages: [
          userMessage('hello'),
          assistantMessage('use tool', {
            content: [{ type: 'toolCall', id: 'tool-1', name: 'read', arguments: {} }],
          }),
          {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'read',
            content: [{ type: 'text', text: 'ok' }],
            isError: false,
            timestamp: 3,
          },
        ],
        model: mockModel(),
        thinkingLevel: 'off',
        tools: [],
      },
    });

    const stats = await session.getSessionStats();

    expect(stats.userMessages).toBe(1);
    expect(stats.assistantMessages).toBe(1);
    expect(stats.toolCalls).toBe(1);
    expect(stats.toolResults).toBe(1);
  });

  it('exports the current branch as a linear JSONL session', () => {
    const session = createSession(tempDir);
    const backingSession = session.sessionManager;
    backingSession.appendMessage(userMessage('first'));
    backingSession.appendMessage(assistantMessage('second'));

    const filePath = session.exportToJsonl('exported.jsonl');
    const lines = fs
      .readFileSync(filePath, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(lines[0]).toMatchObject({ type: 'session', cwd: tempDir });
    expect(lines[1]).toMatchObject({ type: 'message', parentId: null });
    expect(lines[2]).toMatchObject({ type: 'message', parentId: lines[1].id });
  });

  it('records bash results in session history and runtime context', async () => {
    const session = createSession(tempDir);
    const runtimeMessages: unknown[] = [];
    attachFakeAgent(session, {
      state: {
        get messages() {
          return runtimeMessages;
        },
        set messages(nextMessages: unknown[]) {
          runtimeMessages.splice(0, runtimeMessages.length, ...nextMessages);
        },
        model: mockModel(),
        thinkingLevel: 'off',
        tools: [],
      },
    });

    await session.recordBashResult('echo ok', {
      output: 'ok',
      exitCode: 0,
      cancelled: false,
      truncated: false,
    });

    expect(runtimeMessages[0]).toMatchObject({ role: 'bashExecution', command: 'echo ok' });
    expect(session.sessionManager.getEntries()[0]).toMatchObject({ type: 'message' });
  });

  it('queues streaming extension messages through the runtime agent queues', async () => {
    const session = createSession(tempDir);
    const steer = vi.fn();
    const followUp = vi.fn();
    attachFakeAgent(session, {
      steer,
      followUp,
      state: {
        messages: [],
        model: mockModel(),
        thinkingLevel: 'off',
        tools: [],
      },
    });
    (session as unknown as { _isStreaming: boolean })._isStreaming = true;

    await session.sendUserMessage('steer me', { deliverAs: 'steer' });
    await session.sendMessage('follow me', { deliverAs: 'followUp' });

    expect(steer).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        content: [{ type: 'text', text: 'steer me' }],
      }),
    );
    expect(followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'custom',
        customType: 'extension_message',
        content: 'follow me',
      }),
    );
  });

  it('queues streaming prompts through the requested runtime agent queue', async () => {
    const session = createSession(tempDir);
    const steer = vi.fn();
    const followUp = vi.fn();
    attachFakeAgent(session, {
      steer,
      followUp,
      state: {
        messages: [],
        model: mockModel(),
        thinkingLevel: 'off',
        tools: [],
      },
    });
    (session as unknown as { _isStreaming: boolean })._isStreaming = true;

    await session.prompt('after this', { streamingBehavior: 'followUp' });

    expect(followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        content: [{ type: 'text', text: 'after this' }],
      }),
    );
    expect(steer).not.toHaveBeenCalled();
  });

  it('rejects queued extension commands like Pi session steer and followUp', async () => {
    const session = createSession(tempDir);
    attachFakeAgent(session, {
      steer: vi.fn(),
      followUp: vi.fn(),
      state: {
        messages: [],
        model: mockModel(),
        thinkingLevel: 'off',
        tools: [],
      },
    });
    (session as unknown as { extensionRunner: unknown }).extensionRunner = {
      getCommand: vi.fn(() => ({
        name: 'reload',
        sourceInfo: {
          path: 'extension.ts',
          source: 'test',
          scope: 'project',
          origin: 'top-level',
        },
        handler: vi.fn(),
      })),
    };

    await expect(session.steer('/reload now')).rejects.toThrow(
      'Extension command "/reload" cannot be queued.',
    );
    await expect(session.followUp('/reload later')).rejects.toThrow(
      'Extension command "/reload" cannot be queued.',
    );
  });
});
