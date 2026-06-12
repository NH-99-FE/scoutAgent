import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ScoutWebviewPanelManager } from '../../src/webview-panel-manager.ts';
import type { ScoutController } from '../../src/scout-controller.ts';

function makeWebview() {
  return {
    options: {},
    html: '',
    onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
    postMessage: vi.fn(),
    asWebviewUri: vi.fn((uri) => uri),
  };
}

function makePanel() {
  let disposeListener: (() => void) | undefined;
  const panel = {
    webview: makeWebview(),
    reveal: vi.fn(),
    dispose: vi.fn(() => disposeListener?.()),
    onDidDispose: vi.fn((listener: () => void) => {
      disposeListener = listener;
      return { dispose: vi.fn() };
    }),
  };
  return panel;
}

function makeController() {
  return {
    bindWebview: vi.fn(() => ({ dispose: vi.fn() })),
  } as unknown as ScoutController;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ScoutWebviewPanelManager', () => {
  beforeEach(() => {
    vi.mocked(vscode.window.createWebviewPanel).mockReset();
  });

  it('reveals an existing tree panel instead of creating another one', async () => {
    const panel = makePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
    const controller = makeController();
    const manager = new ScoutWebviewPanelManager(vscode.Uri.file('/ext'), false, controller);

    await manager.openTreePanel();
    await manager.openTreePanel();

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(panel.reveal).toHaveBeenCalledWith(vscode.ViewColumn.Beside);
    expect(controller.bindWebview).toHaveBeenCalledWith(panel.webview, 'tree');
  });

  it('reveals a pending tree panel instead of creating a duplicate while html is loading', async () => {
    const panel = makePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
    const controller = makeController();
    const html = deferred<string>();
    const htmlLoader = vi.fn(() => html.promise);
    const manager = new ScoutWebviewPanelManager(
      vscode.Uri.file('/ext'),
      true,
      controller,
      htmlLoader,
    );

    const firstOpen = manager.openTreePanel();
    const secondOpen = manager.openTreePanel();
    html.resolve('<html></html>');
    await Promise.all([firstOpen, secondOpen]);

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(panel.reveal).toHaveBeenCalledWith(vscode.ViewColumn.Beside);
    expect(htmlLoader).toHaveBeenCalledTimes(1);
    expect(controller.bindWebview).toHaveBeenCalledTimes(1);
    expect(controller.bindWebview).toHaveBeenCalledWith(panel.webview, 'tree');
  });

  it('does not write html or bind webview after a pending panel is disposed', async () => {
    const panel = makePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
    const controller = makeController();
    const html = deferred<string>();
    const htmlLoader = vi.fn(() => html.promise);
    const manager = new ScoutWebviewPanelManager(
      vscode.Uri.file('/ext'),
      true,
      controller,
      htmlLoader,
    );

    const open = manager.openSettingsPanel();
    panel.dispose();
    html.resolve('<html>late</html>');
    await open;

    expect(panel.webview.html).toBe('');
    expect(controller.bindWebview).not.toHaveBeenCalled();
  });

  it('closes the other singleton panel before opening a different surface', async () => {
    const settingsPanel = makePanel();
    const treePanel = makePanel();
    vi.mocked(vscode.window.createWebviewPanel)
      .mockReturnValueOnce(settingsPanel as never)
      .mockReturnValueOnce(treePanel as never);
    const controller = makeController();
    const settingsBinding = { dispose: vi.fn() };
    vi.mocked(controller.bindWebview)
      .mockReturnValueOnce(settingsBinding)
      .mockReturnValueOnce({ dispose: vi.fn() });
    const manager = new ScoutWebviewPanelManager(vscode.Uri.file('/ext'), false, controller);

    await manager.openSettingsPanel();
    await manager.openTreePanel();

    expect(settingsPanel.dispose).toHaveBeenCalledTimes(1);
    expect(settingsBinding.dispose).toHaveBeenCalledTimes(1);
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(controller.bindWebview).toHaveBeenLastCalledWith(treePanel.webview, 'tree');
  });

  it('clears panel bindings when the panel is disposed', async () => {
    const firstPanel = makePanel();
    const secondPanel = makePanel();
    vi.mocked(vscode.window.createWebviewPanel)
      .mockReturnValueOnce(firstPanel as never)
      .mockReturnValueOnce(secondPanel as never);
    const controller = makeController();
    const firstBinding = { dispose: vi.fn() };
    vi.mocked(controller.bindWebview)
      .mockReturnValueOnce(firstBinding)
      .mockReturnValueOnce({ dispose: vi.fn() });
    const manager = new ScoutWebviewPanelManager(vscode.Uri.file('/ext'), false, controller);

    await manager.openSettingsPanel();
    firstPanel.dispose();
    await manager.openSettingsPanel();

    expect(firstBinding.dispose).toHaveBeenCalledTimes(1);
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(controller.bindWebview).toHaveBeenLastCalledWith(secondPanel.webview, 'settings');
  });
});
