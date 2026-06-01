/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================
// AgentSession 测试
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- 预定义 mock 值 ----------

const {
  mockFindDefaultModel,
  mockGetApiKey,
  mockGetShellPath,
  mockGetDefaultThinkingLevel,
  mockGetCompactionSettings,
  mockGetSteeringMode,
  mockGetFollowUpMode,
  mockGetRetrySettings,
  mockHarnessSubscribe,
  mockHarnessPrompt,
  mockHarnessAbort,
  mockHarnessSetModel,
  mockHarnessSetThinkingLevel,
  mockHarnessCompact,
  mockHarnessSteer,
  mockHarnessFollowUp,
  mockHarnessNextTurn,
  mockHarnessSetTools,
  mockHarnessHasPendingMessages,
  mockHarnessGetSignal,
  mockHarnessGetModel,
  mockHarnessGetThinkingLevel,
  mockHarnessNavigateTree,
  mockHarnessOn,
  mockSessionBuildContext,
  mockSessionGetMetadata,
  mockSessionGetBranch,
  mockSessionMoveTo,
  mockSessionGetEntries,
  mockSessionAppendLabel,
  mockSessionAppendCustomEntry,
  mockSessionAppendCustomMessageEntry,
  mockSessionGetLeafId,
  mockWrapRegisteredTools,
  MockAgentHarness,
} = vi.hoisted(() => {
  const mockHarnessSubscribe = vi.fn(() => vi.fn());
  const mockHarnessPrompt = vi.fn();
  const mockHarnessAbort = vi.fn();
  const mockHarnessSetModel = vi.fn();
  const mockHarnessSetThinkingLevel = vi.fn();
  const mockHarnessCompact = vi.fn();
  const mockHarnessSteer = vi.fn();
  const mockHarnessFollowUp = vi.fn();
  const mockHarnessNextTurn = vi.fn();
  const mockHarnessSetTools = vi.fn();
  const mockHarnessHasPendingMessages = vi.fn(() => false);
  const mockHarnessGetSignal = vi.fn<() => AbortSignal | undefined>(() => undefined);
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
  const mockHarnessNavigateTree = vi.fn(async () => ({ cancelled: false }));
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
  const mockSessionMoveTo = vi.fn(async () => undefined);
  const mockSessionGetEntries = vi.fn(async () => [] as any[]);
  const mockSessionAppendLabel = vi.fn(async () => 'label-entry-1');
  const mockSessionAppendCustomEntry = vi.fn(async () => 'custom-entry-1');
  const mockSessionAppendCustomMessageEntry = vi.fn(async () => 'custom-message-entry-1');
  const mockSessionGetLeafId = vi.fn(async () => null as string | null);
  const mockWrapRegisteredTools = vi.fn(() => []);

  const MockAgentHarness = vi.fn(function (this: any) {
    this.subscribe = mockHarnessSubscribe;
    this.prompt = mockHarnessPrompt;
    this.abort = mockHarnessAbort;
    this.setModel = mockHarnessSetModel;
    this.setThinkingLevel = mockHarnessSetThinkingLevel;
    this.compact = mockHarnessCompact;
    this.steer = mockHarnessSteer;
    this.followUp = mockHarnessFollowUp;
    this.nextTurn = mockHarnessNextTurn;
    this.setTools = mockHarnessSetTools;
    this.hasPendingMessages = mockHarnessHasPendingMessages;
    this.getSignal = mockHarnessGetSignal;
    this.getModel = mockHarnessGetModel;
    this.getThinkingLevel = mockHarnessGetThinkingLevel;
    this.getContextUsage = mockHarnessGetContextUsage;
    this.navigateTree = mockHarnessNavigateTree;
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
    mockGetDefaultThinkingLevel: vi.fn(() => 'off'),
    mockGetCompactionSettings: vi.fn(() => ({
      enabled: true,
      reserveTokens: 16384,
      keepRecentTokens: 20000,
    })),
    mockGetSteeringMode: vi.fn(() => 'one-at-a-time'),
    mockGetFollowUpMode: vi.fn(() => 'one-at-a-time'),
    mockGetRetrySettings: vi.fn(() => ({ enabled: true, maxRetries: 3, baseDelayMs: 2000 })),
    mockHarnessSubscribe,
    mockHarnessPrompt,
    mockHarnessAbort,
    mockHarnessSetModel,
    mockHarnessSetThinkingLevel,
    mockHarnessCompact,
    mockHarnessSteer,
    mockHarnessFollowUp,
    mockHarnessNextTurn,
    mockHarnessSetTools,
    mockHarnessHasPendingMessages,
    mockHarnessGetSignal,
    mockHarnessGetModel,
    mockHarnessGetThinkingLevel,
    mockHarnessNavigateTree,
    mockHarnessOn,
    mockSessionBuildContext,
    mockSessionGetMetadata,
    mockSessionGetBranch,
    mockSessionMoveTo,
    mockSessionGetEntries,
    mockSessionAppendLabel,
    mockSessionAppendCustomEntry,
    mockSessionAppendCustomMessageEntry,
    mockSessionGetLeafId,
    mockWrapRegisteredTools,
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
    this.getDefaultThinkingLevel = mockGetDefaultThinkingLevel;
    this.getCompactionSettings = mockGetCompactionSettings;
    this.getSteeringMode = mockGetSteeringMode;
    this.getFollowUpMode = mockGetFollowUpMode;
    this.getRetrySettings = mockGetRetrySettings;
    this.getScoutConfig = vi.fn(() => ({ models: [], defaultModelId: 'test-model' }));
    this.onDidChangeSettings = vi.fn(() => ({ dispose: vi.fn() }));
  }),
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
  wrapRegisteredTools: mockWrapRegisteredTools,
  discoverAndLoadExtensions: vi.fn(async () => ({ extensions: [], errors: [], runtime: {} })),
}));

// ---------- 测试辅助 ----------

import { AgentSession } from '../agent-session.ts';
import { ConfigManager } from '../config-manager.ts';

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

function makeSession(
  overrides?: Partial<{
    buildContext: any;
    getMetadata: any;
    getBranch: any;
    moveTo: any;
    getEntries: any;
    appendLabel: any;
    appendCustomEntry: any;
    appendCustomMessageEntry: any;
    getLeafId: any;
  }>,
) {
  return {
    buildContext: overrides?.buildContext ?? mockSessionBuildContext,
    getMetadata: overrides?.getMetadata ?? mockSessionGetMetadata,
    getBranch: overrides?.getBranch ?? mockSessionGetBranch,
    moveTo: overrides?.moveTo ?? mockSessionMoveTo,
    getEntries: overrides?.getEntries ?? mockSessionGetEntries,
    appendLabel: overrides?.appendLabel ?? mockSessionAppendLabel,
    appendCustomEntry: overrides?.appendCustomEntry ?? mockSessionAppendCustomEntry,
    appendCustomMessageEntry:
      overrides?.appendCustomMessageEntry ?? mockSessionAppendCustomMessageEntry,
    getLeafId: overrides?.getLeafId ?? mockSessionGetLeafId,
  } as any;
}

function makeAgentSession(overrides?: { session?: any; extensionRunner?: any }): AgentSession {
  const configManager = new ConfigManager({
    cwd: '/test/project',
    agentDir: '/test/project/.scout',
  } as any);
  return new AgentSession({
    session: overrides?.session ?? makeSession(),
    configManager,
    cwd: '/test/project',
    outputChannel: makeOutputChannel(),
    skills: [],
    extensionRunner: overrides?.extensionRunner,
  });
}

async function makeInitializedAgentSession(overrides?: {
  session?: any;
  extensionRunner?: any;
}): Promise<AgentSession> {
  const agentSession = makeAgentSession(overrides);
  await agentSession.initialize();
  return agentSession;
}

/** 获取传递给 harness.subscribe() 的事件回调 */
function getSubscribeCallback(): (event: any) => void {
  const lastCallIdx = mockHarnessSubscribe.mock.calls.length - 1;
  const calls = mockHarnessSubscribe.mock.calls as Array<Array<unknown>>;
  return calls[lastCallIdx]![0] as (event: any) => void;
}

/** 等待微任务队列排空 */
function flushMicrotasks(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- 基础功能测试 ----------

describe('AgentSession', () => {
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
    mockGetRetrySettings.mockReturnValue({ enabled: true, maxRetries: 3, baseDelayMs: 2000 });
    mockSessionGetBranch.mockResolvedValue([]);
    mockSessionMoveTo.mockResolvedValue(undefined);
    mockSessionGetEntries.mockResolvedValue([]);
    mockSessionAppendLabel.mockResolvedValue('label-entry-1');
    mockSessionAppendCustomMessageEntry.mockResolvedValue('custom-message-entry-1');
    mockSessionGetLeafId.mockResolvedValue(null);
  });

  it('initializes and builds harness', async () => {
    const agentSession = await makeInitializedAgentSession();
    expect(agentSession.model).toBeDefined();
    expect(agentSession.model?.id).toBe('test-model');
    agentSession.dispose();
  });

  it('emits error event when no model available', async () => {
    mockFindDefaultModel.mockReturnValue(undefined as any);

    const agentSession = makeAgentSession();
    const listener = vi.fn();
    agentSession.subscribe(listener);
    await agentSession.initialize();

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('No model available'),
      }),
    );
    agentSession.dispose();
  });

  it('isStreaming is false before initialize', () => {
    const agentSession = makeAgentSession();
    expect(agentSession.isStreaming).toBe(false);
    agentSession.dispose();
  });

  it('isStreaming is false after initialize (idle)', async () => {
    const agentSession = await makeInitializedAgentSession();
    expect(agentSession.isStreaming).toBe(false);
    agentSession.dispose();
  });

  it('returns sessionId from metadata', async () => {
    mockSessionGetMetadata.mockResolvedValue({
      id: 'session-xyz',
      createdAt: new Date().toISOString(),
    });
    const agentSession = await makeInitializedAgentSession();
    expect(agentSession.sessionId).toBe('session-xyz');
    agentSession.dispose();
  });

  it('returns thinkingLevel from harness', async () => {
    mockHarnessGetThinkingLevel.mockReturnValue('medium');
    const agentSession = await makeInitializedAgentSession();
    expect(agentSession.thinkingLevel).toBe('medium');
    agentSession.dispose();
  });

  it('returns parentSessionPath from metadata', async () => {
    mockSessionGetMetadata.mockResolvedValue({
      id: 'session-child',
      parentSessionPath: '/sessions/parent.jsonl',
      createdAt: new Date().toISOString(),
    } as any);
    const agentSession = await makeInitializedAgentSession();
    expect(agentSession.parentSessionPath).toBe('/sessions/parent.jsonl');
    agentSession.dispose();
  });

  it('leafId returns cached value after initialize', async () => {
    mockSessionGetLeafId.mockResolvedValue('leaf-entry-1');
    const agentSession = await makeInitializedAgentSession();
    expect(agentSession.leafId).toBe('leaf-entry-1');
    agentSession.dispose();
  });

  it('subscribe returns unsubscribe function', async () => {
    const agentSession = await makeInitializedAgentSession();
    const listener = vi.fn();
    const unsubscribe = agentSession.subscribe(listener);

    // 通过触发 harness 事件产生 state_change
    const callback = getSubscribeCallback();
    callback({ type: 'agent_start' });
    await flushMicrotasks();
    const callCount = listener.mock.calls.length;
    expect(callCount).toBeGreaterThanOrEqual(1);

    unsubscribe();
    callback({ type: 'agent_start' });
    await flushMicrotasks();
    // unsubscribe 后不应有新的调用
    expect(listener.mock.calls.length).toBe(callCount);

    agentSession.dispose();
  });

  it('dispose cleans up without error', async () => {
    const agentSession = await makeInitializedAgentSession();
    agentSession.dispose();
    agentSession.dispose(); // 幂等
  });

  it('getScoutMessages returns cached messages', async () => {
    const agentSession = await makeInitializedAgentSession();
    expect(agentSession.getScoutMessages()).toEqual([]);
    agentSession.dispose();
  });

  it('getApiKeyAndHeaders returns correct headers for anthropic', async () => {
    const agentSession = await makeInitializedAgentSession();

    const callArgs = (MockAgentHarness.mock.calls as any[])[
      MockAgentHarness.mock.calls.length - 1
    ]?.[0] as any;
    const authFn = callArgs?.getApiKeyAndHeaders;
    expect(authFn).toBeDefined();

    const result = await authFn({ provider: 'anthropic' });
    expect(result?.apiKey).toBe('test-api-key');
    expect(result?.headers).toHaveProperty('anthropic-version');
    agentSession.dispose();
  });

  it('getApiKeyAndHeaders returns undefined when no apiKey', async () => {
    mockGetApiKey.mockReturnValue(undefined as any);
    const agentSession = await makeInitializedAgentSession();

    const callArgs = (MockAgentHarness.mock.calls as any[])[
      MockAgentHarness.mock.calls.length - 1
    ]?.[0] as any;
    const result = await callArgs?.getApiKeyAndHeaders({ provider: 'unknown' });
    expect(result).toBeUndefined();
    agentSession.dispose();
  });

  it('getApiKeyAndHeaders returns no extra headers for openai', async () => {
    const agentSession = await makeInitializedAgentSession();

    const callArgs = (MockAgentHarness.mock.calls as any[])[
      MockAgentHarness.mock.calls.length - 1
    ]?.[0] as any;
    const result = await callArgs?.getApiKeyAndHeaders({ provider: 'openai' });
    expect(result?.apiKey).toBe('test-api-key');
    expect(result?.headers).toBeUndefined();
    agentSession.dispose();
  });
});

// ---------- 运行时操作 ----------

describe('AgentSession — 运行时操作', () => {
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
    mockGetRetrySettings.mockReturnValue({ enabled: true, maxRetries: 3, baseDelayMs: 2000 });
    mockSessionGetBranch.mockResolvedValue([]);
    mockSessionMoveTo.mockResolvedValue(undefined);
    mockSessionGetEntries.mockResolvedValue([]);
    mockSessionGetLeafId.mockResolvedValue(null);
  });

  it('prompt delegates to harness', async () => {
    const agentSession = await makeInitializedAgentSession();
    await agentSession.prompt('Hello');
    expect(mockHarnessPrompt).toHaveBeenCalledWith('Hello');
    agentSession.dispose();
  });

  it('prompt emits state_change', async () => {
    const agentSession = await makeInitializedAgentSession();
    const listener = vi.fn();
    agentSession.subscribe(listener);

    await agentSession.prompt('Hello');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'state_change' }));
    agentSession.dispose();
  });

  it('abort delegates to harness', async () => {
    const agentSession = await makeInitializedAgentSession();
    await agentSession.abort();
    expect(mockHarnessAbort).toHaveBeenCalled();
    agentSession.dispose();
  });

  it('setModel delegates to harness', async () => {
    const agentSession = await makeInitializedAgentSession();
    await agentSession.setModel('gpt-4o');
    expect(mockHarnessSetModel).toHaveBeenCalled();
    agentSession.dispose();
  });

  it('setThinkingLevel delegates to harness', async () => {
    const agentSession = await makeInitializedAgentSession();
    await agentSession.setThinkingLevel('medium');
    expect(mockHarnessSetThinkingLevel).toHaveBeenCalledWith('medium');
    agentSession.dispose();
  });

  it('compact delegates to harness', async () => {
    const agentSession = await makeInitializedAgentSession();
    await agentSession.compact();
    expect(mockHarnessCompact).toHaveBeenCalled();
    agentSession.dispose();
  });

  it('exposes active tool names from the harness tool registry', async () => {
    const agentSession = await makeInitializedAgentSession();

    expect(agentSession.getActiveToolNames()).toEqual(['read', 'bash', 'edit', 'write']);
    expect(agentSession.getAllToolInfos()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'read',
          sourceInfo: expect.objectContaining({ path: '<builtin:read>', source: 'builtin' }),
        }),
        expect.objectContaining({
          name: 'grep',
          sourceInfo: expect.objectContaining({ path: '<builtin:grep>', source: 'builtin' }),
        }),
      ]),
    );
    agentSession.dispose();
  });

  it('setActiveTools updates the harness active tool set', async () => {
    const agentSession = await makeInitializedAgentSession();

    await agentSession.setActiveTools(['read', 'grep']);

    expect(agentSession.getActiveToolNames()).toEqual(['read', 'grep']);
    expect(mockHarnessSetTools).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: 'read' }),
        expect.objectContaining({ name: 'grep' }),
      ]),
      ['read', 'grep'],
    );
    expect(agentSession.getAllToolInfos()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'read' }),
        expect.objectContaining({ name: 'bash' }),
        expect.objectContaining({ name: 'grep' }),
      ]),
    );
    agentSession.dispose();
  });

  it('persists active tools to the current session branch', async () => {
    const agentSession = await makeInitializedAgentSession();

    await agentSession.setActiveTools(['read', 'grep']);

    expect(mockSessionAppendCustomEntry).toHaveBeenCalledWith('tools-config', {
      enabledTools: ['read', 'grep'],
    });
    agentSession.dispose();
  });

  it('restores active tools from the latest tools-config branch entry', async () => {
    const session = makeSession({
      getBranch: vi.fn(async () => [
        {
          type: 'custom',
          customType: 'tools-config',
          data: { enabledTools: ['read', 'grep'] },
        },
      ]),
    });

    const agentSession = await makeInitializedAgentSession({ session });

    expect(agentSession.getActiveToolNames()).toEqual(['read', 'grep']);
    const harnessOptions = (MockAgentHarness.mock.calls as any[]).at(-1)?.[0] as any;
    expect(harnessOptions.activeToolNames).toEqual(['read', 'grep']);
    agentSession.dispose();
  });

  it('extension tools override builtin tools and keep extension sourceInfo', async () => {
    const extensionRunner = {
      getAllRegisteredTools: vi.fn(() => [
        {
          definition: {
            name: 'read',
            label: 'extension read',
            description: 'extension read tool',
            parameters: { type: 'object' },
            execute: vi.fn(),
          },
          sourceInfo: {
            path: '/extensions/read-override.ts',
            source: 'local',
            scope: 'project',
            origin: 'top-level',
            baseDir: '/extensions',
          },
        },
      ]),
      invalidate: vi.fn(),
    };
    (mockWrapRegisteredTools as any).mockReturnValueOnce([
      {
        name: 'read',
        label: 'extension read',
        description: 'extension read tool',
        parameters: { type: 'object' },
        execute: vi.fn(),
      },
    ]);

    const agentSession = await makeInitializedAgentSession({ extensionRunner });

    expect(agentSession.getAllToolInfos()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'read',
          description: 'extension read tool',
          sourceInfo: expect.objectContaining({
            path: '/extensions/read-override.ts',
            source: 'local',
            scope: 'project',
            baseDir: '/extensions',
          }),
        }),
      ]),
    );
    const harnessOptions = (MockAgentHarness.mock.calls as any[]).at(-1)?.[0] as any;
    expect(harnessOptions.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'read', label: 'extension read' })]),
    );
    agentSession.dispose();
  });

  it('bridges extension hooks to AgentHarness', async () => {
    const extensionRunner = {
      getAllRegisteredTools: vi.fn(() => []),
      emitBeforeAgentStart: vi.fn(),
      emitContext: vi.fn(async (messages) => messages),
      emitBeforeProviderRequest: vi.fn(),
      emitBeforeProviderPayload: vi.fn(async (event) => event.payload),
      emitToolCall: vi.fn(),
      emitToolResult: vi.fn(),
      emitSessionBeforeCompact: vi.fn(),
      emitSessionBeforeTree: vi.fn(),
      invalidate: vi.fn(),
    };

    const agentSession = await makeInitializedAgentSession({ extensionRunner });

    expect(mockHarnessOn).toHaveBeenCalledWith('before_agent_start', expect.any(Function));
    expect(mockHarnessOn).toHaveBeenCalledWith('context', expect.any(Function));
    expect(mockHarnessOn).toHaveBeenCalledWith('before_provider_request', expect.any(Function));
    expect(mockHarnessOn).toHaveBeenCalledWith('before_provider_payload', expect.any(Function));
    expect(mockHarnessOn).toHaveBeenCalledWith('tool_call', expect.any(Function));
    expect(mockHarnessOn).toHaveBeenCalledWith('tool_result', expect.any(Function));
    expect(mockHarnessOn).toHaveBeenCalledWith('session_before_compact', expect.any(Function));
    expect(mockHarnessOn).toHaveBeenCalledWith('session_before_tree', expect.any(Function));
    agentSession.dispose();
  });

  it('sendUserMessage prompts when idle and requires deliverAs while streaming', async () => {
    const agentSession = await makeInitializedAgentSession();

    await agentSession.sendUserMessage('idle message');
    expect(mockHarnessPrompt).toHaveBeenCalledWith('idle message');

    mockHarnessPrompt.mockImplementationOnce(() => new Promise(() => {}));
    void agentSession.prompt('streaming message');

    await expect(agentSession.sendUserMessage('queued message')).rejects.toThrow(
      'deliverAs: "steer" or "followUp"',
    );
    agentSession.dispose();
  });

  it('sendUserMessage ignores deliverAs while idle and prompts normally', async () => {
    const agentSession = await makeInitializedAgentSession();

    await agentSession.sendUserMessage('steer message', { deliverAs: 'steer' });
    getSubscribeCallback()({ type: 'settled' });
    await flushMicrotasks();
    await agentSession.sendUserMessage('follow message', { deliverAs: 'followUp' });

    expect(mockHarnessPrompt).toHaveBeenCalledWith('steer message');
    expect(mockHarnessPrompt).toHaveBeenCalledWith('follow message');
    expect(mockHarnessSteer).not.toHaveBeenCalled();
    expect(mockHarnessFollowUp).not.toHaveBeenCalled();
    agentSession.dispose();
  });

  it('sendUserMessage supports Pi deliverAs steering behaviors while streaming', async () => {
    const agentSession = await makeInitializedAgentSession();
    mockHarnessPrompt.mockImplementationOnce(() => new Promise(() => {}));
    void agentSession.prompt('streaming message');

    await agentSession.sendUserMessage('steer message', { deliverAs: 'steer' });
    await agentSession.sendUserMessage('follow message', { deliverAs: 'followUp' });

    expect(mockHarnessSteer).toHaveBeenCalledWith('steer message');
    expect(mockHarnessFollowUp).toHaveBeenCalledWith('follow message');
    expect(mockHarnessNextTurn).not.toHaveBeenCalled();
    agentSession.dispose();
  });

  it('sendMessage appends a real custom message entry to the session', async () => {
    const listener = vi.fn();
    const agentSession = await makeInitializedAgentSession();
    agentSession.subscribe(listener);

    await agentSession.sendMessage('extension note');

    expect(mockSessionAppendCustomMessageEntry).toHaveBeenCalledWith(
      'extension_message',
      'extension note',
      true,
      undefined,
    );

    await agentSession.sendMessage({
      customType: 'custom-test',
      content: 'custom content',
      display: false,
      details: { source: 'test' },
    });

    expect(mockSessionAppendCustomMessageEntry).toHaveBeenCalledWith(
      'custom-test',
      'custom content',
      false,
      { source: 'test' },
    );
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'state_change' }));
    agentSession.dispose();
  });

  it('ReplacedSessionContext sendMessage and sendUserMessage target the replacement session', async () => {
    const extensionRunner = {
      createContext: vi.fn(() => ({
        cwd: '/test/project',
      })),
      getAllRegisteredTools: vi.fn(() => []),
      emitBeforeAgentStart: vi.fn(),
      emitContext: vi.fn(async (messages) => messages),
      emitBeforeProviderRequest: vi.fn(),
      emitBeforeProviderPayload: vi.fn(async (event) => event.payload),
      emitToolCall: vi.fn(),
      emitToolResult: vi.fn(),
      emitSessionBeforeCompact: vi.fn(),
      emitSessionBeforeTree: vi.fn(),
      invalidate: vi.fn(),
    };
    const agentSession = await makeInitializedAgentSession({ extensionRunner });
    const replacementCtx = agentSession.createReplacedSessionContext();

    await replacementCtx.sendMessage('replacement message');
    await replacementCtx.sendUserMessage('replacement prompt');

    expect(mockSessionAppendCustomMessageEntry).toHaveBeenCalledWith(
      'extension_message',
      'replacement message',
      true,
      undefined,
    );
    expect(mockHarnessPrompt).toHaveBeenCalledWith('replacement prompt');
    agentSession.dispose();
  });

  it('exposes system prompt and pending runtime signal state', async () => {
    const signal = new AbortController().signal;
    mockHarnessHasPendingMessages.mockReturnValue(true);
    mockHarnessGetSignal.mockReturnValue(signal);
    const agentSession = await makeInitializedAgentSession();

    expect(agentSession.getSystemPrompt()).toBe('System prompt');
    expect(agentSession.hasPendingMessages()).toBe(true);
    expect(agentSession.getAbortSignal()).toBe(signal);
    agentSession.dispose();
  });
});

// ---------- Auto Retry 测试 ----------

describe('AgentSession — Auto Retry', () => {
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
    mockGetRetrySettings.mockReturnValue({ enabled: true, maxRetries: 3, baseDelayMs: 10 });
    mockSessionGetBranch.mockResolvedValue([]);
    mockSessionMoveTo.mockResolvedValue(undefined);
    mockSessionGetEntries.mockResolvedValue([]);
    mockSessionGetLeafId.mockResolvedValue(null);
  });

  function makeErrorAssistantMessage(errorMessage: string): any {
    return {
      role: 'assistant',
      stopReason: 'error',
      errorMessage,
      content: [],
      timestamp: Date.now(),
    };
  }

  it('detects retryable errors (429, 500, overloaded, rate limit)', async () => {
    const agentSession = await makeInitializedAgentSession();
    const events: any[] = [];
    agentSession.subscribe((event) => events.push(event));

    const callback = getSubscribeCallback();
    await agentSession.prompt('test');

    // retry/compaction 决策在 agent_end 后执行（handlePostAgentEnd）
    callback({
      type: 'message_end',
      message: makeErrorAssistantMessage('Error 429: Rate limit exceeded'),
    });
    callback({ type: 'agent_end' });
    await flushMicrotasks();

    expect(events.some((e) => e.type === 'retry_start' && e.attempt === 1)).toBe(true);
    agentSession.dispose();
  });

  it('does not retry non-retryable errors (billing, quota)', async () => {
    const agentSession = await makeInitializedAgentSession();
    const events: any[] = [];
    agentSession.subscribe((event) => events.push(event));

    const callback = getSubscribeCallback();
    callback({
      type: 'message_end',
      message: makeErrorAssistantMessage(
        'insufficient_quota: You have exceeded your billing limit',
      ),
    });
    callback({ type: 'agent_end' });
    await flushMicrotasks();

    expect(events.some((e) => e.type === 'retry_start')).toBe(false);
    agentSession.dispose();
  });

  it('does not retry context overflow errors', async () => {
    const agentSession = await makeInitializedAgentSession();
    const events: any[] = [];
    agentSession.subscribe((event) => events.push(event));

    const callback = getSubscribeCallback();
    // 溢出恢复在 message_end 时处理（不需要 agent_end）
    callback({
      type: 'message_end',
      message: makeErrorAssistantMessage('context_length_exceeded: too many tokens'),
    });
    await flushMicrotasks();

    expect(events.some((e) => e.type === 'retry_start')).toBe(false);
    agentSession.dispose();
  });

  it('does not retry when retry is disabled', async () => {
    mockGetRetrySettings.mockReturnValue({ enabled: false, maxRetries: 3, baseDelayMs: 10 });

    const agentSession = await makeInitializedAgentSession();
    const events: any[] = [];
    agentSession.subscribe((event) => events.push(event));

    const callback = getSubscribeCallback();
    callback({
      type: 'message_end',
      message: makeErrorAssistantMessage('Error 500: Internal server error'),
    });
    callback({ type: 'agent_end' });
    await flushMicrotasks();

    expect(events.some((e) => e.type === 'retry_start')).toBe(false);
    agentSession.dispose();
  });

  it('emits retry_end with success=true when retry succeeds', async () => {
    const agentSession = await makeInitializedAgentSession();
    const events: any[] = [];
    agentSession.subscribe((event) => events.push(event));

    const callback = getSubscribeCallback();
    await agentSession.prompt('test');

    // 第一轮：error → agent_end 触发 retry
    callback({
      type: 'message_end',
      message: makeErrorAssistantMessage('Error 503: Service unavailable'),
    });
    callback({ type: 'agent_end' });
    await flushMicrotasks(50);

    // 第二轮：成功 → agent_end 触发 retry_end(success=true)
    const successMessage = {
      role: 'assistant',
      stopReason: 'end_turn',
      content: [{ type: 'text', text: 'Hello' }],
      timestamp: Date.now(),
    };
    callback({ type: 'message_end', message: successMessage });
    callback({ type: 'agent_end' });
    await flushMicrotasks();

    expect(events.some((e) => e.type === 'retry_end' && e.success === true)).toBe(true);
    agentSession.dispose();
  });

  it('re-prompts with last user message on retry', async () => {
    const agentSession = await makeInitializedAgentSession();

    const callback = getSubscribeCallback();
    await agentSession.prompt('my original question');
    mockHarnessPrompt.mockClear();

    // retry 决策在 agent_end 后执行
    callback({ type: 'message_end', message: makeErrorAssistantMessage('Error 502: Bad Gateway') });
    callback({ type: 'agent_end' });
    await flushMicrotasks(50);

    expect(mockHarnessPrompt).toHaveBeenCalledWith('my original question');
    agentSession.dispose();
  });

  it('aborts retry when abortRetry is called', async () => {
    mockGetRetrySettings.mockReturnValue({ enabled: true, maxRetries: 3, baseDelayMs: 5000 });

    const agentSession = await makeInitializedAgentSession();
    const events: any[] = [];
    agentSession.subscribe((event) => events.push(event));

    const callback = getSubscribeCallback();
    await agentSession.prompt('test');

    // retry 决策在 agent_end 后触发
    callback({
      type: 'message_end',
      message: makeErrorAssistantMessage('Error 500: Internal error'),
    });
    callback({ type: 'agent_end' });
    await flushMicrotasks(50);

    await agentSession.abortRetry();
    await flushMicrotasks(50);

    expect(
      events.some(
        (e) => e.type === 'retry_end' && e.success === false && e.finalError === 'Retry cancelled',
      ),
    ).toBe(true);
    agentSession.dispose();
  });

  it('resets retry state on new prompt', async () => {
    const agentSession = await makeInitializedAgentSession();

    await agentSession.prompt('first message');
    mockHarnessPrompt.mockClear();

    await agentSession.prompt('second message');
    expect(mockHarnessPrompt).toHaveBeenCalledWith('second message');
    agentSession.dispose();
  });

  it('emits retry_end with success=false after max retries exceeded', async () => {
    mockGetRetrySettings.mockReturnValue({ enabled: true, maxRetries: 2, baseDelayMs: 10 });

    const agentSession = await makeInitializedAgentSession();
    const events: any[] = [];
    agentSession.subscribe((event) => events.push(event));

    const callback = getSubscribeCallback();
    await agentSession.prompt('test');

    // 每轮 message_end + agent_end 一起触发
    callback({
      type: 'message_end',
      message: makeErrorAssistantMessage('Error 500: Server error'),
    });
    callback({ type: 'agent_end' });
    await flushMicrotasks(50);

    callback({
      type: 'message_end',
      message: makeErrorAssistantMessage('Error 500: Server error'),
    });
    callback({ type: 'agent_end' });
    await flushMicrotasks(100);

    callback({
      type: 'message_end',
      message: makeErrorAssistantMessage('Error 500: Server error'),
    });
    callback({ type: 'agent_end' });
    await flushMicrotasks();

    const retryEndEvents = events.filter((e) => e.type === 'retry_end');
    expect(retryEndEvents.length).toBeGreaterThan(0);
    const lastRetryEnd = retryEndEvents[retryEndEvents.length - 1]!;
    expect(lastRetryEnd.success).toBe(false);
    expect(lastRetryEnd.attempt).toBe(2);
    agentSession.dispose();
  });
});

// ---------- Fork 测试 ----------

describe('AgentSession — Fork', () => {
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

  it('does not own fork replacement', async () => {
    const agentSession = await makeInitializedAgentSession();
    expect('fork' in agentSession).toBe(false);
    agentSession.dispose();
  });
});

// ---------- Session Tree / Navigation / Label 测试 ----------

describe('AgentSession — Tree / Navigation / Label', () => {
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
    mockSessionMoveTo.mockResolvedValue(undefined);
    mockSessionGetEntries.mockResolvedValue([]);
    mockSessionAppendLabel.mockResolvedValue('label-entry-1');
    mockSessionGetLeafId.mockResolvedValue(null);
  });

  it('getTree returns empty when no entries', async () => {
    const agentSession = await makeInitializedAgentSession();
    const tree = await agentSession.getTree();
    expect(tree).toEqual([]);
    agentSession.dispose();
  });

  it('getTree builds tree from entries', async () => {
    const now = new Date().toISOString();
    const userMsg = { role: 'user', content: 'hello', timestamp: Date.now() };
    const assistantMsg = {
      role: 'assistant',
      content: [{ type: 'text', text: 'hi' }],
      timestamp: Date.now(),
    };

    mockSessionGetEntries.mockResolvedValue([
      { type: 'message', id: 'entry-1', parentId: null, timestamp: now, message: userMsg },
      {
        type: 'message',
        id: 'entry-2',
        parentId: 'entry-1',
        timestamp: now,
        message: assistantMsg,
      },
    ]);

    const agentSession = await makeInitializedAgentSession();
    const tree = await agentSession.getTree();

    expect(tree.length).toBe(1);
    expect(tree[0]!.id).toBe('entry-1');
    expect(tree[0]!.children.length).toBe(1);
    expect(tree[0]!.children[0]!.id).toBe('entry-2');
    agentSession.dispose();
  });

  it('getTree resolves labels from LabelEntry', async () => {
    const now = new Date().toISOString();
    const userMsg = { role: 'user', content: 'hello', timestamp: Date.now() };

    mockSessionGetEntries.mockResolvedValue([
      { type: 'message', id: 'entry-1', parentId: null, timestamp: now, message: userMsg },
      {
        type: 'label',
        id: 'label-1',
        parentId: 'entry-1',
        timestamp: now,
        targetId: 'entry-1',
        label: 'important',
      },
    ]);

    const agentSession = await makeInitializedAgentSession();
    const tree = await agentSession.getTree();

    expect(tree[0]!.label).toBe('important');
    agentSession.dispose();
  });

  it('getTree last label wins and undefined clears label', async () => {
    const now = new Date().toISOString();
    const userMsg = { role: 'user', content: 'hello', timestamp: Date.now() };

    mockSessionGetEntries.mockResolvedValue([
      { type: 'message', id: 'entry-1', parentId: null, timestamp: now, message: userMsg },
      {
        type: 'label',
        id: 'label-1',
        parentId: 'entry-1',
        timestamp: now,
        targetId: 'entry-1',
        label: 'first',
      },
      {
        type: 'label',
        id: 'label-2',
        parentId: 'entry-1',
        timestamp: now,
        targetId: 'entry-1',
        label: 'second',
      },
      {
        type: 'label',
        id: 'label-3',
        parentId: 'entry-1',
        timestamp: now,
        targetId: 'entry-1',
        label: undefined,
      },
    ]);

    const agentSession = await makeInitializedAgentSession();
    const tree = await agentSession.getTree();

    expect(tree[0]!.label).toBeUndefined();
    agentSession.dispose();
  });

  it('getTree sorts children by timestamp', async () => {
    const now = new Date().toISOString();
    const earlier = new Date(Date.now() - 1000).toISOString();
    const later = new Date(Date.now() + 1000).toISOString();
    const userMsg = { role: 'user', content: 'hello', timestamp: Date.now() };

    mockSessionGetEntries.mockResolvedValue([
      { type: 'message', id: 'entry-1', parentId: null, timestamp: now, message: userMsg },
      { type: 'message', id: 'entry-2b', parentId: 'entry-1', timestamp: later, message: userMsg },
      {
        type: 'message',
        id: 'entry-2a',
        parentId: 'entry-1',
        timestamp: earlier,
        message: userMsg,
      },
    ]);

    const agentSession = await makeInitializedAgentSession();
    const tree = await agentSession.getTree();

    expect(tree[0]!.children[0]!.id).toBe('entry-2a');
    expect(tree[0]!.children[1]!.id).toBe('entry-2b');
    agentSession.dispose();
  });

  it('navigateTree delegates to harness', async () => {
    mockHarnessNavigateTree.mockResolvedValue({ cancelled: false, editorText: 'test' } as any);

    const agentSession = await makeInitializedAgentSession();
    const result = await agentSession.navigateTree('entry-target', { summarize: true });

    expect(mockHarnessNavigateTree).toHaveBeenCalledWith('entry-target', { summarize: true });
    expect(result.cancelled).toBe(false);
    agentSession.dispose();
  });

  it('navigateTree emits state_change and tree_change on success', async () => {
    mockHarnessNavigateTree.mockResolvedValue({ cancelled: false });

    const agentSession = await makeInitializedAgentSession();
    const listener = vi.fn();
    agentSession.subscribe(listener);

    await agentSession.navigateTree('entry-target', { summarize: true });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'state_change' }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'tree_change' }));
    agentSession.dispose();
  });

  it('navigateTree returns cancelled when no harness', () => {
    const agentSession = makeAgentSession(); // 未初始化
    const listener = vi.fn();
    agentSession.subscribe(listener);

    return agentSession.navigateTree('entry-target').then((result) => {
      expect(result.cancelled).toBe(true);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
      agentSession.dispose();
    });
  });

  it('setLabel delegates to session.appendLabel', async () => {
    const agentSession = await makeInitializedAgentSession();
    await agentSession.setLabel('entry-1', 'important');
    expect(mockSessionAppendLabel).toHaveBeenCalledWith('entry-1', 'important');
    agentSession.dispose();
  });

  it('setLabel emits tree_change', async () => {
    const agentSession = await makeInitializedAgentSession();
    const listener = vi.fn();
    agentSession.subscribe(listener);

    await agentSession.setLabel('entry-1', 'important');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'tree_change' }));
    agentSession.dispose();
  });

  it('session_tree harness event triggers rebuild and events', async () => {
    const agentSession = await makeInitializedAgentSession();
    const listener = vi.fn();
    agentSession.subscribe(listener);

    const callback = getSubscribeCallback();
    callback({ type: 'session_tree', newLeafId: 'new-leaf', oldLeafId: 'old-leaf' });
    await flushMicrotasks();

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'state_change' }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'tree_change' }));
    agentSession.dispose();
  });
});

// ---------- 消息缓存测试 ----------

describe('AgentSession — 消息缓存', () => {
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
    mockGetRetrySettings.mockReturnValue({ enabled: true, maxRetries: 3, baseDelayMs: 10 });
    mockSessionGetBranch.mockResolvedValue([]);
    mockSessionMoveTo.mockResolvedValue(undefined);
    mockSessionGetEntries.mockResolvedValue([]);
    mockSessionGetLeafId.mockResolvedValue(null);
  });

  it('entryId is attached to cached messages', async () => {
    const userMsg = { role: 'user' as const, content: 'hello', timestamp: Date.now() };
    const assistantMsg = {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'hi' }],
      timestamp: Date.now(),
    };

    (mockSessionGetBranch as any).mockResolvedValue([
      {
        type: 'message',
        id: 'entry-user-1',
        parentId: null,
        timestamp: new Date().toISOString(),
        message: userMsg,
      },
      {
        type: 'message',
        id: 'entry-assistant-1',
        parentId: 'entry-user-1',
        timestamp: new Date().toISOString(),
        message: assistantMsg,
      },
    ]);
    (mockSessionBuildContext as any).mockResolvedValue({
      messages: [userMsg, assistantMsg],
      thinkingLevel: 'off',
      model: null,
    });

    const { convertMessage } = await import('../protocol/agent-event-mapper.ts');
    (convertMessage as any).mockImplementation((msg: any) => {
      if (msg.role === 'user')
        return { role: 'user', content: msg.content, timestamp: msg.timestamp };
      if (msg.role === 'assistant')
        return { role: 'assistant', content: msg.content, timestamp: msg.timestamp };
      return null;
    });

    const agentSession = await makeInitializedAgentSession();
    const messages = agentSession.getScoutMessages();

    expect(messages.length).toBe(2);
    expect(messages[0]!.entryId).toBe('entry-user-1');
    expect(messages[1]!.entryId).toBe('entry-assistant-1');
    agentSession.dispose();
  });
});
