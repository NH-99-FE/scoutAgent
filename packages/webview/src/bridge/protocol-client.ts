// ============================================================
// Protocol Client — Webview → Extension 消息发送
// ============================================================

import type { ThinkingLevel, WebviewMessage } from '@scout-agent/shared';
import { getVsCodeApi } from './vscode-api';

export function sendWebviewMessage(message: WebviewMessage): void {
  getVsCodeApi().postMessage(message);
}

export const protocolClient = {
  ready: () => sendWebviewMessage({ type: 'ready' }),
  requestState: () => sendWebviewMessage({ type: 'request_state' }),
  requestConfig: () => sendWebviewMessage({ type: 'request_config' }),
  requestTree: () => sendWebviewMessage({ type: 'request_tree' }),
  requestTasks: (limit?: number) => sendWebviewMessage({ type: 'request_tasks', limit }),
  requestSessions: () => sendWebviewMessage({ type: 'request_sessions' }),
  openSettingsPanel: () => sendWebviewMessage({ type: 'open_settings_panel' }),
  openTreePanel: () => sendWebviewMessage({ type: 'open_tree_panel' }),
  abort: () => sendWebviewMessage({ type: 'abort' }),
  abortRetry: () => sendWebviewMessage({ type: 'abort_retry' }),
  continueSession: () => sendWebviewMessage({ type: 'continue_session' }),
  selectThinking: (level: ThinkingLevel) => sendWebviewMessage({ type: 'select_thinking', level }),
};
