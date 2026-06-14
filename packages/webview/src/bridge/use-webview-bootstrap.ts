// ============================================================
// Webview Bootstrap — 注册协议路由并发送启动请求
// ============================================================

import { useEffect } from 'react';
import { protocolClient } from './protocol-client';
import { getWebviewSurface, type WebviewSurface } from './surface';
import { startExtensionMessageRouter } from './extension-message-router';
import { startWebviewThemeSync } from './theme';
import { useUiStore } from '@/store/ui-store';

export function useWebviewBootstrap(): WebviewSurface {
  const surface = getWebviewSurface();

  useEffect(() => {
    useUiStore.getState().actions.setSurface(surface);
    const stopThemeSync = startWebviewThemeSync();
    const stopRouter = startExtensionMessageRouter();
    protocolClient.ready();

    if (surface === 'chat') {
      protocolClient.requestTasks(3);
      protocolClient.requestSessions();
    }
    if (surface === 'settings') {
      protocolClient.requestConfig();
      protocolClient.requestState();
    }
    if (surface === 'tree') {
      protocolClient.requestTree();
    }

    return () => {
      stopRouter();
      stopThemeSync();
    };
  }, [surface]);

  return surface;
}
