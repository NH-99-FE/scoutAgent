import { vi } from 'vitest';

export const window = {
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  createWebviewPanel: vi.fn(),
  registerWebviewViewProvider: vi.fn(),
};

export const commands = {
  registerCommand: vi.fn(),
  executeCommand: vi.fn(),
};

export const Uri = {
  parse: vi.fn(),
  file: vi.fn((p: string) => ({ fsPath: p })),
  joinPath: vi.fn(),
};

export class CancellationToken {
  isCancellationRequested = false;
}

export const ExtensionMode = {
  Production: 1,
  Development: 2,
  Test: 3,
} as const;

export interface ExtensionContext {
  extensionUri: typeof Uri;
  extensionMode: (typeof ExtensionMode)[keyof typeof ExtensionMode];
  subscriptions: { dispose(): void }[];
}
