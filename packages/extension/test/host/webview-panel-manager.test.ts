import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ScoutWebviewPanelManager } from '../../src/webview-panel-manager.ts';
import type { ScoutController } from '../../src/scout-controller.ts';

function makeWebview() {
  let html = '';
  let listener: ((message: unknown) => void) | undefined;
  let messageOnHtmlSet: unknown;
  return {
    options: {},
    get html() {
      return html;
    },
    set html(value: string) {
      html = value;
      if (messageOnHtmlSet !== undefined) {
        listener?.(messageOnHtmlSet);
      }
    },
    emitMessageOnHtmlSet(message: unknown) {
      messageOnHtmlSet = message;
    },
    onDidReceiveMessage: vi.fn((callback: (message: unknown) => void) => {
      listener = callback;
      return { dispose: vi.fn() };
    }),
    postMessage: vi.fn(),
    asWebviewUri: vi.fn((uri) => uri),
  };
}

function makePanel(viewColumn = vscode.ViewColumn.Active) {
  let disposeListener: (() => void) | undefined;
  const panel = {
    webview: makeWebview(),
    viewColumn,
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
    expect(panel.reveal).toHaveBeenCalledWith(vscode.ViewColumn.Active);
    expect(controller.bindWebview).toHaveBeenCalledWith(panel.webview, 'tree');
  });

  it('binds a panel webview before assigning html so startup requests are not dropped', async () => {
    const panel = makePanel();
    panel.webview.emitMessageOnHtmlSet({
      type: 'protocol_request',
      requestId: 'settings-startup',
      service: 'config',
      method: 'request_custom_models',
      payload: { type: 'request_custom_models' },
    });
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
    const receivedMessages: unknown[] = [];
    const controller = {
      bindWebview: vi.fn((webview: ReturnType<typeof makeWebview>) => {
        webview.onDidReceiveMessage((message) => receivedMessages.push(message));
        return { dispose: vi.fn() };
      }),
    } as unknown as ScoutController;
    const manager = new ScoutWebviewPanelManager(vscode.Uri.file('/ext'), false, controller);

    await manager.openSettingsPanel();

    expect(receivedMessages).toEqual([
      {
        type: 'protocol_request',
        requestId: 'settings-startup',
        service: 'config',
        method: 'request_custom_models',
        payload: { type: 'request_custom_models' },
      },
    ]);
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
    expect(panel.reveal).toHaveBeenCalledWith(vscode.ViewColumn.Active);
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

  it('opens different surfaces as independent tabs in the same editor group', async () => {
    const settingsPanel = makePanel(vscode.ViewColumn.Beside);
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

    expect(settingsPanel.dispose).not.toHaveBeenCalled();
    expect(settingsBinding.dispose).not.toHaveBeenCalled();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(vscode.window.createWebviewPanel).toHaveBeenLastCalledWith(
      'scout-agent.tree',
      'Scout Tree',
      settingsPanel.viewColumn,
      { enableScripts: true, retainContextWhenHidden: false },
    );
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
