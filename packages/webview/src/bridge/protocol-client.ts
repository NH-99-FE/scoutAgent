// ============================================================
// Protocol Client — Webview → Extension 消息发送
// ============================================================

import type {
  ScoutImageContent,
  ScoutTaskItem,
  ScoutTaskHistoryPurpose,
  ThinkingLevel,
  WebviewMessage,
} from '@scout-agent/shared';
import {
  beginProtocolRequest,
  createProtocolRequestId,
  discardProtocolRequest,
} from './request-tracker';
import { getVsCodeApi } from './vscode-api';

interface UserMessageOptions {
  clearFollowUpQueue?: boolean;
  images?: ScoutImageContent[];
}

interface ContinueSessionOptions {
  preserveFollowUpQueue?: boolean;
}

interface PromoteFollowUpOptions extends ContinueSessionOptions {
  resume?: boolean;
}

interface RequestTaskHistoryOptions {
  query?: string;
  requestId?: string;
  limit?: number;
  offset?: number;
  scope?: 'workspace' | 'all';
  purpose?: ScoutTaskHistoryPurpose;
}

export function sendWebviewMessage(message: WebviewMessage): void {
  getVsCodeApi().postMessage(message);
}

function requestTaskHistory({
  query = '',
  requestId,
  limit,
  offset,
  scope,
  purpose = 'panel',
}: RequestTaskHistoryOptions): string {
  const nextRequestId = requestId ?? createProtocolRequestId();
  const message: WebviewMessage = {
    type: 'request_task_history',
    query,
    requestId: nextRequestId,
    purpose,
  };
  if (limit !== undefined) message.limit = limit;
  if (offset !== undefined) message.offset = offset;
  if (scope !== undefined) message.scope = scope;
  sendWebviewMessage(message);
  return nextRequestId;
}

export const protocolClient = {
  ready: () => sendWebviewMessage({ type: 'ready' }),
  requestState: () => sendWebviewMessage({ type: 'request_state' }),
  requestConfig: () => sendWebviewMessage({ type: 'request_config' }),
  requestTree: () => sendWebviewMessage({ type: 'request_tree' }),
  requestTasks: (limit?: number): string =>
    requestTaskHistory({
      query: '',
      limit,
      offset: 0,
      purpose: 'recent',
    }),
  requestTaskHistory,
  requestSessions: () => sendWebviewMessage({ type: 'request_sessions' }),
  openSettingsPanel: () => sendWebviewMessage({ type: 'open_settings_panel' }),
  openTreePanel: () => sendWebviewMessage({ type: 'open_tree_panel' }),
  openTask: (task: ScoutTaskItem) => {
    discardProtocolRequest('new_session_message');
    const requestId = beginProtocolRequest('open_task');
    sendWebviewMessage({
      type: 'open_task',
      requestId,
      taskId: task.id,
      sessionPath: task.sessionPath,
      cwdOverride: task.cwd,
    });
  },
  userMessage: (text: string, deliverAs?: 'steer' | 'followUp', options?: UserMessageOptions) => {
    const message: WebviewMessage = { type: 'user_message', text, deliverAs };
    if (options?.images && options.images.length > 0) {
      message.images = options.images;
    }
    if (options?.clearFollowUpQueue) {
      message.clearFollowUpQueue = true;
    }
    sendWebviewMessage(message);
  },
  newSessionMessage: (text: string, images?: ScoutImageContent[]) => {
    discardProtocolRequest('open_task');
    const requestId = beginProtocolRequest('new_session_message');
    const message: WebviewMessage = { type: 'new_session_message', requestId, text };
    if (images && images.length > 0) {
      message.images = images;
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
