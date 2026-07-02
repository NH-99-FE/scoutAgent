import { afterEach, describe, expect, it } from 'vitest';
import { getWebviewSurface } from '@/bridge/surface';

describe('getWebviewSurface', () => {
  afterEach(() => {
    window.__SCOUT_WEBVIEW_SURFACE__ = undefined;
    window.history.replaceState(null, '', '/');
  });

  it('uses the injected surface when extension host provides one', () => {
    window.__SCOUT_WEBVIEW_SURFACE__ = 'tree';

    expect(getWebviewSurface()).toBe('tree');
  });

  it('uses the injected changes review surface when extension host provides one', () => {
    window.__SCOUT_WEBVIEW_SURFACE__ = 'changes-review';

    expect(getWebviewSurface()).toBe('changes-review');
  });

  it('falls back to the dev-server query parameter', () => {
    window.history.replaceState(null, '', '/?surface=settings');

    expect(getWebviewSurface()).toBe('settings');
  });

  it('falls back to the dev-server changes review query parameter', () => {
    window.history.replaceState(null, '', '/?surface=changes-review');

    expect(getWebviewSurface()).toBe('changes-review');
  });

  it('defaults to chat', () => {
    expect(getWebviewSurface()).toBe('chat');
  });
});
