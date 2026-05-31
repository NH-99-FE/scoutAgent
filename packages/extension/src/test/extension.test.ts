/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================
// Extension 入口测试
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- 预定义 mock 值（vi.hoisted 确保 vi.mock 工厂可用）----------

const { mockUri, mockCreateOutputChannel, mockRegisterCommand } = vi.hoisted(() => ({
  mockUri: {
    parse: vi.fn(),
    file: vi.fn((p: string) => ({ fsPath: p })),
    joinPath: vi.fn((base: any, ...segments: string[]) => ({
      fsPath: segments.reduce((acc, seg) => `${acc}/${seg}`, base.fsPath ?? ''),
    })),
  },
  mockCreateOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    append: vi.fn(),
    clear: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  })),
  mockRegisterCommand: vi.fn(),
}));

// ---------- Mock vscode ----------

vi.mock('vscode', () => ({
  Uri: mockUri,
  Disposable: class { dispose() {} },
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  window: {
    createOutputChannel: mockCreateOutputChannel,
    registerWebviewViewProvider: vi.fn(),
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/test/project' } }],
  },
  commands: {
    registerCommand: mockRegisterCommand,
    executeCommand: vi.fn(),
  },
}));

// ---------- Mock internal modules ----------

vi.mock('../scout-controller.ts', () => ({
  ScoutController: vi.fn(function (this: any) {
    this.dispose = vi.fn();
  }),
}));

vi.mock('../sidebar-provider.ts', () => ({
  ScoutSidebarProvider: Object.assign(
    vi.fn(function (this: any) {}),
    { viewType: 'scout-agent.sidebar' },
  ),
}));

// ---------- Tests ----------

import { activate, deactivate } from '../extension.ts';

describe('activate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates output channel', () => {
    const context = {
      extensionUri: mockUri.file('/test/extension'),
      extensionMode: 1,
      subscriptions: [],
    } as any;

    activate(context);

    expect(mockCreateOutputChannel).toHaveBeenCalledWith('Scout Agent');
  });

  it('registers openSidebar command', () => {
    const context = {
      extensionUri: mockUri.file('/test/extension'),
      extensionMode: 1,
      subscriptions: [],
    } as any;

    activate(context);

    expect(mockRegisterCommand).toHaveBeenCalledWith('scout-agent.openSidebar', expect.any(Function));
  });

  it('pushes subscriptions to context', () => {
    const context = {
      extensionUri: mockUri.file('/test/extension'),
      extensionMode: 1,
      subscriptions: [],
    } as any;

    activate(context);

    expect(context.subscriptions.length).toBeGreaterThan(0);
  });
});

describe('deactivate', () => {
  it('does not throw', () => {
    expect(() => deactivate()).not.toThrow();
  });
});
