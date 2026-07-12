import { vi } from 'vitest';

export interface MockWorkspaceConfiguration {
  get<T>(key: string): T | undefined;
}

let settings: Record<string, unknown> = {};

export function __setMockConfiguration(nextSettings: Record<string, unknown>): void {
  settings = { ...nextSettings };
}

export const workspace = {
  workspaceFolders: undefined as
    | Array<{ uri: { fsPath: string; path: string; scheme: string } }>
    | undefined,
  getConfiguration: vi.fn(
    (_section?: string): MockWorkspaceConfiguration => ({
      get<T>(key: string): T | undefined {
        return settings[key] as T | undefined;
      },
    }),
  ),
  onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  fs: {
    readFile: vi.fn(async () => new Uint8Array()),
    stat: vi.fn(async () => ({ type: 1 })),
    writeFile: vi.fn(async () => undefined),
  },
};

export const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
};

export const commands = {
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  executeCommand: vi.fn(),
};

export const env = {
  clipboard: {
    writeText: vi.fn(async () => undefined),
  },
};

export const window = {
  createWebviewPanel: vi.fn(),
  createOutputChannel: vi.fn(),
  registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
};

export const Uri = {
  file(path: string) {
    return { fsPath: path, path, scheme: 'file' };
  },
  joinPath(base: { fsPath: string; path?: string; scheme?: string }, ...parts: string[]) {
    const joined = [base.fsPath, ...parts].join('/');
    return { fsPath: joined, path: joined, scheme: base.scheme ?? 'file' };
  },
};

export const ViewColumn = {
  Active: -1,
  Beside: 2,
};

export class Disposable {
  private readonly fn: () => void;

  constructor(fn: () => void = () => {}) {
    this.fn = fn;
  }

  dispose(): void {
    this.fn();
  }
}
