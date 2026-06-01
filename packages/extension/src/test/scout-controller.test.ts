/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================
// ScoutController 测试 — 精简后的 Webview 路由层
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- 预定义 mock 值（vi.hoisted 确保在 vi.mock 工厂中可用）----------

const {
  mockUri,
  mockFindDefaultModel,
  mockGetApiKey,
  mockGetScoutConfig,
  mockOnDidChangeSettings,
  mockSessionManagerSubscribe,
  mockSessionManagerInitialize,
  mockSessionManagerPrompt,
  mockSessionManagerAbort,
  mockSessionManagerSetModel,
  mockSessionManagerSetThinkingLevel,
  mockSessionManagerNewSession,
  mockSessionManagerCompact,
  mockSessionManagerGetScoutMessages,
  mockSessionManagerGetModel,
  mockSessionManagerGetThinkingLevel,
  mockSessionManagerIsStreaming,
  mockSessionManagerDispose,
  mockSessionManagerFork,
  mockSessionManagerSessionId,
  mockSessionManagerParentSessionPath,
  mockSessionManagerGetTree,
  mockSessionManagerNavigateTree,
  mockSessionManagerSetLabel,
  mockSessionManagerLeafId,
} = vi.hoisted(() => {
  const mockUri = {
    parse: vi.fn(),
    file: vi.fn((p: string) => ({ fsPath: p })),
    joinPath: vi.fn((base: any, ...segments: string[]) => ({
      fsPath: segments.reduce((acc, seg) => `${acc}/${seg}`, base.fsPath ?? ''),
    })),
  };

  return {
    mockUri,
    mockFindDefaultModel: vi.fn(() => ({
      id: 'test-model',
      api: 'anthropic',
      provider: 'anthropic',
      input: ['text', 'image'],
    })),
    mockGetApiKey: vi.fn(() => 'test-key'),
    mockGetScoutConfig: vi.fn(() => ({ models: [], defaultModelId: 'test-model' })),
    mockOnDidChangeSettings: vi.fn(() => ({ dispose: vi.fn() })),
    mockSessionManagerSubscribe: vi.fn(() => vi.fn()),
    mockSessionManagerInitialize: vi.fn(async () => {}),
    mockSessionManagerPrompt: vi.fn(async () => {}),
    mockSessionManagerAbort: vi.fn(async () => {}),
    mockSessionManagerSetModel: vi.fn(async () => {}),
    mockSessionManagerSetThinkingLevel: vi.fn(async () => {}),
    mockSessionManagerNewSession: vi.fn(async () => {}),
    mockSessionManagerCompact: vi.fn(async () => {}),
    mockSessionManagerGetScoutMessages: vi.fn(() => []),
    mockSessionManagerGetModel: vi.fn(() => ({ id: 'test-model' })),
    mockSessionManagerGetThinkingLevel: vi.fn(() => 'off'),
    mockSessionManagerIsStreaming: false,
    mockSessionManagerDispose: vi.fn(),
    mockSessionManagerFork: vi.fn(async () => {}),
    mockSessionManagerSessionId: 'test-session-id',
    mockSessionManagerParentSessionPath: undefined,
    mockSessionManagerGetTree: vi.fn(async () => [] as any[]),
    mockSessionManagerNavigateTree: vi.fn(async () => ({ cancelled: false })),
    mockSessionManagerSetLabel: vi.fn(async () => {}),
    mockSessionManagerLeafId: null,
  };
});

// ---------- Mock vscode ----------

vi.mock('vscode', () => ({
  Uri: mockUri,
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
  AgentHarness: vi.fn(),
  JsonlSessionRepo: vi.fn(),
  NodeExecutionEnv: vi.fn(),
  shouldCompact: vi.fn(),
  calculateContextTokens: vi.fn(() => 0),
  estimateContextTokens: vi.fn(() => ({ tokens: 0, lastUsageIndex: null })),
  DEFAULT_ACTIVE_TOOL_NAMES: ['read', 'bash', 'edit', 'write'],
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
    this.getApiKey = mockGetApiKey;
    this.findModel = vi.fn((id: string) => ({
      id,
      api: 'anthropic',
      provider: 'anthropic',
      input: ['text', 'image'],
    }));
    this.getShellPath = vi.fn();
    this.getDefaultThinkingLevel = vi.fn(() => 'off');
    this.getCompactionSettings = vi.fn(() => ({
      enabled: true,
      reserveTokens: 16384,
      keepRecentTokens: 20000,
    }));
    this.getSteeringMode = vi.fn(() => 'one-at-a-time');
    this.getFollowUpMode = vi.fn(() => 'one-at-a-time');
    this.getScoutConfig = mockGetScoutConfig;
    this.onDidChangeSettings = mockOnDidChangeSettings;
  }),
}));

vi.mock('../session-manager.ts', () => ({
  SessionManager: vi.fn(function (this: any) {
    this.subscribe = mockSessionManagerSubscribe;
    this.initialize = mockSessionManagerInitialize;
    this.prompt = mockSessionManagerPrompt;
    this.abort = mockSessionManagerAbort;
    this.setModel = mockSessionManagerSetModel;
    this.setThinkingLevel = mockSessionManagerSetThinkingLevel;
    this.newSession = mockSessionManagerNewSession;
    this.compact = mockSessionManagerCompact;
    this.getScoutMessages = mockSessionManagerGetScoutMessages;
    this.model = mockSessionManagerGetModel();
    this.thinkingLevel = mockSessionManagerGetThinkingLevel();
    this.isStreaming = mockSessionManagerIsStreaming;
    this.dispose = mockSessionManagerDispose;
    this.fork = mockSessionManagerFork;
    this.sessionId = mockSessionManagerSessionId;
    this.parentSessionPath = mockSessionManagerParentSessionPath;
    this.getTree = mockSessionManagerGetTree;
    this.navigateTree = mockSessionManagerNavigateTree;
    this.setLabel = mockSessionManagerSetLabel;
    this.leafId = mockSessionManagerLeafId;
  }),
}));

vi.mock('../skill-loader.ts', () => ({
  loadSkills: vi.fn(() => ({ skills: [], diagnostics: [] })),
}));

vi.mock('../system-prompt.ts', () => ({
  buildSystemPrompt: vi.fn(() => 'System prompt'),
}));

vi.mock('../tools/index.ts', () => ({
  createTools: vi.fn(() => []),
  DEFAULT_ACTIVE_TOOL_NAMES: ['read', 'bash', 'edit', 'write'],
}));

// ---------- Tests ----------

import { ScoutController } from '../scout-controller.ts';

function makeController(): ScoutController {
  return new ScoutController({
    extensionUri: mockUri.file('/test/extension') as any,
    outputChannel: {
      appendLine: vi.fn(),
      append: vi.fn(),
      clear: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    } as any,
    cwd: '/test/project',
  });
}

function makeWebview() {
  return {
    postMessage: vi.fn(),
    onDidReceiveMessage: vi.fn(),
    options: {},
    html: '',
    asWebviewUri: vi.fn(),
  } as any;
}

describe('ScoutController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindDefaultModel.mockReturnValue({
      id: 'test-model',
      api: 'anthropic',
      provider: 'anthropic',
      input: ['text', 'image'],
    });
    mockSessionManagerSubscribe.mockReturnValue(vi.fn() as any);
    mockSessionManagerGetScoutMessages.mockReturnValue([]);
    mockSessionManagerGetModel.mockReturnValue({ id: 'test-model' });
    mockSessionManagerGetThinkingLevel.mockReturnValue('off');
  });

  it('creates controller without error', () => {
    const controller = makeController();
    expect(controller).toBeDefined();
    expect(mockSessionManagerSubscribe).toHaveBeenCalled();
    controller.dispose();
  });

  it('binds webview and handles messages', () => {
    const controller = makeController();
    const webview = makeWebview();
    controller.bindWebview(webview);

    expect(webview.onDidReceiveMessage).toHaveBeenCalled();
    controller.dispose();
  });

  it('handles ready message and initializes session', async () => {
    const controller = makeController();
    const webview = makeWebview();
    controller.bindWebview(webview);

    controller.handleWebviewMessage({ type: 'ready' });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSessionManagerInitialize).toHaveBeenCalled();
    expect(webview.postMessage).toHaveBeenCalled();
    controller.dispose();
  });

  it('handles user_message by delegating to SessionManager', () => {
    const controller = makeController();

    controller.handleWebviewMessage({ type: 'user_message', text: 'Hello' });

    expect(mockSessionManagerPrompt).toHaveBeenCalledWith('Hello');
    controller.dispose();
  });

  it('handles abort by delegating to SessionManager', () => {
    const controller = makeController();

    controller.handleWebviewMessage({ type: 'abort' });

    expect(mockSessionManagerAbort).toHaveBeenCalled();
    controller.dispose();
  });

  it('handles select_model by delegating to SessionManager', () => {
    const controller = makeController();

    controller.handleWebviewMessage({ type: 'select_model', modelId: 'gpt-4o' });

    expect(mockSessionManagerSetModel).toHaveBeenCalledWith('gpt-4o');
    controller.dispose();
  });

  it('handles select_thinking by delegating to SessionManager', () => {
    const controller = makeController();

    controller.handleWebviewMessage({ type: 'select_thinking', level: 'medium' });

    expect(mockSessionManagerSetThinkingLevel).toHaveBeenCalledWith('medium');
    controller.dispose();
  });

  it('handles clear_conversation by delegating to SessionManager', () => {
    const controller = makeController();

    controller.handleWebviewMessage({ type: 'clear_conversation' });

    expect(mockSessionManagerNewSession).toHaveBeenCalled();
    controller.dispose();
  });

  it('forwards agent_event to webview', () => {
    const controller = makeController();
    const webview = makeWebview();
    controller.bindWebview(webview);

    // 获取 SessionManager.subscribe 传入的 listener
    const sessionListener = (mockSessionManagerSubscribe.mock.calls as any[])[0]?.[0] as
      | ((event: import('../session-manager.ts').ScoutSessionEvent) => void)
      | undefined;
    expect(sessionListener).toBeDefined();

    // 模拟 agent_event
    sessionListener!({ type: 'agent_event', event: { type: 'agent_start' } });

    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent_event' }),
    );
    controller.dispose();
  });

  it('pushes state on state_change event', () => {
    const controller = makeController();
    const webview = makeWebview();
    controller.bindWebview(webview);

    const sessionListener = (mockSessionManagerSubscribe.mock.calls as any[])[0]?.[0] as
      | ((event: import('../session-manager.ts').ScoutSessionEvent) => void)
      | undefined;
    expect(sessionListener).toBeDefined();

    sessionListener!({ type: 'state_change' });

    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'state_update' }),
    );
    controller.dispose();
  });

  it('pushes state on error event', () => {
    const controller = makeController();
    const webview = makeWebview();
    controller.bindWebview(webview);

    const sessionListener = (mockSessionManagerSubscribe.mock.calls as any[])[0]?.[0] as
      | ((event: import('../session-manager.ts').ScoutSessionEvent) => void)
      | undefined;

    sessionListener!({ type: 'error', message: 'Something went wrong' });

    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'state_update' }),
    );
    controller.dispose();
  });

  it('dispose cleans up SessionManager', () => {
    const controller = makeController();
    controller.dispose();

    expect(mockSessionManagerDispose).toHaveBeenCalled();
  });

  it('dispose handles double dispose without error', () => {
    const controller = makeController();
    controller.dispose();
    controller.dispose();
  });

  it('pushes config on settings change', () => {
    const controller = makeController();
    const webview = makeWebview();
    controller.bindWebview(webview);

    // 获取 onDidChangeSettings 传入的回调
    const settingsCallback = (mockOnDidChangeSettings.mock.calls as any[])[0]?.[0] as
      | (() => void)
      | undefined;
    expect(settingsCallback).toBeDefined();

    settingsCallback!();

    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'config_update' }),
    );
    controller.dispose();
  });

  it('handles fork_session message by delegating to SessionManager', () => {
    const controller = makeController();

    controller.handleWebviewMessage({
      type: 'fork_session',
      entryId: 'entry-1',
      position: 'before',
    });

    expect(mockSessionManagerFork).toHaveBeenCalledWith('entry-1', 'before');
    controller.dispose();
  });

  it('buildState includes sessionId', () => {
    const controller = makeController();
    const webview = makeWebview();
    controller.bindWebview(webview);

    const sessionListener = (mockSessionManagerSubscribe.mock.calls as any[])[0]?.[0] as
      | ((event: import('../session-manager.ts').ScoutSessionEvent) => void)
      | undefined;
    expect(sessionListener).toBeDefined();

    sessionListener!({ type: 'state_change' });

    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'state_update',
        state: expect.objectContaining({ sessionId: 'test-session-id' }),
      }),
    );
    controller.dispose();
  });

  it('handles request_tree message by pushing tree data', async () => {
    mockSessionManagerGetTree.mockResolvedValue([{ id: 'entry-1', children: [] }]);

    const controller = makeController();
    const webview = makeWebview();
    controller.bindWebview(webview);

    controller.handleWebviewMessage({ type: 'request_tree' });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSessionManagerGetTree).toHaveBeenCalled();
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tree_data' }),
    );
    controller.dispose();
  });

  it('handles navigate_tree message by delegating to SessionManager', async () => {
    mockSessionManagerNavigateTree.mockResolvedValue({
      cancelled: false,
      editorText: 'test',
    } as any);

    const controller = makeController();
    const webview = makeWebview();
    controller.bindWebview(webview);

    controller.handleWebviewMessage({
      type: 'navigate_tree',
      targetId: 'entry-1',
      summarize: true,
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSessionManagerNavigateTree).toHaveBeenCalledWith('entry-1', { summarize: true });
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'navigate_tree_result', success: true }),
    );
    controller.dispose();
  });

  it('handles set_label message by delegating to SessionManager', async () => {
    const controller = makeController();
    const webview = makeWebview();
    controller.bindWebview(webview);

    controller.handleWebviewMessage({ type: 'set_label', entryId: 'entry-1', label: 'important' });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSessionManagerSetLabel).toHaveBeenCalledWith('entry-1', 'important');
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'label_result', success: true }),
    );
    controller.dispose();
  });

  it('pushes tree_data on tree_change event', async () => {
    mockSessionManagerGetTree.mockResolvedValue([]);

    const controller = makeController();
    const webview = makeWebview();
    controller.bindWebview(webview);

    const sessionListener = (mockSessionManagerSubscribe.mock.calls as any[])[0]?.[0] as
      | ((event: import('../session-manager.ts').ScoutSessionEvent) => void)
      | undefined;
    expect(sessionListener).toBeDefined();

    sessionListener!({ type: 'tree_change' });

    await new Promise((r) => setTimeout(r, 50));

    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tree_data' }),
    );
    controller.dispose();
  });

  it('buildState includes leafId', () => {
    const controller = makeController();
    const webview = makeWebview();
    controller.bindWebview(webview);

    const sessionListener = (mockSessionManagerSubscribe.mock.calls as any[])[0]?.[0] as
      | ((event: import('../session-manager.ts').ScoutSessionEvent) => void)
      | undefined;
    expect(sessionListener).toBeDefined();

    sessionListener!({ type: 'state_change' });

    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'state_update',
        state: expect.objectContaining({ leafId: null }),
      }),
    );
    controller.dispose();
  });

  it('navigate_tree_result sent with error on failure', async () => {
    mockSessionManagerNavigateTree.mockRejectedValue(new Error('Navigation failed'));

    const controller = makeController();
    const webview = makeWebview();
    controller.bindWebview(webview);

    controller.handleWebviewMessage({
      type: 'navigate_tree',
      targetId: 'entry-1',
      summarize: false,
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'navigate_tree_result', success: false }),
    );
    controller.dispose();
  });

  it('label_result sent with error on failure', async () => {
    mockSessionManagerSetLabel.mockRejectedValue(new Error('Label failed'));

    const controller = makeController();
    const webview = makeWebview();
    controller.bindWebview(webview);

    controller.handleWebviewMessage({ type: 'set_label', entryId: 'entry-1', label: 'test' });

    await new Promise((r) => setTimeout(r, 50));

    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'label_result', success: false }),
    );
    controller.dispose();
  });
});
