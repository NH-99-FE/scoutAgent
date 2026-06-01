/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================
// SessionManager 测试（协调层职责）
// 覆盖：initialize / restore / newSession / listSessions / delegate
// 详细的 retry/compaction/fork/tree 测试已迁移到 agent-session.test.ts
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- 预定义 mock 值 ----------

const {
  mockFindDefaultModel,
  mockGetApiKey,
  mockGetShellPath,
  mockHarnessSubscribe,
  mockHarnessPrompt,
  mockHarnessAbort,
  mockHarnessSetModel,
  mockHarnessSetThinkingLevel,
  mockHarnessCompact,
  mockHarnessSetTools,
  mockHarnessGetModel,
  mockHarnessGetThinkingLevel,
  mockHarnessOn,
  mockSessionBuildContext,
  mockSessionGetMetadata,
  mockSessionGetBranch,
  mockSessionGetEntries,
  mockSessionGetLeafId,
  mockSessionRepoFork,
  MockAgentHarness,
} = vi.hoisted(() => {
  const mockHarnessSubscribe = vi.fn(() => vi.fn());
  const mockHarnessPrompt = vi.fn();
  const mockHarnessAbort = vi.fn();
  const mockHarnessSetModel = vi.fn();
  const mockHarnessSetThinkingLevel = vi.fn();
  const mockHarnessCompact = vi.fn();
  const mockHarnessSetTools = vi.fn();
  const mockHarnessGetModel = vi.fn(() => ({
    id: 'test-model',
    contextWindow: 200000,
    input: ['text', 'image'],
  }));
  const mockHarnessGetThinkingLevel = vi.fn(() => 'off');
  const mockHarnessGetContextUsage = vi.fn(() => ({
    tokens: 1000,
    usageTokens: 800,
    trailingTokens: 200,
    lastUsageIndex: 1,
  }));
  const mockHarnessOn = vi.fn(() => vi.fn());

  const mockSessionBuildContext = vi.fn(async () => ({
    messages: [],
    thinkingLevel: 'off',
    model: null,
  }));
  const mockSessionGetMetadata = vi.fn(async () => ({
    id: 'test-session',
    createdAt: new Date().toISOString(),
  }));
  const mockSessionGetBranch = vi.fn(async () => []);
  const mockSessionGetEntries = vi.fn(async () => [] as any[]);
  const mockSessionGetLeafId = vi.fn(async () => null as string | null);
  const mockSessionRepoFork = vi.fn();

  const MockAgentHarness = vi.fn(function (this: any) {
    this.subscribe = mockHarnessSubscribe;
    this.prompt = mockHarnessPrompt;
    this.abort = mockHarnessAbort;
    this.setModel = mockHarnessSetModel;
    this.setThinkingLevel = mockHarnessSetThinkingLevel;
    this.compact = mockHarnessCompact;
    this.steer = vi.fn();
    this.followUp = vi.fn();
    this.nextTurn = vi.fn();
    this.setTools = mockHarnessSetTools;
    this.hasPendingMessages = vi.fn(() => false);
    this.getSignal = vi.fn(() => undefined);
    this.getModel = mockHarnessGetModel;
    this.getThinkingLevel = mockHarnessGetThinkingLevel;
    this.getContextUsage = mockHarnessGetContextUsage;
    this.navigateTree = vi.fn(async () => ({ cancelled: false }));
    this.on = mockHarnessOn;
  });

  return {
    mockFindDefaultModel: vi.fn(() => ({
      id: 'test-model',
      api: 'anthropic',
      provider: 'anthropic',
      input: ['text', 'image'],
    })),
    mockGetApiKey: vi.fn(() => 'test-api-key'),
    mockGetShellPath: vi.fn(() => undefined),
    mockHarnessSubscribe,
    mockHarnessPrompt,
    mockHarnessAbort,
    mockHarnessSetModel,
    mockHarnessSetThinkingLevel,
    mockHarnessCompact,
    mockHarnessSetTools,
    mockHarnessGetModel,
    mockHarnessGetThinkingLevel,
    mockHarnessOn,
    mockSessionBuildContext,
    mockSessionGetMetadata,
    mockSessionGetBranch,
    mockSessionGetEntries,
    mockSessionGetLeafId,
    mockSessionRepoFork,
    MockAgentHarness,
  };
});

// ---------- Mock vscode ----------

vi.mock('vscode', () => ({
  Uri: {
    parse: vi.fn(),
    file: vi.fn((p: string) => ({ fsPath: p })),
    joinPath: vi.fn((base: any, ...segments: string[]) => ({
      fsPath: segments.reduce((acc, seg) => `${acc}/${seg}`, base.fsPath ?? ''),
    })),
  },
  Disposable: class {
    dispose() {}
  },
  window: {
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      append: vi.fn(),
      clear: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  workspace: {
    getConfiguration: vi.fn(),
    onDidChangeConfiguration: vi.fn(),
    workspaceFolders: [],
  },
}));

// ---------- Mock @scout-agent/agent ----------

vi.mock('@scout-agent/agent', () => ({
  AgentHarness: MockAgentHarness,
  JsonlSessionRepo: vi.fn(function (this: any) {
    this.create = vi.fn(async () => ({
      buildContext: mockSessionBuildContext,
      getMetadata: mockSessionGetMetadata,
      getBranch: mockSessionGetBranch,
      moveTo: vi.fn(async () => undefined),
      getEntries: mockSessionGetEntries,
      appendLabel: vi.fn(async () => 'label-entry-1'),
      getLeafId: mockSessionGetLeafId,
    }));
    this.open = vi.fn(async () => ({
      buildContext: mockSessionBuildContext,
      getMetadata: mockSessionGetMetadata,
      getBranch: mockSessionGetBranch,
      moveTo: vi.fn(async () => undefined),
      getEntries: mockSessionGetEntries,
      appendLabel: vi.fn(async () => 'label-entry-1'),
      getLeafId: mockSessionGetLeafId,
    }));
    this.list = vi.fn(async () => []);
    this.fork = mockSessionRepoFork;
  }),
  shouldCompact: vi.fn(() => false),
  calculateContextTokens: vi.fn(() => 0),
  estimateContextTokens: vi.fn(() => ({ tokens: 0, lastUsageIndex: null })),
  DEFAULT_ACTIVE_TOOL_NAMES: ['read', 'bash', 'edit', 'write'],
}));

vi.mock('@scout-agent/agent/node', () => ({
  NodeExecutionEnv: vi.fn(function (this: any) {}),
}));

vi.mock('../protocol/agent-event-mapper.ts', () => ({
  mapAgentEventToScout: vi.fn(() => ({ type: 'agent_start' })),
  convertMessage: vi.fn(() => null),
}));

// ---------- Mock @scout-agent/ai ----------

vi.mock('@scout-agent/ai', () => ({
  getProviders: vi.fn(() => []),
  getModels: vi.fn(() => []),
  getModel: vi.fn(),
}));

// ---------- Mock @scout-agent/shared ----------

vi.mock('@scout-agent/shared', () => ({}));

// ---------- Mock internal modules ----------

vi.mock('../config-manager.ts', () => ({
  ConfigManager: vi.fn(function (this: any) {
    this.findDefaultModel = mockFindDefaultModel;
    this.findModel = vi.fn((id: string) => ({
      id,
      api: 'anthropic',
      provider: 'anthropic',
      input: ['text', 'image'],
    }));
    this.getApiKey = mockGetApiKey;
    this.getShellPath = mockGetShellPath;
    this.getDefaultThinkingLevel = vi.fn(() => 'off');
    this.getCompactionSettings = vi.fn(() => ({
      enabled: true,
      reserveTokens: 16384,
      keepRecentTokens: 20000,
    }));
    this.getSteeringMode = vi.fn(() => 'one-at-a-time');
    this.getFollowUpMode = vi.fn(() => 'one-at-a-time');
    this.getRetrySettings = vi.fn(() => ({ enabled: true, maxRetries: 3, baseDelayMs: 2000 }));
    this.getScoutConfig = vi.fn(() => ({ models: [], defaultModelId: 'test-model' }));
    this.onDidChangeSettings = vi.fn(() => ({ dispose: vi.fn() }));
    this.getExtensionPaths = vi.fn(() => []);
  }),
}));

vi.mock('../skill-loader.ts', () => ({
  loadSkills: vi.fn(() => ({ skills: [], diagnostics: [] })),
}));

vi.mock('../system-prompt.ts', () => ({
  buildSystemPrompt: vi.fn(() => 'System prompt'),
}));

vi.mock('../tools/index.ts', () => ({
  createBuiltinToolDefinitionEntries: vi.fn((_cwd: string, names: string[]) =>
    names.map((name) => ({
      definition: {
        name,
        label: name,
        description: `${name} tool`,
        parameters: {},
      },
      sourceInfo: {
        path: `<builtin:${name}>`,
        source: 'builtin',
        scope: 'temporary',
        origin: 'top-level',
      },
    })),
  ),
  createTools: vi.fn((_cwd: string, names: string[]) =>
    names.map((name) => ({
      name,
      label: name,
      description: `${name} tool`,
      parameters: {},
      execute: vi.fn(),
    })),
  ),
  DEFAULT_ACTIVE_TOOL_NAMES: ['read', 'bash', 'edit', 'write'],
  ALL_TOOL_NAMES: new Set(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']),
}));

vi.mock('../extensions/index.ts', () => ({
  ScoutExtensionRunner: vi.fn(),
  wrapRegisteredTools: vi.fn(() => []),
  discoverAndLoadExtensions: vi.fn(async () => ({ extensions: [], errors: [], runtime: {} })),
}));

// ---------- 测试辅助 ----------

import { SessionManager } from '../session-manager.ts';
import { ConfigManager } from '../config-manager.ts';
import { ScoutExtensionRunner, discoverAndLoadExtensions } from '../extensions/index.ts';

function makeOutputChannel() {
  return {
    appendLine: vi.fn(),
    append: vi.fn(),
    clear: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  } as any;
}

function makeSessionManager(): SessionManager {
  const configManager = new ConfigManager({
    cwd: '/test/project',
    agentDir: '/test/project/.scout',
  } as any);
  return new SessionManager({
    cwd: '/test/project',
    agentDir: '/test/project/.scout',
    outputChannel: makeOutputChannel(),
    configManager,
  });
}

async function makeInitializedSessionManager(): Promise<SessionManager> {
  const manager = makeSessionManager();
  await manager.initialize();
  return manager;
}

function makeMockExtensionRunner(overrides?: Record<string, unknown>) {
  return {
    bindCore: vi.fn(),
    getAllRegisteredTools: vi.fn(() => []),
    hasHandlers: vi.fn(() => false),
    emitSessionBeforeSwitch: vi.fn(),
    emitSessionBeforeFork: vi.fn(),
    invalidate: vi.fn(),
    ...overrides,
  };
}

async function makeInitializedSessionManagerWithExtensionRunner(
  extensionRunner: ReturnType<typeof makeMockExtensionRunner>,
): Promise<SessionManager> {
  vi.mocked(discoverAndLoadExtensions).mockResolvedValueOnce({
    extensions: [
      {
        path: '<test-extension>',
        resolvedPath: '<test-extension>',
        handlers: new Map(),
        tools: new Map(),
      },
    ],
    errors: [],
    runtime: {} as any,
  });
  vi.mocked(ScoutExtensionRunner).mockImplementationOnce(function (this: any) {
    return extensionRunner as any;
  });

  return makeInitializedSessionManager();
}

// ---------- initialize / restore / newSession / listSessions ----------

describe('SessionManager — 协调层', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindDefaultModel.mockReturnValue({
      id: 'test-model',
      api: 'anthropic',
      provider: 'anthropic',
      input: ['text', 'image'],
    });
    mockGetApiKey.mockReturnValue('test-api-key');
    mockHarnessSubscribe.mockReturnValue(vi.fn());
    mockHarnessOn.mockReturnValue(vi.fn());
    mockSessionBuildContext.mockResolvedValue({ messages: [], thinkingLevel: 'off', model: null });
    mockSessionGetMetadata.mockResolvedValue({
      id: 'test-session',
      createdAt: new Date().toISOString(),
    });
    mockHarnessGetModel.mockReturnValue({
      id: 'test-model',
      contextWindow: 200000,
      input: ['text', 'image'],
    });
    mockHarnessGetThinkingLevel.mockReturnValue('off');
    mockSessionGetBranch.mockResolvedValue([]);
    mockSessionGetEntries.mockResolvedValue([]);
    mockSessionGetLeafId.mockResolvedValue(null);
  });

  it('initialize emits state_change', async () => {
    const manager = makeSessionManager();
    const listener = vi.fn();
    manager.subscribe(listener);

    await manager.initialize();

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'state_change' }));
    manager.dispose();
  });

  it('initialize emits error when no model available', async () => {
    mockFindDefaultModel.mockReturnValue(undefined as any);

    const manager = makeSessionManager();
    const listener = vi.fn();
    manager.subscribe(listener);

    await manager.initialize();

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('No model available'),
      }),
    );
    manager.dispose();
  });

  it('initialize is idempotent (second call ignored while initializing)', async () => {
    const manager = makeSessionManager();
    // 并发调用两次
    await Promise.all([manager.initialize(), manager.initialize()]);
    // 不抛错即可
    manager.dispose();
  });

  it('restore emits state_change', async () => {
    const manager = makeSessionManager();
    const listener = vi.fn();
    manager.subscribe(listener);

    await manager.restore({ id: 'restored-session', createdAt: new Date().toISOString() } as any);

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'state_change' }));
    manager.dispose();
  });

  it('restore sets sessionId from metadata', async () => {
    mockSessionGetMetadata.mockResolvedValue({
      id: 'restored-abc',
      createdAt: new Date().toISOString(),
    });

    const manager = makeSessionManager();
    await manager.restore({ id: 'restored-abc', createdAt: new Date().toISOString() } as any);

    expect(manager.sessionId).toBe('restored-abc');
    manager.dispose();
  });

  it('newSession disposes old session and re-initializes', async () => {
    const manager = await makeInitializedSessionManager();

    const listener = vi.fn();
    manager.subscribe(listener);

    await manager.newSession();

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'state_change' }));
    manager.dispose();
  });

  it('newSession stops when session_before_switch cancels', async () => {
    const extensionRunner = makeMockExtensionRunner({
      hasHandlers: vi.fn((eventType: string) => eventType === 'session_before_switch'),
      emitSessionBeforeSwitch: vi.fn(async () => ({ cancel: true })),
    });
    const manager = await makeInitializedSessionManagerWithExtensionRunner(extensionRunner);
    const harnessCount = MockAgentHarness.mock.calls.length;

    await manager.newSession();

    expect(extensionRunner.emitSessionBeforeSwitch).toHaveBeenCalledWith({
      type: 'session_before_switch',
      reason: 'new',
      targetSessionFile: undefined,
    });
    expect(MockAgentHarness).toHaveBeenCalledTimes(harnessCount);
    manager.dispose();
  });

  it('restore stops when session_before_switch cancels', async () => {
    const extensionRunner = makeMockExtensionRunner({
      hasHandlers: vi.fn((eventType: string) => eventType === 'session_before_switch'),
      emitSessionBeforeSwitch: vi.fn(async () => ({ cancel: true })),
    });
    const manager = await makeInitializedSessionManagerWithExtensionRunner(extensionRunner);
    const harnessCount = MockAgentHarness.mock.calls.length;

    await manager.restore({
      id: 'cancelled-session',
      cwd: '/test/project',
      path: '/sessions/cancelled.jsonl',
      createdAt: new Date().toISOString(),
    });

    expect(extensionRunner.emitSessionBeforeSwitch).toHaveBeenCalledWith({
      type: 'session_before_switch',
      reason: 'resume',
      targetSessionFile: '/sessions/cancelled.jsonl',
    });
    expect(MockAgentHarness).toHaveBeenCalledTimes(harnessCount);
    manager.dispose();
  });

  it('listSessions returns empty when no repo', async () => {
    const manager = makeSessionManager();
    const sessions = await manager.listSessions();
    expect(sessions).toEqual([]);
    manager.dispose();
  });

  it('listSessions returns repo results after initialize', async () => {
    const mockList = vi.fn(async () => [{ id: 'session-1', createdAt: new Date().toISOString() }]);
    const { JsonlSessionRepo } = await import('@scout-agent/agent');
    (JsonlSessionRepo as any).mockImplementationOnce(function (this: any) {
      this.create = vi.fn(async () => ({
        buildContext: mockSessionBuildContext,
        getMetadata: mockSessionGetMetadata,
        getBranch: mockSessionGetBranch,
        moveTo: vi.fn(),
        getEntries: mockSessionGetEntries,
        appendLabel: vi.fn(async () => 'lbl'),
        getLeafId: mockSessionGetLeafId,
      }));
      this.list = mockList;
      this.fork = mockSessionRepoFork;
    });

    const manager = await makeInitializedSessionManager();
    const sessions = await manager.listSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).toBe('session-1');
    manager.dispose();
  });

  it('dispose cleans up without error', async () => {
    const manager = makeSessionManager();
    manager.dispose();
    manager.dispose(); // 幂等
  });

  it('subscribe returns unsubscribe function', async () => {
    const manager = await makeInitializedSessionManager();
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);

    manager['emit']({ type: 'state_change' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    manager['emit']({ type: 'state_change' });
    expect(listener).toHaveBeenCalledTimes(1);

    manager.dispose();
  });
});

// ---------- 属性与委托 ----------

describe('SessionManager — 属性与委托', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindDefaultModel.mockReturnValue({
      id: 'test-model',
      api: 'anthropic',
      provider: 'anthropic',
      input: ['text', 'image'],
    });
    mockGetApiKey.mockReturnValue('test-api-key');
    mockHarnessSubscribe.mockReturnValue(vi.fn());
    mockHarnessOn.mockReturnValue(vi.fn());
    mockSessionBuildContext.mockResolvedValue({ messages: [], thinkingLevel: 'off', model: null });
    mockSessionGetMetadata.mockResolvedValue({
      id: 'test-session',
      createdAt: new Date().toISOString(),
    });
    mockHarnessGetModel.mockReturnValue({
      id: 'test-model',
      contextWindow: 200000,
      input: ['text', 'image'],
    });
    mockHarnessGetThinkingLevel.mockReturnValue('off');
    mockSessionGetBranch.mockResolvedValue([]);
    mockSessionGetEntries.mockResolvedValue([]);
    mockSessionGetLeafId.mockResolvedValue(null);
  });

  it('model returns undefined before initialize', () => {
    const manager = makeSessionManager();
    expect(manager.model).toBeUndefined();
    manager.dispose();
  });

  it('model returns value after initialize', async () => {
    const manager = await makeInitializedSessionManager();
    expect(manager.model?.id).toBe('test-model');
    manager.dispose();
  });

  it('thinkingLevel returns fallback before initialize', () => {
    const manager = makeSessionManager();
    expect(manager.thinkingLevel).toBe('off');
    manager.dispose();
  });

  it('isStreaming is false before initialize', () => {
    const manager = makeSessionManager();
    expect(manager.isStreaming).toBe(false);
    manager.dispose();
  });

  it('isStreaming is false after initialize (idle)', async () => {
    const manager = await makeInitializedSessionManager();
    expect(manager.isStreaming).toBe(false);
    manager.dispose();
  });

  it('getScoutMessages returns empty before initialize', () => {
    const manager = makeSessionManager();
    expect(manager.getScoutMessages()).toEqual([]);
    manager.dispose();
  });

  it('prompt delegates to agentSession', async () => {
    const manager = await makeInitializedSessionManager();
    await manager.prompt('Hello');
    expect(mockHarnessPrompt).toHaveBeenCalledWith('Hello');
    manager.dispose();
  });

  it('abort delegates to agentSession', async () => {
    const manager = await makeInitializedSessionManager();
    await manager.abort();
    expect(mockHarnessAbort).toHaveBeenCalled();
    manager.dispose();
  });

  it('setModel delegates to agentSession', async () => {
    const manager = await makeInitializedSessionManager();
    await manager.setModel('gpt-4o');
    expect(mockHarnessSetModel).toHaveBeenCalled();
    manager.dispose();
  });

  it('setThinkingLevel delegates to agentSession', async () => {
    const manager = await makeInitializedSessionManager();
    await manager.setThinkingLevel('medium');
    expect(mockHarnessSetThinkingLevel).toHaveBeenCalledWith('medium');
    manager.dispose();
  });

  it('compact delegates to agentSession', async () => {
    const manager = await makeInitializedSessionManager();
    await manager.compact();
    expect(mockHarnessCompact).toHaveBeenCalled();
    manager.dispose();
  });

  it('fork emits error when no agentSession', async () => {
    const manager = makeSessionManager(); // 未初始化
    const listener = vi.fn();
    manager.subscribe(listener);

    await manager.fork('entry-1', 'at');

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('No active session'),
      }),
    );
    manager.dispose();
  });

  it('fork stops when session_before_fork cancels', async () => {
    const extensionRunner = makeMockExtensionRunner({
      hasHandlers: vi.fn((eventType: string) => eventType === 'session_before_fork'),
      emitSessionBeforeFork: vi.fn(async () => ({ cancel: true })),
    });
    const manager = await makeInitializedSessionManagerWithExtensionRunner(extensionRunner);
    const harnessCount = MockAgentHarness.mock.calls.length;

    await manager.fork('entry-1', 'at');

    expect(extensionRunner.emitSessionBeforeFork).toHaveBeenCalledWith({
      type: 'session_before_fork',
      entryId: 'entry-1',
      position: 'at',
    });
    expect(mockSessionRepoFork).not.toHaveBeenCalled();
    expect(MockAgentHarness).toHaveBeenCalledTimes(harnessCount);
    manager.dispose();
  });

  it('AgentSession events are forwarded to SessionManager listeners', async () => {
    const manager = await makeInitializedSessionManager();
    const listener = vi.fn();
    manager.subscribe(listener);

    // AgentSession 内部发出 state_change → 应被转发
    // 通过 harness subscribe 回调触发
    const harnessCallback = (mockHarnessSubscribe.mock.calls as any[])[
      mockHarnessSubscribe.mock.calls.length - 1
    ]?.[0] as (e: any) => void;
    harnessCallback({ type: 'agent_start' });
    await new Promise((r) => setTimeout(r, 20));

    // agent_start 触发 state_change
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'state_change' }));
    manager.dispose();
  });
});
