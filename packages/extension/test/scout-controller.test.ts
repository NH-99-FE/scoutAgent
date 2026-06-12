import { describe, expect, it, vi } from 'vitest';
import { ScoutController } from '../src/scout-controller.ts';
import * as vscode from 'vscode';

function makeOutputChannel() {
  return {
    name: 'scout-test',
    append: vi.fn(),
    appendLine: vi.fn(),
    replace: vi.fn(),
    clear: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  };
}

function makeWebview() {
  return {
    onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
    postMessage: vi.fn(),
  };
}

function makeController(): ScoutController {
  return new ScoutController({
    extensionUri: vscode.Uri.file('/ext'),
    outputChannel: makeOutputChannel() as never,
    cwd: '/workspace',
  });
}

describe('ScoutController webview surfaces', () => {
  it('broadcasts extension messages to every bound webview surface', () => {
    const controller = makeController();
    const chat = makeWebview();
    const tree = makeWebview();
    const settings = makeWebview();

    controller.bindWebview(chat as never, 'chat');
    controller.bindWebview(tree as never, 'tree');
    controller.bindWebview(settings as never, 'settings');

    controller.handleWebviewMessage({ type: 'request_config' }, 'chat');

    expect(chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'config_update' }),
    );
    expect(tree.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'config_update' }),
    );
    expect(settings.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'config_update' }),
    );

    controller.dispose();
  });

  it('stops broadcasting to a webview after its binding is disposed', () => {
    const controller = makeController();
    const chat = makeWebview();
    const tree = makeWebview();
    const treeMessageDisposable = { dispose: vi.fn() };
    tree.onDidReceiveMessage.mockReturnValue(treeMessageDisposable);

    controller.bindWebview(chat as never, 'chat');
    const treeBinding = controller.bindWebview(tree as never, 'tree');

    treeBinding.dispose();
    controller.handleWebviewMessage({ type: 'request_config' }, 'chat');

    expect(chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'config_update' }),
    );
    expect(tree.postMessage).not.toHaveBeenCalled();
    expect(treeMessageDisposable.dispose).toHaveBeenCalledTimes(1);

    controller.dispose();
  });
});
