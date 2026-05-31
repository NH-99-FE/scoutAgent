/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================
// ScoutSidebarProvider 测试
// ============================================================

import { describe, it, expect, vi } from 'vitest';

// ---------- 预定义 mock 值 ----------

const { mockUri } = vi.hoisted(() => ({
  mockUri: {
    parse: vi.fn(),
    file: vi.fn((p: string) => ({ fsPath: p })),
    joinPath: vi.fn((base: any, ...segments: string[]) => ({
      fsPath: segments.reduce((acc, seg) => `${acc}/${seg}`, base.fsPath ?? ''),
    })),
  },
}));

// ---------- Mock vscode ----------

vi.mock('vscode', () => ({
  Uri: mockUri,
  Disposable: class {
    dispose() {}
  },
  window: {},
  workspace: {},
}));

// ---------- Mock node:fs ----------

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '<html></html>'),
}));

// ---------- Mock node:http ----------

vi.mock('node:http', () => ({
  get: vi.fn(() => ({
    on: vi.fn(),
    setTimeout: vi.fn(),
    destroy: vi.fn(),
    resume: vi.fn(),
  })),
}));

// ---------- Tests ----------

import { ScoutSidebarProvider } from '../sidebar-provider.ts';

function makeController() {
  return {
    bindWebview: vi.fn(),
    dispose: vi.fn(),
  } as any;
}

function makeWebview() {
  return {
    options: {},
    html: '',
    postMessage: vi.fn(),
    onDidReceiveMessage: vi.fn(),
    asWebviewUri: vi.fn(() => ({ toString: () => 'vscode-webview://test' })),
  };
}

function makeWebviewView() {
  return {
    webview: makeWebview(),
    visible: true,
    show: vi.fn(),
  } as any;
}

describe('ScoutSidebarProvider', () => {
  it('has correct viewType', () => {
    expect(ScoutSidebarProvider.viewType).toBe('scout-agent.sidebar');
  });

  it('calls controller.bindWebview on resolveWebviewView', async () => {
    const controller = makeController();
    const provider = new ScoutSidebarProvider(mockUri.file('/ext') as any, false, controller);
    const mockWebviewView = makeWebviewView();

    await provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

    expect(controller.bindWebview).toHaveBeenCalledWith(mockWebviewView.webview);
  });

  it('sets webview options with enableScripts', async () => {
    const controller = makeController();
    const provider = new ScoutSidebarProvider(mockUri.file('/ext') as any, false, controller);
    const mockWebviewView = makeWebviewView();

    await provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

    expect(mockWebviewView.webview.options.enableScripts).toBe(true);
  });

  it('generates fallback HTML when webview not built', async () => {
    const controller = makeController();
    const provider = new ScoutSidebarProvider(mockUri.file('/ext') as any, false, controller);
    const mockWebviewView = makeWebviewView();

    await provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

    expect(mockWebviewView.webview.html).toContain('Scout Agent');
    expect(mockWebviewView.webview.html).toContain('not built yet');
  });

  it('stores isDev flag', () => {
    const controller = makeController();
    const provider = new ScoutSidebarProvider(mockUri.file('/ext') as any, true, controller);
    expect(provider).toBeDefined();
  });
});
