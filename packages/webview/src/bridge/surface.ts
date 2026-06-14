// ============================================================
// Webview Surface — 识别当前 Webview 容器
// ============================================================

import type { ScoutWebviewSurface } from '@scout-agent/shared';

export type WebviewSurface = ScoutWebviewSurface;

declare global {
  interface Window {
    __SCOUT_WEBVIEW_SURFACE__?: WebviewSurface;
  }
}

export function getWebviewSurface(): WebviewSurface {
  const injected = window.__SCOUT_WEBVIEW_SURFACE__;
  if (injected === 'chat' || injected === 'settings' || injected === 'tree') {
    return injected;
  }

  const query = new URLSearchParams(window.location.search).get('surface');
  if (query === 'settings' || query === 'tree') return query;
  return 'chat';
}
