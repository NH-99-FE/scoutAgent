// ============================================================
// Protocol Client — typed Webview → Extension 请求入口
// ============================================================

import type {
  ScoutProtocolResponsePayload,
  ScoutImageContent,
  ScoutTaskHistoryPurpose,
  ScoutTaskItem,
  ThinkingLevel,
  WebviewRequestPayload,
} from '@scout-agent/shared';
import { projectExtensionEvent } from './extension-event-projector';
import { resolveProtocolRoute } from './protocol-route';
import {
  projectProtocolResponsePayload,
  projectTaskHistoryResult,
} from './protocol-response-projector';
import {
  cancelProtocolRequest,
  discardProtocolRequest,
  sendControlMessage,
  sendProtocolRequest,
  setDefaultProtocolErrorHandler,
} from './transport-client';

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
  queryToken?: string;
  limit?: number;
  offset?: number;
  scope?: 'workspace' | 'all';
  purpose?: ScoutTaskHistoryPurpose;
}

let pendingNewSessionRequestId: string | undefined;
let pendingOpenTaskRequestId: string | undefined;
let pendingPanelTaskHistoryRequestId: string | undefined;

function send(payload: WebviewRequestPayload): string {
  return sendProtocolRequest(payload, {
    ...resolveProtocolRoute(payload),
    onError: reportProtocolError,
  });
}

function sendRouted(
  payload: WebviewRequestPayload,
  onResponse: (payload: ScoutProtocolResponsePayload) => void,
  onError?: (message: string, code: string) => void,
): string {
  return sendProtocolRequest(payload, {
    ...resolveProtocolRoute(payload),
    onResponse,
    onError: (message, code) => {
      if (onError) {
        onError(message, code);
      } else {
        reportProtocolError(message);
      }
    },
  });
}

function reportProtocolError(message: string): void {
  projectExtensionEvent({ type: 'notification', level: 'error', message });
}

setDefaultProtocolErrorHandler(reportProtocolError);

function requestTaskHistory({
  query = '',
  queryToken,
  limit,
  offset,
  scope,
  purpose = 'panel',
}: RequestTaskHistoryOptions): string {
  const nextQueryToken = queryToken ?? createTaskHistoryQueryToken();
  const effectiveOffset = offset ?? 0;
  const payload: WebviewRequestPayload = {
    type: 'request_task_history',
    query,
    purpose,
  };
  if (limit !== undefined) payload.limit = limit;
  if (offset !== undefined) payload.offset = offset;
  if (scope !== undefined) payload.scope = scope;
  if (purpose === 'panel' && effectiveOffset === 0) {
    if (pendingPanelTaskHistoryRequestId) {
      cancelProtocolRequest(pendingPanelTaskHistoryRequestId);
    }
    pendingPanelTaskHistoryRequestId = undefined;
  }
  const requestId = sendProtocolRequest(payload, {
    ...resolveProtocolRoute(payload),
    onResponse: (response) => {
      if (pendingPanelTaskHistoryRequestId === requestId) {
        pendingPanelTaskHistoryRequestId = undefined;
      }
      if (response.type === 'task_history_result') {
        projectTaskHistoryResult(response, nextQueryToken);
      }
    },
    onError: (message) => {
      if (pendingPanelTaskHistoryRequestId === requestId) {
        pendingPanelTaskHistoryRequestId = undefined;
      }
      projectExtensionEvent({ type: 'notification', level: 'error', message });
    },
  });
  if (purpose === 'panel') {
    pendingPanelTaskHistoryRequestId = requestId;
  }
  return nextQueryToken;
}

export const protocolClient = {
  ready: () => sendRouted({ type: 'ready' }, projectProtocolResponsePayload),
  requestState: () => sendRouted({ type: 'request_state' }, projectProtocolResponsePayload),
  requestConfig: () => sendRouted({ type: 'request_config' }, projectProtocolResponsePayload),
  requestTree: () => sendRouted({ type: 'request_tree' }, projectProtocolResponsePayload),
  requestTasks: (limit?: number): string =>
    requestTaskHistory({
      query: '',
      limit,
      offset: 0,
      purpose: 'recent',
    }),
  requestTaskHistory,
  requestSessions: () => sendRouted({ type: 'request_sessions' }, projectProtocolResponsePayload),
  openSettingsPanel: () =>
    sendRouted({ type: 'open_settings_panel' }, projectProtocolResponsePayload),
  pickImportSession: () =>
    sendRouted({ type: 'pick_import_session' }, projectProtocolResponsePayload),
  openTreePanel: () => sendRouted({ type: 'open_tree_panel' }, projectProtocolResponsePayload),
  openTask: (task: ScoutTaskItem) => {
    discardProtocolRequest(pendingNewSessionRequestId);
    pendingNewSessionRequestId = undefined;
    pendingOpenTaskRequestId = sendRouted(
      {
        type: 'open_task',
        taskId: task.id,
        sessionPath: task.sessionPath,
        cwdOverride: task.cwd,
      },
      projectProtocolResponsePayload,
      (message) => {
        projectProtocolResponsePayload({
          type: 'open_task_result',
          sessionPath: task.sessionPath,
          success: false,
          error: message,
        });
      },
    );
  },
  userMessage: (text: string, deliverAs?: 'steer' | 'followUp', options?: UserMessageOptions) => {
    const payload: WebviewRequestPayload = { type: 'user_message', text, deliverAs };
    if (options?.images && options.images.length > 0) {
      payload.images = options.images;
    }
    if (options?.clearFollowUpQueue) {
      payload.clearFollowUpQueue = true;
    }
    send(payload);
  },
  newSessionMessage: (text: string, images?: ScoutImageContent[]) => {
    discardProtocolRequest(pendingOpenTaskRequestId);
    pendingOpenTaskRequestId = undefined;
    const payload: WebviewRequestPayload = { type: 'new_session_message', text };
    if (images && images.length > 0) {
      payload.images = images;
    }
    pendingNewSessionRequestId = sendRouted(payload, projectProtocolResponsePayload, (message) => {
      projectProtocolResponsePayload({
        type: 'new_session_result',
        success: false,
        error: message,
      });
    });
  },
  cancelFollowUp: (id: string) => send({ type: 'cancel_follow_up', id }),
  promoteFollowUp: (id: string, options?: PromoteFollowUpOptions) => {
    const payload: WebviewRequestPayload = { type: 'promote_follow_up', id };
    if (options?.resume) {
      payload.resume = true;
    }
    if (options?.preserveFollowUpQueue) {
      payload.preserveFollowUpQueue = true;
    }
    send(payload);
  },
  abort: () => sendControlMessage({ type: 'control_abort' }),
  abortRetry: () => sendControlMessage({ type: 'control_abort_retry' }),
  compact: (customInstructions?: string) => send({ type: 'compact', customInstructions }),
  continueSession: (options?: ContinueSessionOptions) => {
    const payload: WebviewRequestPayload = { type: 'continue_session' };
    if (options?.preserveFollowUpQueue) {
      payload.preserveFollowUpQueue = true;
    }
    send(payload);
  },
  clearConversation: () => send({ type: 'clear_conversation' }),
  selectModel: (provider: string, modelId: string) =>
    send({ type: 'select_model', provider, modelId }),
  selectThinking: (level: ThinkingLevel) => send({ type: 'select_thinking', level }),
  requestCommands: () => sendRouted({ type: 'request_commands' }, projectProtocolResponsePayload),
  requestFileMentions: (query: string, limit?: number) =>
    sendRouted({ type: 'request_file_mentions', query, limit }, projectProtocolResponsePayload),
};

function createTaskHistoryQueryToken(): string {
  const random =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  return `history:${random}`;
}
