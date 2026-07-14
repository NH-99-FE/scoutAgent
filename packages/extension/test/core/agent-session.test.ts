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
import { AgentSession, type AgentSessionEvent } from '../../src/core/agent-session.ts';
import type { FileReviewTurnSnapshot } from '../../src/core/review/file-review.ts';
import { SessionManager } from '../../src/core/session/index.ts';
import { createConfigManager, mockModel, userMessage, assistantMessage } from './test-utils.ts';
import { ConfigManager } from '../../src/config-manager.ts';

const STREAM_OPTIONS_TEST_SOURCE = 'agent-session-compaction-stream-options-test';
const STREAM_OPTIONS_TEST_API = 'test-agent-session-compaction-api';

function createSession(tempDir: string, configValues?: Record<string, unknown>): AgentSession {
  return new AgentSession({
    session: SessionManager.inMemory(tempDir),
    configManager: configValues
      ? createConfigManagerWithValues(tempDir, configValues)
      : createConfigManager(tempDir),
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
  const userConfigDir = path.join(cwd, '.test-scout-agent-values');
  fs.mkdirSync(userConfigDir, { recursive: true });
  const settings: Record<string, unknown> = {};
  const providers: Record<string, Record<string, unknown>> = {};

  for (const [key, value] of Object.entries(values)) {
    if (key === 'openaiProviderApiKey' && typeof value === 'string') {
      providers.openai = { ...(providers.openai ?? {}), apiKey: value };
      continue;
    }
    if (key === 'anthropicProviderApiKey' && typeof value === 'string') {
      providers.anthropic = { ...(providers.anthropic ?? {}), apiKey: value };
      continue;
    }
    if (key === 'defaultModel' && typeof value === 'string') {
      const [provider, modelId] = value.includes('/') ? value.split('/', 2) : ['', value];
      if (provider === 'openai' || provider === 'anthropic') settings.defaultProvider = provider;
      settings.defaultModel = modelId;
      continue;
    }
    if (key === 'extensionPaths') {
      settings.extensions = value;
      continue;
    }
    if (key.includes('.')) {
      setNestedSetting(settings, key, value);
      continue;
    }
    settings[key] = value;
  }

  if (Object.keys(settings).length > 0) {
    fs.writeFileSync(
      path.join(userConfigDir, 'settings.json'),
      `${JSON.stringify(settings, null, 2)}\n`,
      'utf-8',
    );
  }
  if (Object.keys(providers).length > 0) {
    fs.writeFileSync(
      path.join(userConfigDir, 'models.json'),
      `${JSON.stringify({ providers }, null, 2)}\n`,
      'utf-8',
    );
  }

  return new ConfigManager({
    cwd,
    userConfigDir,
  });
}

function setNestedSetting(target: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
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
        anthropicProviderApiKey: 'test-key',
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

  it('uses the configured review tool profile for new sessions', async () => {
    const session = createSession(tempDir, {
      anthropicProviderApiKey: 'test-key',
      defaultToolProfile: 'review',
    });

    await session.initialize();
    try {
      expect(session.getActiveToolSelection()).toEqual({ kind: 'profile', profileId: 'review' });
      expect(session.getActiveToolNames()).toEqual(['read', 'grep', 'find', 'ls']);
      expect(session.getSystemPrompt()).toContain('- grep:');
      expect(session.getSystemPrompt()).not.toContain('- bash:');
    } finally {
      session.dispose();
    }
  });

  it('uses an explicitly requested tool profile for a new session', async () => {
    const session = new AgentSession({
      session: SessionManager.inMemory(tempDir),
      configManager: createConfigManager(tempDir),
      cwd: tempDir,
      logger: { appendLine: vi.fn() },
      skills: [],
      activeToolSelection: { kind: 'profile', profileId: 'review' },
    });

    await session.initialize();
    try {
      expect(session.getActiveToolSelection()).toEqual({ kind: 'profile', profileId: 'review' });
      expect(session.getActiveToolNames()).toEqual(['read', 'grep', 'find', 'ls']);
    } finally {
      session.dispose();
    }
  });

  it('switches tool profiles without mutating session history', async () => {
    const backingSession = SessionManager.inMemory(tempDir);
    const session = new AgentSession({
      session: backingSession,
      configManager: createConfigManager(tempDir),
      cwd: tempDir,
      logger: { appendLine: vi.fn() },
      skills: [],
    });
    await session.initialize();
    const entriesBeforeSwitch = backingSession.getEntries();

    try {
      await session.setToolProfile('review');

      expect(session.getActiveToolSelection()).toEqual({ kind: 'profile', profileId: 'review' });
      expect(session.getActiveToolNames()).toEqual(['read', 'grep', 'find', 'ls']);
      expect(session.getSystemPrompt()).toContain('- grep:');
      expect(session.getSystemPrompt()).not.toContain('- bash:');
      expect(backingSession.getEntries()).toEqual(entriesBeforeSwitch);
    } finally {
      session.dispose();
    }
  });

  it('treats extension tool selection as runtime-only custom state', async () => {
    const session = createSession(tempDir);
    await session.initialize();

    try {
      await session.setActiveTools(['read', 'grep']);

      expect(session.getActiveToolSelection()).toEqual({
        kind: 'custom',
        toolNames: ['read', 'grep'],
      });
      expect(session.getActiveToolNames()).toEqual(['read', 'grep']);
    } finally {
      session.dispose();
    }
  });

  it('uses the current default profile when reopening session history', async () => {
    const backingSession = SessionManager.inMemory(tempDir);
    const first = new AgentSession({
      session: backingSession,
      configManager: createConfigManager(tempDir),
      cwd: tempDir,
      logger: { appendLine: vi.fn() },
      skills: [],
    });
    await first.initialize();
    await first.setToolProfile('review');
    first.dispose();

    const reopened = new AgentSession({
      session: backingSession,
      configManager: createConfigManager(tempDir),
      cwd: tempDir,
      logger: { appendLine: vi.fn() },
      skills: [],
    });
    await reopened.initialize();

    try {
      expect(reopened.getActiveToolSelection()).toEqual({
        kind: 'profile',
        profileId: 'develop',
      });
      expect(reopened.getActiveToolNames()).toEqual(['read', 'bash', 'edit', 'write']);
    } finally {
      reopened.dispose();
    }
  });

  it('uses inherited runtime model and thinking level when initializing an empty replacement session', async () => {
    const inheritedModel = mockModel({
      provider: 'openai',
      id: 'GPT-5.5',
      name: 'Third Party GPT-5.5',
      api: 'openai-completions',
      reasoning: true,
    });
    const backingSession = SessionManager.inMemory(tempDir);
    const session = new AgentSession({
      session: backingSession,
      configManager: createConfigManagerWithValues(tempDir, {
        openaiProviderApiKey: 'test-key',
        defaultThinkingLevel: 'medium',
      }),
      cwd: tempDir,
      logger: { appendLine: vi.fn() },
      skills: [],
      initialModel: inheritedModel,
      initialThinkingLevel: 'off',
      activeToolSelection: { kind: 'custom', toolNames: ['read'] },
    });

    await session.initialize();
    try {
      expect(session.model).toBe(inheritedModel);
      expect(session.thinkingLevel).toBe('off');
      expect(backingSession.buildContext()).toMatchObject({
        model: { provider: 'openai', modelId: 'GPT-5.5' },
        thinkingLevel: 'off',
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
      reasoning: true,
    });
    registerModel(selectedModel, { sourceId: STREAM_OPTIONS_TEST_SOURCE });
    const backingSession = SessionManager.inMemory(tempDir);
    backingSession.appendModelChange(selectedModel.provider, selectedModel.id);
    backingSession.appendThinkingLevelChange('high');
    const session = new AgentSession({
      session: backingSession,
      configManager: createConfigManagerWithValues(tempDir, {
        anthropicProviderApiKey: 'test-key',
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
        anthropicProviderApiKey: 'test-key',
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

  it('preserves restored off thinking for a thinking model that supports it', async () => {
    const selectedModel = mockModel({
      id: 'metadata-only-thinking-model',
      name: 'Metadata Only Thinking Model',
      reasoning: true,
    });
    registerModel(selectedModel, { sourceId: STREAM_OPTIONS_TEST_SOURCE });
    const backingSession = SessionManager.inMemory(tempDir);
    backingSession.appendModelChange(selectedModel.provider, selectedModel.id);
    backingSession.appendThinkingLevelChange('off');
    const session = new AgentSession({
      session: backingSession,
      configManager: createConfigManagerWithValues(tempDir, {
        anthropicProviderApiKey: 'test-key',
        defaultThinkingLevel: 'low',
      }),
      cwd: tempDir,
      logger: { appendLine: vi.fn() },
      skills: [],
    });

    await session.initialize();
    try {
      const thinkingEntries = backingSession
        .getEntries()
        .filter((entry) => entry.type === 'thinking_level_change');

      expect(session.thinkingLevel).toBe('off');
      expect(thinkingEntries).toHaveLength(1);
      expect(thinkingEntries.at(-1)).toMatchObject({ thinkingLevel: 'off' });
      expect(backingSession.buildContext().thinkingLevel).toBe('off');
    } finally {
      session.dispose();
    }
  });

  it('normalizes thinking level when selecting a model', async () => {
    const thinkingModel = mockModel({
      id: 'manual-thinking-model',
      name: 'Manual Thinking Model',
      reasoning: true,
    });
    registerModel(thinkingModel, { sourceId: STREAM_OPTIONS_TEST_SOURCE });
    const session = new AgentSession({
      session: SessionManager.inMemory(tempDir),
      configManager: createConfigManagerWithValues(tempDir, {
        anthropicProviderApiKey: 'test-key',
        defaultThinkingLevel: 'low',
      }),
      cwd: tempDir,
      logger: { appendLine: vi.fn() },
      skills: [],
    });
    attachFakeAgent(session, {
      state: {
        messages: [],
        model: mockModel({ id: 'manual-fast-model', reasoning: false }),
        thinkingLevel: 'off',
        tools: [],
      },
    });

    await session.setModel(thinkingModel.id, thinkingModel.provider);

    expect(session.model).toMatchObject({ id: thinkingModel.id });
    expect(session.thinkingLevel).toBe('low');
    expect(session.sessionManager.buildContext()).toMatchObject({
      model: { provider: thinkingModel.provider, modelId: thinkingModel.id },
      thinkingLevel: 'low',
    });
  });

  it('normalizes thinking level when cycling between model capabilities', async () => {
    const fastModel = mockModel({ id: 'cycle-fast-model', reasoning: false });
    const thinkingModel = mockModel({ id: 'cycle-thinking-model', reasoning: true });
    const configManager = createConfigManagerWithValues(tempDir, {
      anthropicProviderApiKey: 'test-key',
      defaultThinkingLevel: 'low',
    });
    vi.spyOn(configManager, 'getAvailableModels').mockReturnValue([
      { id: fastModel.id, name: fastModel.name, provider: fastModel.provider, model: fastModel },
      {
        id: thinkingModel.id,
        name: thinkingModel.name,
        provider: thinkingModel.provider,
        model: thinkingModel,
      },
    ]);
    const session = new AgentSession({
      session: SessionManager.inMemory(tempDir),
      configManager,
      cwd: tempDir,
      logger: { appendLine: vi.fn() },
      skills: [],
    });
    attachFakeAgent(session, {
      state: {
        messages: [],
        model: fastModel,
        thinkingLevel: 'off',
        tools: [],
      },
    });

    await expect(session.cycleModel('forward')).resolves.toMatchObject({
      model: { id: thinkingModel.id },
      thinkingLevel: 'low',
    });
    expect(session.thinkingLevel).toBe('low');

    await expect(session.cycleModel('forward')).resolves.toMatchObject({
      model: { id: fastModel.id },
      thinkingLevel: 'off',
    });
    expect(session.thinkingLevel).toBe('off');
  });

  it('normalizes manual thinking selection before writing runtime state', async () => {
    const thinkingModel = mockModel({ id: 'thinking-select-model', reasoning: true });
    const session = createSession(tempDir);
    const events: unknown[] = [];
    session.subscribe((event) => events.push(event));
    attachFakeAgent(session, {
      state: {
        messages: [],
        model: thinkingModel,
        thinkingLevel: 'high',
        tools: [],
      },
    });

    await session.setThinkingLevel('off');

    expect(session.thinkingLevel).toBe('off');
    expect(session.sessionManager.buildContext().thinkingLevel).toBe('off');
    expect(events).toContainEqual({ type: 'thinking_level_changed', level: 'off' });
  });

  it('aborts and disconnects the current agent before manual compaction', async () => {
    const session = createSession(tempDir, { 'compaction.keepRecentTokens': 1 });
    session.sessionManager.appendMessage(userMessage('first prompt'));
    session.sessionManager.appendMessage(assistantMessage('first response'));
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
    (session as unknown as { rebuildCachedSessionBranch: unknown }).rebuildCachedSessionBranch =
      vi.fn(async () => undefined);

    await session.compact();

    expect(order).toEqual(['unsubscribe', 'abort', 'compact', 'subscribe']);
  });

  it('skips manual compaction before the session has conversation messages', async () => {
    const session = createSession(tempDir);
    const abort = vi.fn();
    const runCompactionCore = vi.fn();
    const events: AgentSessionEvent[] = [];
    session.subscribe((event) => events.push(event));
    attachFakeAgent(session, {
      abort,
      hasQueuedMessages: vi.fn(() => false),
      subscribe: vi.fn(() => vi.fn()),
      state: {
        messages: [],
        model: mockModel(),
        thinkingLevel: 'off',
        tools: [],
      },
    });
    (session as unknown as { runCompactionCore: unknown }).runCompactionCore = runCompactionCore;

    await session.compact();

    expect(abort).not.toHaveBeenCalled();
    expect(runCompactionCore).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: 'notification',
      level: 'warning',
      message: '当前没有可压缩的上下文',
    });
  });

  it('skips manual compaction when the branch only has metadata entries', async () => {
    const session = createSession(tempDir);
    const selectedModel = mockModel();
    session.sessionManager.appendModelChange(selectedModel.provider, selectedModel.id);
    session.sessionManager.appendThinkingLevelChange('off');
    const abort = vi.fn();
    const runCompactionCore = vi.fn();
    const events: AgentSessionEvent[] = [];
    session.subscribe((event) => events.push(event));
    attachFakeAgent(session, {
      abort,
      hasQueuedMessages: vi.fn(() => false),
      subscribe: vi.fn(() => vi.fn()),
      state: {
        messages: [],
        model: selectedModel,
        thinkingLevel: 'off',
        tools: [],
      },
    });
    (session as unknown as { runCompactionCore: unknown }).runCompactionCore = runCompactionCore;

    await session.compact();

    expect(abort).not.toHaveBeenCalled();
    expect(runCompactionCore).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: 'notification',
      level: 'warning',
      message: '当前没有可压缩的上下文',
    });
  });

  it('skips manual compaction when no messages would be summarized', async () => {
    const session = createSession(tempDir);
    session.sessionManager.appendMessage(userMessage('short prompt'));
    session.sessionManager.appendMessage(assistantMessage('short response'));
    const abort = vi.fn();
    const runCompactionCore = vi.fn();
    const events: AgentSessionEvent[] = [];
    session.subscribe((event) => events.push(event));
    attachFakeAgent(session, {
      abort,
      hasQueuedMessages: vi.fn(() => false),
      subscribe: vi.fn(() => vi.fn()),
      state: {
        messages: [],
        model: mockModel(),
        thinkingLevel: 'off',
        tools: [],
      },
    });
    (session as unknown as { runCompactionCore: unknown }).runCompactionCore = runCompactionCore;

    await session.compact();

    expect(abort).not.toHaveBeenCalled();
    expect(runCompactionCore).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: 'notification',
      level: 'warning',
      message: '当前没有可压缩的上下文',
    });
  });

  it('allows manual compaction when custom context can be summarized', async () => {
    const session = createSession(tempDir, { 'compaction.keepRecentTokens': 1 });
    const customEntryId = session.sessionManager.appendCustomMessageEntry(
      'hidden-style',
      'style context',
      false,
    );
    session.sessionManager.appendMessage(userMessage('prompt to summarize'));
    session.sessionManager.appendMessage(assistantMessage('kept response'));
    const abort = vi.fn();
    const runCompactionCore = vi.fn(async () => ({
      summary: 'summary',
      firstKeptEntryId: customEntryId,
      tokensBefore: 100,
    }));
    const syncRuntimeMessagesFromSession = vi.fn(async () => []);
    const rebuildCachedSessionBranch = vi.fn(async () => undefined);
    const events: AgentSessionEvent[] = [];
    session.subscribe((event) => events.push(event));
    attachFakeAgent(session, {
      abort,
      hasQueuedMessages: vi.fn(() => false),
      subscribe: vi.fn(() => vi.fn()),
      state: {
        messages: [],
        model: mockModel(),
        thinkingLevel: 'off',
        tools: [],
      },
    });
    (session as unknown as { runCompactionCore: unknown }).runCompactionCore = runCompactionCore;
    (
      session as unknown as { syncRuntimeMessagesFromSession: unknown }
    ).syncRuntimeMessagesFromSession = syncRuntimeMessagesFromSession;
    (session as unknown as { rebuildCachedSessionBranch: unknown }).rebuildCachedSessionBranch =
      rebuildCachedSessionBranch;

    await session.compact();

    expect(abort).toHaveBeenCalledOnce();
    expect(runCompactionCore).toHaveBeenCalledOnce();
    expect(syncRuntimeMessagesFromSession).toHaveBeenCalledOnce();
    expect(rebuildCachedSessionBranch).toHaveBeenCalledOnce();
    expect(events).toContainEqual({ type: 'tree_change' });
  });

  it('emits tree changes after auto compaction succeeds', async () => {
    const session = createSession(tempDir);
    const events: AgentSessionEvent[] = [];
    session.subscribe((event) => events.push(event));
    attachFakeAgent(session, {
      hasQueuedMessages: vi.fn(() => false),
      state: {
        messages: [],
        model: mockModel(),
        thinkingLevel: 'off',
        tools: [],
      },
    });
    const runCompactionCore = vi.fn(async () => ({
      summary: 'summary',
      firstKeptEntryId: 'entry-1',
      tokensBefore: 100,
    }));
    (session as unknown as { runCompactionCore: unknown }).runCompactionCore = runCompactionCore;
    (
      session as unknown as { syncRuntimeMessagesFromSession: unknown }
    ).syncRuntimeMessagesFromSession = vi.fn(async () => []);
    (session as unknown as { rebuildCachedSessionBranch: unknown }).rebuildCachedSessionBranch =
      vi.fn(async () => undefined);
    (
      session as unknown as { hasContinuationPendingMessages: unknown }
    ).hasContinuationPendingMessages = vi.fn(() => false);

    const runAutoCompaction = (
      session as unknown as { runAutoCompaction: (reason: 'threshold') => Promise<boolean> }
    ).runAutoCompaction.bind(session);

    await expect(runAutoCompaction('threshold')).resolves.toBe(false);

    expect(runCompactionCore).toHaveBeenCalledOnce();
    expect(events).toContainEqual({ type: 'tree_change' });
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
      anthropicProviderApiKey: 'test-key',
      defaultModel: `${model.provider}/${model.id}`,
      'compaction.keepRecentTokens': 1,
    };
    const configManager = createConfigManagerWithValues(tempDir, values);
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

  it('allows extension tool_call input mutations to patch tool execution args', async () => {
    const session = createSession(tempDir);
    const args = { command: 'echo safe' };
    const emitToolCall = vi.fn(async (event: { input: Record<string, unknown> }) => {
      event.input.command = 'echo patched';
      return undefined;
    });
    (session as unknown as { extensionRunner: unknown }).extensionRunner = { emitToolCall };

    const result = await (
      session as unknown as {
        handleBeforeToolCall: (context: unknown) => Promise<unknown>;
      }
    ).handleBeforeToolCall({
      assistantMessage: assistantMessage('tool'),
      toolCall: { id: 'call-1', name: 'bash' },
      args,
      context: {},
    });

    expect(result).toBeUndefined();
    expect(emitToolCall).toHaveBeenCalledWith({
      type: 'tool_call',
      toolCallId: 'call-1',
      toolName: 'bash',
      input: { command: 'echo patched' },
    });
    expect(args).toEqual({ command: 'echo patched' });
  });

  it('stores tool review results as file_change details and scopes review turns per agent run', async () => {
    const model = mockModel({
      id: 'file-review-loop-model',
      api: STREAM_OPTIONS_TEST_API,
    });
    let streamCallIndex = 0;
    const streamSimple = vi.fn(
      (
        _model: Model<typeof STREAM_OPTIONS_TEST_API>,
        _context: Context,
        _options?: SimpleStreamOptions,
      ) => {
        const callIndex = streamCallIndex++;
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          if (callIndex === 0) {
            stream.push({
              type: 'done',
              reason: 'toolUse',
              message: assistantMessage('', {
                api: STREAM_OPTIONS_TEST_API,
                model: model.id,
                provider: model.provider,
                stopReason: 'toolUse',
                content: [
                  {
                    type: 'toolCall',
                    id: 'edit-a-1',
                    name: 'edit',
                    arguments: {
                      path: 'a.txt',
                      edits: [{ oldText: 'old-a', newText: 'new-a' }],
                    },
                  },
                  {
                    type: 'toolCall',
                    id: 'edit-b-1',
                    name: 'edit',
                    arguments: {
                      path: 'b.txt',
                      edits: [{ oldText: 'old-b', newText: 'new-b' }],
                    },
                  },
                ],
              }),
            });
            return;
          }
          if (callIndex === 2) {
            stream.push({
              type: 'done',
              reason: 'toolUse',
              message: assistantMessage('', {
                api: STREAM_OPTIONS_TEST_API,
                model: model.id,
                provider: model.provider,
                stopReason: 'toolUse',
                content: [
                  {
                    type: 'toolCall',
                    id: 'edit-a-2',
                    name: 'edit',
                    arguments: {
                      path: 'a.txt',
                      edits: [{ oldText: 'new-a', newText: 'final-a' }],
                    },
                  },
                ],
              }),
            });
            return;
          }
          stream.push({
            type: 'done',
            reason: 'stop',
            message: assistantMessage('done', {
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

    fs.writeFileSync(path.join(tempDir, 'a.txt'), 'old-a\n', 'utf-8');
    fs.writeFileSync(path.join(tempDir, 'b.txt'), 'old-b\n', 'utf-8');
    const reviews: FileReviewTurnSnapshot[] = [];
    const session = new AgentSession({
      session: SessionManager.inMemory(tempDir),
      configManager: createConfigManagerWithValues(tempDir, {
        anthropicProviderApiKey: 'test-key',
        defaultModel: `${model.provider}/${model.id}`,
      }),
      cwd: tempDir,
      logger: { appendLine: vi.fn() },
      skills: [],
      onFileReviewUpdated: (_session, review) => {
        reviews.push(review);
      },
    });

    await session.initialize();
    try {
      await session.sendUserMessage('edit first pair');
      await session.sendUserMessage('edit again');
    } finally {
      session.dispose();
    }

    const toolResultDetails = session.sessionManager
      .getEntries()
      .flatMap((entry) =>
        entry.type === 'message' && entry.message.role === 'toolResult'
          ? [entry.message.details as { kind?: string; path?: string; displayPath?: string }]
          : [],
      );

    expect(toolResultDetails).toHaveLength(3);
    expect(toolResultDetails.every((details) => details.kind === 'file_change')).toBe(true);
    expect(toolResultDetails.map((details) => details.path).sort()).toEqual([
      path.join(tempDir, 'a.txt'),
      path.join(tempDir, 'a.txt'),
      path.join(tempDir, 'b.txt'),
    ]);
    expect(toolResultDetails.map((details) => details.displayPath).sort()).toEqual([
      'a.txt',
      'a.txt',
      'b.txt',
    ]);
    expect(JSON.stringify(toolResultDetails)).not.toContain('file_review_payload');

    expect(reviews).toHaveLength(3);
    expect(reviews[1]?.turnId).toBe(reviews[0]?.turnId);
    expect(reviews[0]?.records).toHaveLength(1);
    expect(reviews[1]?.records).toHaveLength(2);
    expect(reviews[2]?.turnId).not.toBe(reviews[0]?.turnId);
    expect(reviews[2]?.records).toHaveLength(1);
    expect(reviews[0]?.turnId).toContain(':run-');
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
    expect(session.getSessionBranch()).toEqual([]);
  });

  it('keeps runtime tool profile unchanged during tree navigation', async () => {
    const session = createSession(tempDir);
    const backingSession = session.sessionManager;

    await session.initialize();
    try {
      backingSession.appendMessage(userMessage('review branch'));
      const targetId = backingSession.appendMessage(assistantMessage('review response'));
      await session.setToolProfile('review');

      await session.navigateTree(targetId, { summarize: false });

      expect(session.getActiveToolSelection()).toEqual({ kind: 'profile', profileId: 'review' });
      expect(session.getActiveToolNames()).toEqual(['read', 'grep', 'find', 'ls']);
    } finally {
      session.dispose();
    }
  });

  it('propagates label write failures without emitting duplicate user-visible errors', async () => {
    const session = createSession(tempDir);
    const events: AgentSessionEvent[] = [];
    session.subscribe((event) => events.push(event));

    await expect(session.setLabel('missing-entry', 'Pinned')).rejects.toThrow(
      'Entry missing-entry not found',
    );

    expect(events).not.toContainEqual({
      type: 'error',
      message: 'Set label failed: Entry missing-entry not found',
    });
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

  it('keeps composer presentation attached to queued user messages', async () => {
    const session = createSession(tempDir);
    const steer = vi.fn();
    attachFakeAgent(session, {
      steer,
      state: {
        messages: [],
        model: mockModel(),
        thinkingLevel: 'off',
        tools: [],
      },
    });
    const presentation = { segments: [{ type: 'text', text: 'queued' }] };

    await session.steer('queued', { userMessageDetails: presentation });

    const queuedMessage = steer.mock.calls[0]?.[0] as AgentMessage;
    expect(session.getUserMessageDetails(queuedMessage)).toBe(presentation);
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

    const presentation = { segments: [{ type: 'text', text: 'new session prompt' }] };
    const started = await session.startUserMessage('new session prompt', {
      details: presentation,
    });
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
      session.sessionManager
        .getEntries()
        .find(
          (entry) =>
            entry.type === 'message' &&
            getMessageText((entry as { message: AgentMessage }).message) === 'new session prompt',
        ),
    ).toMatchObject({ details: presentation });
    expect(
      session
        .getSessionBranch()
        .some(
          (entry) =>
            entry.type === 'message' &&
            getMessageText((entry as { message: AgentMessage }).message) === 'new session prompt',
        ),
    ).toBe(true);
    expect(turnCompleted).toBe(false);

    releaseTurn.resolve();
    await started.turn;

    expect(turnCompleted).toBe(true);
  });

  it('emits tree changes when session messages are persisted', async () => {
    const session = createSession(tempDir);
    const events: AgentSessionEvent[] = [];
    session.subscribe((event) => events.push(event));
    attachFakeAgent(session, {
      state: {
        messages: [],
        model: mockModel(),
        thinkingLevel: 'off',
        tools: [],
      },
    });
    const handleAgentEvent = (
      session as unknown as {
        handleAgentEvent: (event: unknown) => Promise<void>;
      }
    ).handleAgentEvent.bind(session);

    await handleAgentEvent({ type: 'message_end', message: userMessage('new prompt') });

    expect(events).toContainEqual({ type: 'tree_change' });
    events.length = 0;

    await session.recordBashResult('echo ok', {
      output: 'ok',
      exitCode: 0,
      cancelled: false,
      truncated: false,
    });

    expect(events).toContainEqual({ type: 'tree_change' });
    events.length = 0;

    await session.sendMessage('custom note');

    expect(events).toContainEqual({ type: 'tree_change' });
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
