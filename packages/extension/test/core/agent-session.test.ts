import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentMessage } from '@scout-agent/agent';
import {
  createAssistantMessageEventStream,
  getDefaultModel,
  registerApiProvider,
  registerModel,
  unregisterApiProviders,
  unregisterModels,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from '@scout-agent/ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSession } from '../../src/core/agent-session.ts';
import { SessionManager } from '../../src/core/session/index.ts';
import { createConfigManager, mockModel, userMessage, assistantMessage } from './test-utils.ts';
import { ConfigManager } from '../../src/config-manager.ts';

const STREAM_OPTIONS_TEST_SOURCE = 'agent-session-compaction-stream-options-test';
const STREAM_OPTIONS_TEST_API = 'test-agent-session-compaction-api';

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

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function getMessageText(message: AgentMessage): string {
  const messageWithContent = message as { content?: unknown };
  const content = messageWithContent.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        typeof part === 'object' &&
        part !== null &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string',
    )
    .map((part) => part.text)
    .join('\n');
}

function createConfigManagerWithValues(
  cwd: string,
  values: Record<string, unknown>,
): ConfigManager {
  return new ConfigManager({
    cwd,
    agentDir: cwd,
    getConfiguration: () =>
      ({
        get: <T>(key: string) => values[key] as T,
        has: (key: string) => key in values,
        inspect: () => undefined,
        update: async () => undefined,
      }) as never,
  });
}

describe('AgentSession', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-agent-session-test-'));
  });

  afterEach(() => {
    unregisterApiProviders(STREAM_OPTIONS_TEST_SOURCE);
    unregisterModels(STREAM_OPTIONS_TEST_SOURCE);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists the initial model and thinking level for a new session', async () => {
    const defaultModel = getDefaultModel();
    const backingSession = SessionManager.inMemory(tempDir);
    const session = new AgentSession({
      session: backingSession,
      configManager: createConfigManagerWithValues(tempDir, {
        anthropicApiKey: 'test-key',
        defaultThinkingLevel: 'high',
      }),
      cwd: tempDir,
      logger: { appendLine: vi.fn() },
      skills: [],
    });

    await session.initialize();
    try {
      const entries = backingSession.getEntries();
      expect(entries[0]).toMatchObject({
        type: 'model_change',
        provider: defaultModel.provider,
        modelId: defaultModel.id,
        parentId: null,
      });
      expect(entries[1]).toMatchObject({
        type: 'thinking_level_change',
        thinkingLevel: 'high',
        parentId: entries[0]?.id,
      });
      expect(backingSession.buildContext()).toMatchObject({
        model: { provider: defaultModel.provider, modelId: defaultModel.id },
        thinkingLevel: 'high',
        messages: [],
      });
    } finally {
      session.dispose();
    }
  });

  it('restores selected model and thinking level from metadata-only session state', async () => {
    const selectedModel = mockModel({
      id: 'metadata-only-selected-model',
      name: 'Metadata Only Selected Model',
    });
    registerModel(selectedModel, { sourceId: STREAM_OPTIONS_TEST_SOURCE });
    const backingSession = SessionManager.inMemory(tempDir);
    backingSession.appendModelChange(selectedModel.provider, selectedModel.id);
    backingSession.appendThinkingLevelChange('high');
    const session = new AgentSession({
      session: backingSession,
      configManager: createConfigManagerWithValues(tempDir, {
        anthropicApiKey: 'test-key',
        defaultThinkingLevel: 'low',
      }),
      cwd: tempDir,
      logger: { appendLine: vi.fn() },
      skills: [],
    });

    await session.initialize();
    try {
      expect(session.model).toMatchObject({
        provider: selectedModel.provider,
        id: selectedModel.id,
      });
      expect(session.thinkingLevel).toBe('high');
      const entries = backingSession.getEntries();
      expect(entries.filter((entry) => entry.type === 'model_change')).toHaveLength(1);
      expect(entries.filter((entry) => entry.type === 'thinking_level_change')).toHaveLength(1);
      expect(backingSession.buildContext()).toMatchObject({
        model: { provider: selectedModel.provider, modelId: selectedModel.id },
        thinkingLevel: 'high',
        messages: [],
      });
    } finally {
      session.dispose();
    }
  });

  it('backfills a missing thinking level when restoring an existing message session', async () => {
    const backingSession = SessionManager.inMemory(tempDir);
    const firstMessageId = backingSession.appendMessage(userMessage('existing prompt'));
    const session = new AgentSession({
      session: backingSession,
      configManager: createConfigManagerWithValues(tempDir, {
        anthropicApiKey: 'test-key',
        defaultThinkingLevel: 'medium',
      }),
      cwd: tempDir,
      logger: { appendLine: vi.fn() },
      skills: [],
    });

    await session.initialize();
    try {
      const entries = backingSession.getEntries();
      expect(entries.filter((entry) => entry.type === 'model_change')).toEqual([]);
      expect(entries.at(-1)).toMatchObject({
        type: 'thinking_level_change',
        thinkingLevel: 'medium',
        parentId: firstMessageId,
      });
      expect(backingSession.buildContext().thinkingLevel).toBe('medium');
    } finally {
      session.dispose();
    }
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

  it('pauses queued follow-ups on abort without clearing them', async () => {
    const session = createSession(tempDir);
    const queuedMessage = userMessage('queued follow-up');
    const clearSteeringQueue = vi.fn();
    const abort = vi.fn();
    attachFakeAgent(session, {
      abort,
      clearSteeringQueue,
      getFollowUpQueue: vi.fn(() => [
        {
          id: 'follow-1',
          message: queuedMessage,
          timestamp: 2,
        },
      ]),
    });

    await session.abort();

    expect(clearSteeringQueue).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledOnce();
    expect(session.isFollowUpQueuePaused).toBe(true);
    expect(session.queuedFollowUpPauseReason).toBe('aborted');
    expect(session.getQueuedFollowUps()).toEqual([
      { id: 'follow-1', text: 'queued follow-up', timestamp: 2 },
    ]);
  });

  it('continues promoted steering while preserving paused follow-ups', async () => {
    const session = createSession(tempDir);
    const queuedMessage = userMessage('remaining follow-up');
    const continueAgent = vi.fn(async () => undefined);
    attachFakeAgent(session, {
      abort: vi.fn(),
      continue: continueAgent,
      getFollowUpQueue: vi.fn(() => [
        {
          id: 'follow-remaining',
          message: queuedMessage,
          timestamp: 2,
        },
      ]),
    });

    await session.abort();
    await session.continue({ preserveFollowUps: true });

    expect(continueAgent).toHaveBeenCalledWith({ preserveFollowUps: true });
    expect(session.isFollowUpQueuePaused).toBe(true);
    expect(session.getQueuedFollowUps()).toEqual([
      { id: 'follow-remaining', text: 'remaining follow-up', timestamp: 2 },
    ]);
  });

  it('resumes paused follow-ups after sending a new prompt when the queue is kept', async () => {
    const session = createSession(tempDir);
    const queuedFollowUps = [
      {
        id: 'follow-old',
        message: userMessage('old follow-up'),
        timestamp: 2,
      },
    ];
    const handledTexts: string[] = [];
    const clearFollowUpQueue = vi.fn();
    const getUserMessageText = (message: AgentMessage): string | undefined => {
      if (message.role !== 'user') return undefined;
      const { content } = message;
      if (typeof content === 'string') return content;
      return content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
    };
    const prompt = vi.fn(async (messages: AgentMessage[]) => {
      for (const message of messages) {
        const text = getUserMessageText(message);
        if (text !== undefined) handledTexts.push(text);
      }

      if (!session.isFollowUpQueuePaused) {
        const [nextFollowUp] = queuedFollowUps.splice(0, 1);
        const text = nextFollowUp ? getUserMessageText(nextFollowUp.message) : undefined;
        if (text !== undefined) handledTexts.push(text);
      }
    });
    attachFakeAgent(session, {
      abort: vi.fn(),
      prompt,
      clearFollowUpQueue,
      getFollowUpQueue: vi.fn(() => queuedFollowUps),
      state: {
        messages: [],
        model: mockModel(),
        thinkingLevel: 'off',
        tools: [],
      },
    });

    await session.abort();
    await session.prompt('current prompt');

    expect(clearFollowUpQueue).not.toHaveBeenCalled();
    expect(prompt).toHaveBeenCalledOnce();
    expect(handledTexts).toEqual(['current prompt', 'old follow-up']);
    expect(session.isFollowUpQueuePaused).toBe(false);
    expect(session.getQueuedFollowUps()).toEqual([]);
  });

  it('preserves paused follow-ups through pre-prompt compaction before sending the current prompt', async () => {
    const session = createSession(tempDir);
    const queuedFollowUps = [
      {
        id: 'follow-old',
        message: userMessage('old follow-up'),
        timestamp: 2,
      },
    ];
    const handledTexts: string[] = [];
    const continueAgent = vi.fn(async (options?: { preserveFollowUps?: boolean }) => {
      if (!options?.preserveFollowUps) {
        const [nextFollowUp] = queuedFollowUps.splice(0, 1);
        if (nextFollowUp) handledTexts.push(getMessageText(nextFollowUp.message));
      }
    });
    const prompt = vi.fn(async (messages: AgentMessage[]) => {
      handledTexts.push(...messages.map((message) => getMessageText(message)));
      if (!session.isFollowUpQueuePaused) {
        const [nextFollowUp] = queuedFollowUps.splice(0, 1);
        if (nextFollowUp) handledTexts.push(getMessageText(nextFollowUp.message));
      }
    });
    attachFakeAgent(session, {
      abort: vi.fn(),
      continue: continueAgent,
      prompt,
      getFollowUpQueue: vi.fn(() => queuedFollowUps),
      state: {
        messages: [userMessage('previous'), assistantMessage('large previous answer')],
        model: mockModel(),
        thinkingLevel: 'off',
        tools: [],
      },
    });
    (
      session as unknown as {
        checkCompaction: (
          assistant: unknown,
          skipAbortedCheck?: boolean,
          policy?: { preserveFollowUps?: boolean },
        ) => Promise<boolean>;
      }
    ).checkCompaction = vi.fn(async () => true);

    await session.abort();
    await session.prompt('current prompt');

    expect(continueAgent).toHaveBeenCalledWith({ preserveFollowUps: true });
    expect(prompt).toHaveBeenCalledOnce();
    expect(handledTexts).toEqual(['current prompt', 'old follow-up']);
  });

  it('keeps preserveFollowUps across post-agent continuation loops', async () => {
    const session = createSession(tempDir);
    const queuedFollowUps = [
      {
        id: 'follow-remaining',
        message: userMessage('remaining follow-up'),
        timestamp: 2,
      },
    ];
    const continueAgent = vi.fn(async () => undefined);
    let postLoopCalls = 0;
    attachFakeAgent(session, {
      abort: vi.fn(),
      continue: continueAgent,
      getFollowUpQueue: vi.fn(() => queuedFollowUps),
    });
    (
      session as unknown as {
        handlePostAgentEnd: (policy?: { preserveFollowUps?: boolean }) => Promise<boolean>;
      }
    ).handlePostAgentEnd = vi.fn(async (policy?: { preserveFollowUps?: boolean }) => {
      expect(policy).toEqual({ preserveFollowUps: true });
      postLoopCalls += 1;
      return postLoopCalls === 1;
    });
    (session as unknown as { lastAssistantMessage: unknown }).lastAssistantMessage =
      assistantMessage('after promoted steering');

    await session.abort();
    await session.continue({ preserveFollowUps: true });

    expect(continueAgent).toHaveBeenNthCalledWith(1, { preserveFollowUps: true });
    expect(continueAgent).toHaveBeenNthCalledWith(2, { preserveFollowUps: true });
    expect(session.getQueuedFollowUps()).toEqual([
      { id: 'follow-remaining', text: 'remaining follow-up', timestamp: 2 },
    ]);
  });

  it('forwards compaction maxTokens through the real agent streamFn to the provider', async () => {
    const model = mockModel({
      id: 'test-compaction-model',
      api: STREAM_OPTIONS_TEST_API,
      maxTokens: 1234,
    });
    const seenOptions: SimpleStreamOptions[] = [];
    const streamSimple = vi.fn(
      (
        _model: Model<typeof STREAM_OPTIONS_TEST_API>,
        _context: Context,
        options?: SimpleStreamOptions,
      ) => {
        if (options) seenOptions.push(options);
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          stream.push({
            type: 'done',
            reason: 'stop',
            message: assistantMessage('summary', {
              api: STREAM_OPTIONS_TEST_API,
              model: model.id,
              provider: model.provider,
            }),
          });
        });
        return stream;
      },
    );
    registerApiProvider(
      {
        api: STREAM_OPTIONS_TEST_API,
        stream: streamSimple,
        streamSimple,
      },
      STREAM_OPTIONS_TEST_SOURCE,
    );
    registerModel(model, { sourceId: STREAM_OPTIONS_TEST_SOURCE });

    const values: Record<string, unknown> = {
      anthropicApiKey: 'test-key',
      defaultModel: `${model.provider}/${model.id}`,
    };
    const configManager = new ConfigManager({
      cwd: tempDir,
      agentDir: tempDir,
      getConfiguration: () =>
        ({
          get: <T>(key: string) => values[key] as T,
          has: (key: string) => key in values,
          inspect: () => undefined,
          update: async () => undefined,
        }) as never,
    });
    const backingSession = SessionManager.inMemory(tempDir);
    backingSession.appendMessage(userMessage('first prompt'));
    backingSession.appendMessage(assistantMessage('first response'));
    backingSession.appendMessage(userMessage('second prompt'));
    const session = new AgentSession({
      session: backingSession,
      configManager,
      cwd: tempDir,
      logger: { appendLine: vi.fn() },
      skills: [],
    });

    await session.initialize();
    try {
      await session.compact();
    } finally {
      session.dispose();
    }

    expect(streamSimple).toHaveBeenCalledOnce();
    expect(seenOptions).toHaveLength(1);
    expect(seenOptions[0]?.maxTokens).toBe(1234);
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

  it('starts a user message once the prompt is accepted without waiting for the full turn', async () => {
    const session = createSession(tempDir);
    const releaseTurn = createDeferred();
    let turnCompleted = false;
    const handleAgentEvent = (event: unknown) =>
      (
        session as unknown as { handleAgentEvent: (event: unknown) => Promise<void> }
      ).handleAgentEvent(event);
    const prompt = vi.fn(async (messages: AgentMessage[]) => {
      for (const message of messages) {
        await handleAgentEvent({ type: 'message_start', message });
        await handleAgentEvent({ type: 'message_end', message });
      }
      await releaseTurn.promise;
      const assistant = assistantMessage('accepted turn complete');
      await handleAgentEvent({ type: 'message_start', message: assistant });
      await handleAgentEvent({ type: 'message_end', message: assistant });
      await handleAgentEvent({ type: 'turn_end', message: assistant, toolResults: [] });
      await handleAgentEvent({ type: 'agent_end', messages: [assistant] });
    });
    attachFakeAgent(session, {
      prompt,
      state: {
        messages: [],
        model: mockModel(),
        thinkingLevel: 'off',
        tools: [],
      },
    });

    const started = await session.startUserMessage('new session prompt');
    void started.turn.then(() => {
      turnCompleted = true;
    });

    expect(prompt).toHaveBeenCalledOnce();
    expect(
      session.sessionManager
        .getEntries()
        .some(
          (entry) =>
            entry.type === 'message' &&
            getMessageText((entry as { message: AgentMessage }).message) === 'new session prompt',
        ),
    ).toBe(true);
    expect(
      session
        .getSessionMessages()
        .some(({ message }) => getMessageText(message) === 'new session prompt'),
    ).toBe(true);
    expect(turnCompleted).toBe(false);

    releaseTurn.resolve();
    await started.turn;

    expect(turnCompleted).toBe(true);
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

  it('emits Pi-compatible extension lifecycle turn indexes without host retry fields', async () => {
    const session = createSession(tempDir);
    const emitted: unknown[] = [];
    const emit = vi.fn(async (event: unknown) => {
      emitted.push(event);
    });
    (session as unknown as { extensionRunner: unknown }).extensionRunner = { emit };
    const handleAgentEvent = (
      session as unknown as {
        handleAgentEvent: (event: unknown) => Promise<void>;
      }
    ).handleAgentEvent.bind(session);

    await handleAgentEvent({ type: 'agent_start' });
    await handleAgentEvent({ type: 'turn_start' });
    await handleAgentEvent({
      type: 'turn_end',
      message: assistantMessage('first'),
      toolResults: [],
    });
    await handleAgentEvent({ type: 'turn_start' });
    await handleAgentEvent({
      type: 'turn_end',
      message: assistantMessage('second'),
      toolResults: [],
    });
    await handleAgentEvent({ type: 'agent_end', messages: [assistantMessage('done')] });

    expect(emitted).toEqual([
      { type: 'agent_start' },
      { type: 'turn_start', turnIndex: 0, timestamp: expect.any(Number) },
      { type: 'turn_end', turnIndex: 0, message: assistantMessage('first'), toolResults: [] },
      { type: 'turn_start', turnIndex: 1, timestamp: expect.any(Number) },
      { type: 'turn_end', turnIndex: 1, message: assistantMessage('second'), toolResults: [] },
      { type: 'agent_end', messages: [assistantMessage('done')] },
    ]);
    expect(emitted.at(-1)).not.toHaveProperty('willRetry');
  });
});
