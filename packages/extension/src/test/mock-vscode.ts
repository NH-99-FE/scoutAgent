/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================
// VS Code 模块 mock — 用于单元测试
// ============================================================

import { vi } from 'vitest';

// ---------- WorkspaceConfiguration mock ----------

export function createMockConfiguration(config: Record<string, unknown> = {}): any {
  return {
    get: vi.fn((key: string, defaultValue?: unknown) => {
      if (key in config) return config[key];
      return defaultValue;
    }),
    has: vi.fn((key: string) => key in config),
    update: vi.fn(),
    inspect: vi.fn(),
  };
}

// ---------- Disposable mock ----------

export class Disposable {
  private readonly _callOnDispose: () => void;

  constructor(callOnDispose: () => void) {
    this._callOnDispose = callOnDispose;
  }

  dispose(): void {
    this._callOnDispose();
  }
}

// ---------- EventEmitter mock ----------

export class EventEmitter<T = unknown> {
  private listeners: ((e: T) => unknown)[] = [];

  event = vi.fn((listener: (e: T) => unknown) => {
    this.listeners.push(listener);
    return new Disposable(() => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    });
  });

  fire(data: T): void {
    for (const listener of this.listeners) {
      listener(data);
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}

// ---------- Window mock ----------

export const window = {
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  createWebviewPanel: vi.fn(),
  registerWebviewViewProvider: vi.fn(),
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    append: vi.fn(),
    clear: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  })),
};

// ---------- Workspace mock ----------

const _onDidChangeConfiguration = new EventEmitter<void>();

export const workspace = {
  getConfiguration: vi.fn((_section?: string) => createMockConfiguration()),
  onDidChangeConfiguration: _onDidChangeConfiguration.event,
  workspaceFolders: [] as Array<{ uri: { fsPath: string } }>,
};

// ---------- Commands mock ----------

export const commands = {
  registerCommand: vi.fn(),
  executeCommand: vi.fn(),
};

// ---------- Uri mock ----------

export const Uri = {
  parse: vi.fn(),
  file: vi.fn((p: string) => ({ fsPath: p, scheme: 'file', path: p, query: '', fragment: '', authority: '', with: () => ({}), toString: () => p, toJSON: () => ({ fsPath: p }) })),
  joinPath: vi.fn((base: any, ...pathSegments: string[]) => ({
    fsPath: pathSegments.reduce((acc, seg) => `${acc}/${seg}`, base.fsPath ?? ''),
  })),
};

// ---------- CancellationToken mock ----------

export class CancellationToken {
  isCancellationRequested = false;
}

// ---------- ExtensionMode mock ----------

export const ExtensionMode = {
  Production: 1,
  Development: 2,
  Test: 3,
} as const;

// ---------- ExtensionContext mock ----------

export interface ExtensionContext {
  extensionUri: { fsPath: string; scheme: string; path: string; query: string; fragment: string; authority: string; with: () => any; toString: () => string; toJSON: () => any };
  extensionMode: (typeof ExtensionMode)[keyof typeof ExtensionMode];
  subscriptions: { dispose(): void }[];
}

export function createMockExtensionContext(overrides?: Partial<ExtensionContext>): ExtensionContext {
  return {
    extensionUri: Uri.file('/test/extension'),
    extensionMode: ExtensionMode.Test,
    subscriptions: [],
    ...overrides,
  };
}

// ---------- Webview mock ----------

export interface MockWebview {
  options: any;
  html: string;
  postMessage: ReturnType<typeof vi.fn>;
  onDidReceiveMessage: ReturnType<typeof vi.fn>;
  asWebviewUri: ReturnType<typeof vi.fn>;
}

export function createMockWebview(): MockWebview {
  return {
    options: {},
    html: '',
    postMessage: vi.fn(),
    onDidReceiveMessage: vi.fn(),
    asWebviewUri: vi.fn((uri: any) => ({ toString: () => `vscode-webview://${uri.fsPath}` })),
  };
}

// ---------- WebviewView mock ----------

export interface MockWebviewView {
  webview: MockWebview;
  visible: boolean;
  show: ReturnType<typeof vi.fn>;
}

export function createMockWebviewView(): MockWebviewView {
  return {
    webview: createMockWebview(),
    visible: true,
    show: vi.fn(),
  };
}
