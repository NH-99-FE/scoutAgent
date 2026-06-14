import { describe, expect, it, vi } from 'vitest';
import { WebviewSurfaceRegistry } from '../../src/host/webview-surface-registry.ts';

function makeWebview() {
  const listeners: Array<(message: unknown) => void> = [];
  const disposables: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
  return {
    listeners,
    webview: {
      onDidReceiveMessage: vi.fn((listener: (message: unknown) => void) => {
        listeners.push(listener);
        const disposable = {
          dispose: vi.fn(() => {
            const index = listeners.indexOf(listener);
            if (index >= 0) listeners.splice(index, 1);
          }),
        };
        disposables.push(disposable);
        return disposable;
      }),
      postMessage: vi.fn(),
    },
    disposables,
  };
}

describe('WebviewSurfaceRegistry', () => {
  it('routes incoming messages with the bound surface', () => {
    const onMessage = vi.fn();
    const webview = makeWebview();
    const registry = new WebviewSurfaceRegistry({ onMessage });

    registry.bindWebview(webview.webview as never, 'tree');
    webview.listeners[0]?.({ type: 'protocol_cancel', requestId: 'request-1' });

    expect(onMessage).toHaveBeenCalledWith(
      { type: 'protocol_cancel', requestId: 'request-1' },
      'tree',
    );
  });

  it('posts messages to a target surface or broadcasts to every bound webview', () => {
    const chat = makeWebview();
    const tree = makeWebview();
    const registry = new WebviewSurfaceRegistry({ onMessage: vi.fn() });
    registry.bindWebview(chat.webview as never, 'chat');
    registry.bindWebview(tree.webview as never, 'tree');

    registry.postMessage({ type: 'config_update', config: {} as never }, 'chat');
    registry.postMessage({ type: 'notification', level: 'info', message: 'hello' });

    expect(chat.webview.postMessage).toHaveBeenCalledWith({
      type: 'config_update',
      config: {},
    });
    expect(tree.webview.postMessage).not.toHaveBeenCalledWith({
      type: 'config_update',
      config: {},
    });
    expect(chat.webview.postMessage).toHaveBeenCalledWith({
      type: 'notification',
      level: 'info',
      message: 'hello',
    });
    expect(tree.webview.postMessage).toHaveBeenCalledWith({
      type: 'notification',
      level: 'info',
      message: 'hello',
    });
  });

  it('stops sending and receiving after binding disposal', () => {
    const onMessage = vi.fn();
    const webview = makeWebview();
    const registry = new WebviewSurfaceRegistry({ onMessage });
    const binding = registry.bindWebview(webview.webview as never, 'chat');

    binding.dispose();
    registry.postMessage({ type: 'notification', level: 'info', message: 'hello' }, 'chat');
    webview.listeners[0]?.({ type: 'protocol_cancel', requestId: 'request-1' });

    expect(webview.disposables[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(webview.webview.postMessage).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('disposes every listener when the registry is disposed', () => {
    const chat = makeWebview();
    const tree = makeWebview();
    const registry = new WebviewSurfaceRegistry({ onMessage: vi.fn() });
    registry.bindWebview(chat.webview as never, 'chat');
    registry.bindWebview(tree.webview as never, 'tree');

    registry.dispose();

    expect(chat.disposables[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(tree.disposables[0]?.dispose).toHaveBeenCalledTimes(1);
    registry.postMessage({ type: 'notification', level: 'info', message: 'hello' });
    expect(chat.webview.postMessage).not.toHaveBeenCalled();
    expect(tree.webview.postMessage).not.toHaveBeenCalled();
  });
});
