// ============================================================
// Protocol Client — Webview → Extension 消息发送
// ============================================================

import type { ScoutTaskItem, ThinkingLevel, WebviewMessage } from '@scout-agent/shared';
import { getVsCodeApi } from './vscode-api';

interface UserMessageOptions {
  clearFollowUpQueue?: boolean;
}

interface ContinueSessionOptions {
  preserveFollowUpQueue?: boolean;
}

interface PromoteFollowUpOptions extends ContinueSessionOptions {
  resume?: boolean;
}

export function sendWebviewMessage(message: WebviewMessage): void {
  getVsCodeApi().postMessage(message);
}

export const protocolClient = {
  ready: () => sendWebviewMessage({ type: 'ready' }),
  requestState: () => sendWebviewMessage({ type: 'request_state' }),
  requestConfig: () => sendWebviewMessage({ type: 'request_config' }),
  requestTree: () => sendWebviewMessage({ type: 'request_tree' }),
  requestTasks: (limit?: number) => sendWebviewMessage({ type: 'request_tasks', limit }),
  searchTasks: (query: string, limit?: number, requestId?: string) =>
    sendWebviewMessage({ type: 'search_tasks', query, limit, requestId }),
  requestSessions: () => sendWebviewMessage({ type: 'request_sessions' }),
  openSettingsPanel: () => sendWebviewMessage({ type: 'open_settings_panel' }),
  openTreePanel: () => sendWebviewMessage({ type: 'open_tree_panel' }),
  openTask: (task: ScoutTaskItem) =>
    sendWebviewMessage({
      type: 'open_task',
      taskId: task.id,
      sessionPath: task.sessionPath,
      cwdOverride: task.cwd,
    }),
  userMessage: (text: string, deliverAs?: 'steer' | 'followUp', options?: UserMessageOptions) => {
    const message: WebviewMessage = { type: 'user_message', text, deliverAs };
    if (options?.clearFollowUpQueue) {
      message.clearFollowUpQueue = true;
    }
    sendWebviewMessage(message);
  },
  cancelFollowUp: (id: string) => sendWebviewMessage({ type: 'cancel_follow_up', id }),
  promoteFollowUp: (id: string, options?: PromoteFollowUpOptions) => {
    const message: WebviewMessage = { type: 'promote_follow_up', id };
    if (options?.resume) {
      message.resume = true;
    }
    if (options?.preserveFollowUpQueue) {
      message.preserveFollowUpQueue = true;
    }
    sendWebviewMessage(message);
  },
  abort: () => sendWebviewMessage({ type: 'abort' }),
  abortRetry: () => sendWebviewMessage({ type: 'abort_retry' }),
  compact: (customInstructions?: string) =>
    sendWebviewMessage({ type: 'compact', customInstructions }),
  continueSession: (options?: ContinueSessionOptions) => {
    const message: WebviewMessage = { type: 'continue_session' };
    if (options?.preserveFollowUpQueue) {
      message.preserveFollowUpQueue = true;
    }
    sendWebviewMessage(message);
  },
  clearConversation: () => sendWebviewMessage({ type: 'clear_conversation' }),
  selectModel: (provider: string, modelId: string) =>
    sendWebviewMessage({ type: 'select_model', provider, modelId }),
  selectThinking: (level: ThinkingLevel) => sendWebviewMessage({ type: 'select_thinking', level }),
  requestCommands: () => sendWebviewMessage({ type: 'request_commands' }),
  requestFileMentions: (query: string, limit?: number) =>
    sendWebviewMessage({ type: 'request_file_mentions', query, limit }),
};
