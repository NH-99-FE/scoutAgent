/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================
// SessionManager 测试（协调层职责）
// 覆盖：initialize / restore / newSession / listSessions / delegate
// 详细的 retry/compaction/fork/tree 测试已迁移到 agent-session.test.ts
// ============================================================

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------- 预定义 mock 值 ----------

const {
  mockFindDefaultModel,
  mockFindModel,
  mockFindModelByProvider,
  mockHasConfiguredModelAuth,
  mockConfigReload,
  mockGetApiKey,
  mockGetShellPath,
  mockHarnessSubscribe,
  mockHarnessPrompt,
  mockHarnessAbort,
  mockHarnessSetModel,
  mockHarnessSetThinkingLevel,
  mockHarnessCompact,
  mockHarnessSetTools,
  mockHarnessSetResources,
  mockHarnessGetModel,
  mockHarnessGetThinkingLevel,
  mockHarnessOn,
  mockSessionBuildContext,
  mockSessionGetMetadata,
  mockSessionGetBranch,
  mockSessionGetEntries,
  mockSessionGetLeafId,
  mockSessionRepoDelete,
  mockSessionRepoFork,
  mockLoadSourcedPromptTemplates,
  MockAgentHarness,
} = vi.hoisted(() => {
  const mockHarnessSubscribe = vi.fn(() => vi.fn());
  const mockHarnessPrompt = vi.fn();
  const mockHarnessContinue = vi.fn();
  const mockHarnessAbort = vi.fn();
  const mockHarnessSetModel = vi.fn();
  const mockHarnessSetThinkingLevel = vi.fn();
  const mockHarnessCompact = vi.fn();
  const mockHarnessSetTools = vi.fn();
  const mockHarnessSetResources = vi.fn();
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
  const mockSessionRepoDelete = vi.fn(async () => undefined);
  const mockSessionRepoFork = vi.fn();
  const mockLoadSourcedPromptTemplates = vi.fn(async (..._args: any[]) => ({
    promptTemplates: [] as any[],
    diagnostics: [] as any[],
  }));

  const MockAgentHarness = vi.fn(function (this: any) {
    this.subscribe = mockHarnessSubscribe;
    this.prompt = mockHarnessPrompt;
    this.continue = mockHarnessContinue;
    this.abort = mockHarnessAbort;
    this.setModel = mockHarnessSetModel;
    this.setThinkingLevel = mockHarnessSetThinkingLevel;
    this.compact = mockHarnessCompact;
    this.steer = vi.fn();
    this.followUp = vi.fn();
    this.setTools = mockHarnessSetTools;
    this.setResources = mockHarnessSetResources;
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
    mockConfigReload: vi.fn(),
    mockGetApiKey: vi.fn(() => 'test-api-key'),
    mockFindModel: vi.fn((id: string) => ({
      id,
      api: 'anthropic',
      provider: 'anthropic',
      input: ['text', 'image'],
    })),
    mockFindModelByProvider: vi.fn((provider: string, modelId: string) => ({
      id: modelId,
      api: provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
      provider,
      input: ['text', 'image'],
    })),
    mockHasConfiguredModelAuth: vi.fn(() => true),
    mockGetShellPath: vi.fn(() => undefined),
    mockHarnessSubscribe,
    mockHarnessPrompt,
    mockHarnessAbort,
    mockHarnessSetModel,
    mockHarnessSetThinkingLevel,
    mockHarnessCompact,
    mockHarnessSetTools,
    mockHarnessSetResources,
    mockHarnessGetModel,
    mockHarnessGetThinkingLevel,
    mockHarnessOn,
    mockSessionBuildContext,
    mockSessionGetMetadata,
    mockSessionGetBranch,
    mockSessionGetEntries,
    mockSessionGetLeafId,
    mockSessionRepoDelete,
    mockSessionRepoFork,
    mockLoadSourcedPromptTemplates,
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
    this.delete = mockSessionRepoDelete;
    this.fork = mockSessionRepoFork;
  }),
  shouldCompact: vi.fn(() => false),
  calculateContextTokens: vi.fn(() => 0),
  estimateContextTokens: vi.fn(() => ({ tokens: 0, lastUsageIndex: null })),
  loadSourcedPromptTemplates: mockLoadSourcedPromptTemplates,
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
  isContextOverflow: vi.fn(() => false),
}));

// ---------- Mock @scout-agent/shared ----------

vi.mock('@scout-agent/shared', () => ({}));

// ---------- Mock internal modules ----------

vi.mock('../config-manager.ts', () => ({
  ConfigManager: vi.fn(function (this: any) {
    this.findDefaultModel = mockFindDefaultModel;
    this.findModel = mockFindModel;
    this.findModelByProvider = mockFindModelByProvider;
    this.hasConfiguredModelAuth = mockHasConfiguredModelAuth;
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
    this.getStreamOptions = vi.fn(() => ({
      transport: 'auto',
      timeoutMs: 300000,
      maxRetries: 2,
      maxRetryDelayMs: 60000,
    }));
    this.getScoutConfig = vi.fn(() => ({
      models: [],
      defaultModelProvider: 'anthropic',
      defaultModelId: 'test-model',
      branchSummary: { reserveTokens: 16384, skipPrompt: false },
    }));
    this.onDidChangeSettings = vi.fn(() => ({ dispose: vi.fn() }));
    this.getExtensionPaths = vi.fn(() => []);
    this.reload = mockConfigReload;
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
import { loadSkills } from '../skill-loader.ts';
import { encodeSessionCwd } from '../session-file.ts';

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'scout-session-manager-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

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

function makeSessionManagerAt(cwd: string, agentDir: string): SessionManager {
  const configManager = new ConfigManager({ cwd, agentDir } as any);
  return new SessionManager({
    cwd,
    agentDir,
    outputChannel: makeOutputChannel(),
    configManager,
  });
}

function writeSessionJsonl(root: string, cwd: string): string {
  const sessionPath = join(root, 'source-session.jsonl');
  writeFileSync(
    sessionPath,
    [
      JSON.stringify({
        type: 'session',
        id: 'imported-session',
        timestamp: '2026-06-07T00:00:00.000Z',
        cwd,
      }),
      JSON.stringify({ type: 'user_message', content: 'hello' }),
    ].join('\n'),
    'utf-8',
  );
  return sessionPath;
}

function listImportedSessionFiles(agentDir: string, cwd: string): string[] {
  const sessionDir = join(agentDir, encodeSessionCwd(cwd));
  if (!existsSync(sessionDir)) return [];
  return readdirSync(sessionDir).filter((name) => name.endsWith('.jsonl'));
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
    emitSessionShutdown: vi.fn(),
    emitSessionStart: vi.fn(),
    emitResourcesDiscover: vi.fn(async () => ({ skillPaths: [], promptPaths: [], themePaths: [] })),
    createContext: vi.fn(() => ({})),
    createCommandContext: vi.fn(() => ({})),
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
        sourceInfo: {
          path: '<test-extension>',
          source: 'test',
          scope: 'temporary',
          origin: 'top-level',
        },
        handlers: new Map(),
        tools: new Map(),
        commands: new Map(),
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
    mockFindModel.mockImplementation((id: string) => ({
      id,
      api: 'anthropic',
      provider: 'anthropic',
      input: ['text', 'image'],
    }));
    mockFindModelByProvider.mockImplementation((provider: string, modelId: string) => ({
      id: modelId,
      api: provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
      provider,
      input: ['text', 'image'],
    }));
    mockHasConfiguredModelAuth.mockReturnValue(true);
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
    mockLoadSourcedPromptTemplates.mockResolvedValue({ promptTemplates: [], diagnostics: [] });
  });

  it('initialize emits state_change', async () => {
    const manager = makeSessionManager();
    const listener = vi.fn();
    manager.subscribe(listener);

    await manager.initialize();

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'state_change' }));
    manager.dispose();
  });

  it('initialize loads prompt templates into harness resources', async () => {
    mockLoadSourcedPromptTemplates.mockResolvedValueOnce({
      promptTemplates: [
        {
          promptTemplate: {
            name: 'summarize',
            description: 'Summarize target',
            content: 'Summarize $ARGUMENTS',
          },
          source: {
            path: '/test/project/.scout/prompts',
            source: 'project',
            scope: 'project',
            origin: 'top-level',
          },
        },
      ],
      diagnostics: [],
    });
    const manager = makeSessionManager();

    await manager.initialize();

    const harnessCalls = MockAgentHarness.mock.calls as any[][];
    const lastHarnessCall = harnessCalls[harnessCalls.length - 1]!;
    expect(lastHarnessCall[0]).toEqual(
      expect.objectContaining({
        resources: expect.objectContaining({
          promptTemplates: [
            expect.objectContaining({
              name: 'summarize',
              description: 'Summarize target',
              content: 'Summarize $ARGUMENTS',
            }),
          ],
        }),
      }),
    );
    const promptInputs = mockLoadSourcedPromptTemplates.mock.calls[0]![1];
    const promptInputPaths = promptInputs.map((entry: { path: string }) =>
      entry.path.replace(/\\/g, '/'),
    );
    expect(promptInputPaths).toEqual(expect.arrayContaining(['/test/project/.scout/prompts']));
    manager.dispose();
  });

  it('initialize keeps first prompt template on name collision and records diagnostics', async () => {
    mockLoadSourcedPromptTemplates.mockResolvedValueOnce({
      promptTemplates: [
        {
          promptTemplate: {
            name: 'dup',
            description: 'First prompt',
            content: 'first',
            sourceInfo: {
              path: '/test/project/.scout/prompts/dup.md',
              source: 'project',
              scope: 'project',
              origin: 'top-level',
            },
          },
          source: {
            path: '/test/project/.scout/prompts/dup.md',
            source: 'project',
            scope: 'project',
            origin: 'top-level',
          },
        },
        {
          promptTemplate: {
            name: 'dup',
            description: 'Second prompt',
            content: 'second',
            sourceInfo: {
              path: '/extension/prompts/dup.md',
              source: 'extension',
              scope: 'temporary',
              origin: 'top-level',
            },
          },
          source: {
            path: '/extension/prompts/dup.md',
            source: 'extension',
            scope: 'temporary',
            origin: 'top-level',
          },
        },
      ],
      diagnostics: [],
    });
    const manager = makeSessionManager();

    await manager.initialize();

    const harnessCalls = MockAgentHarness.mock.calls as any[][];
    const lastHarnessCall = harnessCalls[harnessCalls.length - 1]!;
    expect(lastHarnessCall[0]).toEqual(
      expect.objectContaining({
        resources: expect.objectContaining({
          promptTemplates: [
            expect.objectContaining({
              name: 'dup',
              description: 'First prompt',
              content: 'first',
            }),
          ],
        }),
      }),
    );
    expect(lastHarnessCall[0].resources.promptTemplates).toHaveLength(1);
    expect(manager.diagnostics).toContainEqual(
      expect.objectContaining({
        type: 'collision',
        message: 'name "/dup" collision',
        path: '/extension/prompts/dup.md',
        collision: expect.objectContaining({
          resourceType: 'prompt',
          name: 'dup',
          winnerPath: '/test/project/.scout/prompts/dup.md',
          loserPath: '/extension/prompts/dup.md',
        }),
      }),
    );
    manager.dispose();
  });

  it('initialize consumes extension discovered prompt and skill paths', async () => {
    const extensionRunner = makeMockExtensionRunner({
      emitResourcesDiscover: vi.fn(async () => ({
        skillPaths: [{ path: '/extension/skills', extensionPath: '/extension/index.ts' }],
        promptPaths: [{ path: '/extension/prompts', extensionPath: '/extension/index.ts' }],
        themePaths: [],
      })),
    });

    const manager = await makeInitializedSessionManagerWithExtensionRunner(extensionRunner);

    expect(extensionRunner.emitResourcesDiscover).toHaveBeenCalledWith('/test/project', 'startup');
    expect(loadSkills).toHaveBeenCalledWith(
      expect.objectContaining({
        customPaths: ['/extension/skills'],
      }),
    );
    const promptTemplateInputCalls = mockLoadSourcedPromptTemplates.mock.calls.map(
      (call) => call[1],
    );
    expect(promptTemplateInputCalls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([expect.objectContaining({ path: '/extension/prompts' })]),
      ]),
    );
    expect(mockHarnessSetResources).toHaveBeenCalled();
    manager.dispose();
  });

  it('initialize emits resources_discover after binding extension context actions', async () => {
    const order: string[] = [];
    let boundContextActions: any;
    const extensionRunner = makeMockExtensionRunner({
      hasHandlers: vi.fn((eventType: string) => eventType === 'session_start'),
      bindCore: vi.fn((_actions, contextActions) => {
        order.push('bindCore');
        boundContextActions = contextActions;
      }),
      emitSessionStart: vi.fn(async () => {
        order.push('session_start');
      }),
      emitResourcesDiscover: vi.fn(async () => {
        order.push('resources_discover');
        expect(boundContextActions.getModel()?.id).toBe('test-model');
        expect(boundContextActions.getSystemPrompt()).toBe('System prompt');
        expect(boundContextActions.hasPendingMessages()).toBe(false);
        return { skillPaths: [], promptPaths: [], themePaths: [] };
      }),
    });

    const manager = await makeInitializedSessionManagerWithExtensionRunner(extensionRunner);

    expect(order).toEqual(['bindCore', 'session_start', 'resources_discover']);
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

  it('records model fallback diagnostics when restored session model is unavailable', async () => {
    mockSessionBuildContext.mockResolvedValue({
      messages: [],
      thinkingLevel: 'off',
      model: { provider: 'anthropic', modelId: 'missing-model' },
    } as any);
    mockFindModelByProvider.mockImplementation(((provider: string, modelId: string) =>
      provider === 'anthropic' && modelId === 'missing-model'
        ? undefined
        : {
            id: modelId,
            api: provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
            provider,
            input: ['text', 'image'],
          }) as any);

    const manager = makeSessionManager();
    await manager.restore({ id: 'restored-abc', createdAt: new Date().toISOString() } as any);

    expect(manager.modelFallbackMessage).toBe(
      'Session model "anthropic/missing-model" is unavailable. Falling back to "anthropic/test-model".',
    );
    expect(manager.diagnostics).toContainEqual({
      type: 'warning',
      message:
        'Session model "anthropic/missing-model" is unavailable. Falling back to "anthropic/test-model".',
    });
    manager.dispose();
  });

  it('uses the saved provider when diagnosing restored session model availability', async () => {
    mockSessionBuildContext.mockResolvedValue({
      messages: [],
      thinkingLevel: 'off',
      model: { provider: 'openai', modelId: 'foo' },
    } as any);
    mockFindModel.mockReturnValue({
      id: 'foo',
      api: 'anthropic-messages',
      provider: 'anthropic',
      input: ['text', 'image'],
    } as any);
    mockFindModelByProvider.mockReturnValue(undefined as any);

    const manager = makeSessionManager();
    await manager.restore({ id: 'restored-abc', createdAt: new Date().toISOString() } as any);

    expect(mockFindModelByProvider).toHaveBeenCalledWith('openai', 'foo');
    expect(manager.modelFallbackMessage).toBe(
      'Session model "openai/foo" is unavailable. Falling back to "anthropic/test-model".',
    );
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

  it('newSession emits shutdown before invalidating the old extension runner', async () => {
    const order: string[] = [];
    const extensionRunner = makeMockExtensionRunner({
      hasHandlers: vi.fn((eventType: string) =>
        ['session_before_switch', 'session_shutdown'].includes(eventType),
      ),
      emitSessionBeforeSwitch: vi.fn(async () => {
        order.push('before_switch');
        return undefined;
      }),
      emitSessionShutdown: vi.fn(async () => {
        order.push('shutdown');
      }),
      invalidate: vi.fn(() => {
        order.push('invalidate');
      }),
    });
    const manager = await makeInitializedSessionManagerWithExtensionRunner(extensionRunner);

    await manager.newSession();

    expect(extensionRunner.emitSessionShutdown).toHaveBeenCalledWith({
      type: 'session_shutdown',
      reason: 'new',
      targetSessionFile: undefined,
    });
    expect(order).toEqual(['before_switch', 'shutdown', 'invalidate']);
    manager.dispose();
  });

  it('reload shuts down old runner and starts replacement runner with reload discovery', async () => {
    const order: string[] = [];
    const extensionRunner = makeMockExtensionRunner({
      hasHandlers: vi.fn((eventType: string) => eventType === 'session_shutdown'),
      emitSessionShutdown: vi.fn(async () => {
        order.push('old:shutdown');
      }),
      invalidate: vi.fn(() => {
        order.push('old:invalidate');
      }),
    });
    const manager = await makeInitializedSessionManagerWithExtensionRunner(extensionRunner);
    const replacementRunner = makeMockExtensionRunner({
      hasHandlers: vi.fn((eventType: string) => eventType === 'session_start'),
      emitSessionStart: vi.fn(async (event) => {
        order.push(`new:start:${event.reason}`);
      }),
      emitResourcesDiscover: vi.fn(async (_cwd, reason) => {
        order.push(`new:discover:${reason}`);
        return { skillPaths: [], promptPaths: [], themePaths: [] };
      }),
    });
    vi.mocked(discoverAndLoadExtensions).mockResolvedValueOnce({
      extensions: [
        {
          path: '<replacement-extension>',
          resolvedPath: '<replacement-extension>',
          sourceInfo: {
            path: '<replacement-extension>',
            source: 'test',
            scope: 'temporary',
            origin: 'top-level',
          },
          handlers: new Map(),
          tools: new Map(),
          commands: new Map(),
        },
      ],
      errors: [],
      runtime: {} as any,
    });
    vi.mocked(ScoutExtensionRunner).mockImplementationOnce(function (this: any) {
      return replacementRunner as any;
    });

    await manager.reload();

    expect(extensionRunner.emitSessionShutdown).toHaveBeenCalledWith({
      type: 'session_shutdown',
      reason: 'reload',
      targetSessionFile: undefined,
    });
    expect(replacementRunner.emitSessionStart).toHaveBeenCalledWith({
      type: 'session_start',
      reason: 'reload',
    });
    expect(replacementRunner.emitResourcesDiscover).toHaveBeenCalledWith('/test/project', 'reload');
    expect(order).toEqual([
      'old:shutdown',
      'old:invalidate',
      'new:start:reload',
      'new:discover:reload',
    ]);
    manager.dispose();
  });

  it('reload refreshes project settings before rebuilding runtime', async () => {
    const manager = await makeInitializedSessionManager();

    await manager.reload();

    expect(mockConfigReload).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it('newSession still emits state_change when previous session teardown fails', async () => {
    const extensionRunner = makeMockExtensionRunner({
      hasHandlers: vi.fn((eventType: string) =>
        ['session_before_switch', 'session_shutdown'].includes(eventType),
      ),
      emitSessionBeforeSwitch: vi.fn(async () => undefined),
      emitSessionShutdown: vi.fn(async () => {
        throw new Error('shutdown failed');
      }),
    });
    const manager = await makeInitializedSessionManagerWithExtensionRunner(extensionRunner);
    const events: string[] = [];
    manager.subscribe((event) => {
      events.push(event.type);
    });

    await manager.newSession();

    expect(events).toContain('state_change');
    manager.dispose();
  });

  it('newSession emits state_change and reports error when withSession fails after replacement', async () => {
    const manager = await makeInitializedSessionManager();
    const replacementRunner = makeMockExtensionRunner();
    vi.mocked(discoverAndLoadExtensions).mockResolvedValueOnce({
      extensions: [
        {
          path: '<replacement-extension>',
          resolvedPath: '<replacement-extension>',
          sourceInfo: {
            path: '<replacement-extension>',
            source: 'test',
            scope: 'temporary',
            origin: 'top-level',
          },
          handlers: new Map(),
          tools: new Map(),
          commands: new Map(),
        },
      ],
      errors: [],
      runtime: {} as any,
    });
    vi.mocked(ScoutExtensionRunner).mockImplementationOnce(function (this: any) {
      return replacementRunner as any;
    });
    const callbackError = new Error('callback failed');
    const events: string[] = [];
    manager.subscribe((event) => {
      events.push(event.type === 'error' ? `error:${event.message}` : event.type);
    });

    const result = await manager.newSession({
      withSession: async () => {
        throw callbackError;
      },
    });

    expect(result.cancelled).toBe(false);
    expect(result.withSessionError).toBe(callbackError);
    expect(events).toContain('state_change');
    expect(events).toContain('error:withSession failed: callback failed');
    expect((manager as any).outputChannel.appendLine).toHaveBeenCalledWith(
      '[scout] Replacement withSession callback failed: callback failed',
    );
    manager.dispose();
  });

  it('logs suppressed teardown errors after a replacement teardown failure', async () => {
    const extensionRunner = makeMockExtensionRunner({
      hasHandlers: vi.fn((eventType: string) =>
        ['session_before_switch', 'session_shutdown'].includes(eventType),
      ),
      emitSessionBeforeSwitch: vi.fn(async () => undefined),
      emitSessionShutdown: vi.fn(async () => {
        throw new Error('shutdown failed');
      }),
      invalidate: vi.fn(() => {
        throw new Error('invalidate failed');
      }),
    });
    const manager = await makeInitializedSessionManagerWithExtensionRunner(extensionRunner);

    await manager.newSession();

    const appendLine = (manager as any).outputChannel.appendLine;
    expect(appendLine).toHaveBeenCalledWith(
      '[scout] Previous session teardown failed: shutdown failed',
    );
    expect(appendLine).toHaveBeenCalledWith(
      '[scout] Suppressed teardown error 1: invalidate failed',
    );
    manager.dispose();
  });

  it('initialize deletes a newly-created repo session when runtime creation fails early', async () => {
    mockSessionBuildContext.mockRejectedValueOnce(new Error('context failed'));
    const manager = makeSessionManager();

    await manager.initialize();

    expect(mockSessionRepoDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'test-session' }),
    );
    manager.dispose();
  });

  it('initialize invalidates extension runner when AgentSession initialization fails', async () => {
    const extensionRunner = makeMockExtensionRunner();
    vi.mocked(discoverAndLoadExtensions).mockResolvedValueOnce({
      extensions: [
        {
          path: '<test-extension>',
          resolvedPath: '<test-extension>',
          sourceInfo: {
            path: '<test-extension>',
            source: 'test',
            scope: 'temporary',
            origin: 'top-level',
          },
          handlers: new Map(),
          tools: new Map(),
          commands: new Map(),
        },
      ],
      errors: [],
      runtime: {} as any,
    });
    vi.mocked(ScoutExtensionRunner).mockImplementationOnce(function (this: any) {
      return extensionRunner as any;
    });
    MockAgentHarness.mockImplementationOnce(function () {
      throw new Error('harness init failed');
    });
    const manager = makeSessionManager();

    await manager.initialize();

    expect(extensionRunner.invalidate).toHaveBeenCalled();
    expect(mockSessionRepoDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'test-session' }),
    );
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

  it('rolls back copied session file when imported restore is cancelled', async () => {
    const root = makeTempRoot();
    const cwd = join(root, 'workspace');
    const agentDir = join(root, '.scout');
    const sourcePath = writeSessionJsonl(root, cwd);
    const manager = makeSessionManagerAt(cwd, agentDir);
    vi.spyOn(manager, 'restore').mockResolvedValueOnce({ cancelled: true });

    const result = await manager.importSessionFromJsonl(sourcePath, { cwdOverride: cwd });

    expect(result.cancelled).toBe(true);
    expect(listImportedSessionFiles(agentDir, cwd)).toEqual([]);
    manager.dispose();
  });

  it('rolls back copied session file when imported restore throws', async () => {
    const root = makeTempRoot();
    const cwd = join(root, 'workspace');
    const agentDir = join(root, '.scout');
    const sourcePath = writeSessionJsonl(root, cwd);
    const manager = makeSessionManagerAt(cwd, agentDir);
    const restoreError = new Error('restore failed');
    vi.spyOn(manager, 'restore').mockRejectedValueOnce(restoreError);

    await expect(manager.importSessionFromJsonl(sourcePath, { cwdOverride: cwd })).rejects.toBe(
      restoreError,
    );

    expect(listImportedSessionFiles(agentDir, cwd)).toEqual([]);
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
    mockFindModel.mockImplementation((id: string) => ({
      id,
      api: 'anthropic',
      provider: 'anthropic',
      input: ['text', 'image'],
    }));
    mockFindModelByProvider.mockImplementation((provider: string, modelId: string) => ({
      id: modelId,
      api: provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
      provider,
      input: ['text', 'image'],
    }));
    mockHasConfiguredModelAuth.mockReturnValue(true);
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
