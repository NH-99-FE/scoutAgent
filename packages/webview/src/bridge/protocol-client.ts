// ============================================================
// Protocol Client — typed Webview → Extension 请求入口
// ============================================================

import type {
  ScoutCustomModelsSaveSettings,
  ScoutForkCandidate,
  ScoutProtocolResponsePayload,
  ScoutImageContent,
  ScoutRuntimeSettingsPatch,
  ScoutSettingsScope,
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

interface NavigateTreeOptions {
  targetId: string;
  summarize: boolean;
  customInstructions?: string;
}

type LabelResultPayload = Extract<ScoutProtocolResponsePayload, { type: 'label_result' }>;
type SetDefaultModelResultPayload = Extract<
  ScoutProtocolResponsePayload,
  { type: 'set_default_model_result' }
>;
type CustomModelsResultPayload = Extract<
  ScoutProtocolResponsePayload,
  { type: 'custom_models_result' }
>;
type SaveCustomModelsResultPayload = Extract<
  ScoutProtocolResponsePayload,
  { type: 'save_custom_models_result' }
>;
type RuntimeSettingsResultPayload = Extract<
  ScoutProtocolResponsePayload,
  { type: 'runtime_settings_result' }
>;
type SaveRuntimeSettingsResultPayload = Extract<
  ScoutProtocolResponsePayload,
  { type: 'save_runtime_settings_result' }
>;

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

type OpenSessionPayload = Extract<WebviewRequestPayload, { type: 'open_task' | 'restore_session' }>;
type OpenSessionFailureType = 'open_task_result' | 'restore_session_result';

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

function openSessionByPath(payload: OpenSessionPayload, failureType: OpenSessionFailureType): void {
  discardProtocolRequest(pendingNewSessionRequestId);
  pendingNewSessionRequestId = undefined;
  discardProtocolRequest(pendingOpenTaskRequestId);
  pendingOpenTaskRequestId = undefined;

  let requestId = '';
  requestId = sendRouted(
    payload,
    (response) => {
      if (pendingOpenTaskRequestId === requestId) {
        pendingOpenTaskRequestId = undefined;
      }
      projectProtocolResponsePayload(response);
    },
    (message) => {
      if (pendingOpenTaskRequestId === requestId) {
        pendingOpenTaskRequestId = undefined;
      }
      projectProtocolResponsePayload({
        type: failureType,
        sessionPath: payload.sessionPath,
        success: false,
        error: message,
      });
    },
  );
  pendingOpenTaskRequestId = requestId;
}

export const protocolClient = {
  ready: () => sendRouted({ type: 'ready' }, projectProtocolResponsePayload),
  requestState: () => sendRouted({ type: 'request_state' }, projectProtocolResponsePayload),
  requestConfig: () => sendRouted({ type: 'request_config' }, projectProtocolResponsePayload),
  requestCustomModels: (
    onResult?: (payload: CustomModelsResultPayload) => void,
    onError?: (message: string) => void,
  ) =>
    sendRouted(
      { type: 'request_custom_models' },
      (payload) => {
        projectProtocolResponsePayload(payload);
        if (payload.type === 'custom_models_result') onResult?.(payload);
      },
      (message) => {
        reportProtocolError(message);
        onError?.(message);
      },
    ),
  requestRuntimeSettings: (
    onResult?: (payload: RuntimeSettingsResultPayload) => void,
    onError?: (message: string) => void,
  ) =>
    sendRouted(
      { type: 'request_runtime_settings' },
      (payload) => {
        projectProtocolResponsePayload(payload);
        if (payload.type === 'runtime_settings_result') onResult?.(payload);
      },
      (message) => {
        reportProtocolError(message);
        onError?.(message);
      },
    ),
  requestTree: () => sendRouted({ type: 'request_tree' }, projectProtocolResponsePayload),
  navigateTree: ({ targetId, summarize, customInstructions }: NavigateTreeOptions) => {
    const payload: WebviewRequestPayload = { type: 'navigate_tree', targetId, summarize };
    if (customInstructions) payload.customInstructions = customInstructions;
    return sendRouted(payload, projectProtocolResponsePayload);
  },
  setLabel: (entryId: string, label?: string, onResult?: (payload: LabelResultPayload) => void) =>
    sendRouted({ type: 'set_label', entryId, label }, (payload) => {
      projectProtocolResponsePayload(payload);
      if (payload.type === 'label_result') onResult?.(payload);
    }),
  forkSession: (entryId: string) =>
    sendRouted(
      { type: 'fork_session', entryId, position: 'before' },
      projectProtocolResponsePayload,
    ),
  requestForkCandidates: (
    sessionId: string,
    onResult: (candidates: ScoutForkCandidate[], responseSessionId: string) => void,
  ) =>
    sendRouted({ type: 'request_fork_candidates', sessionId }, (payload) => {
      if (payload.type === 'fork_candidates_result') {
        onResult(payload.candidates, payload.sessionId);
      }
    }),
  requestTasks: (limit?: number): string =>
    requestTaskHistory({
      query: '',
      limit,
      offset: 0,
      purpose: 'recent',
    }),
  requestTaskHistory,
  requestSessions: () => sendRouted({ type: 'request_sessions' }, projectProtocolResponsePayload),
  restoreSession: (sessionPath: string) =>
    openSessionByPath(
      { type: 'restore_session', sessionId: '', sessionPath },
      'restore_session_result',
    ),
  openSettingsPanel: () =>
    sendRouted({ type: 'open_settings_panel' }, projectProtocolResponsePayload),
  pickImportSession: () =>
    sendRouted({ type: 'pick_import_session' }, projectProtocolResponsePayload),
  openTreePanel: () => sendRouted({ type: 'open_tree_panel' }, projectProtocolResponsePayload),
  openTask: (task: ScoutTaskItem) => {
    openSessionByPath(
      {
        type: 'open_task',
        taskId: task.id,
        sessionPath: task.sessionPath,
        cwdOverride: task.cwd,
      },
      'open_task_result',
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
  setDefaultModel: (
    provider: string,
    modelId: string,
    scope: ScoutSettingsScope,
    onResult?: (payload: SetDefaultModelResultPayload) => void,
  ) =>
    sendRouted({ type: 'set_default_model', provider, modelId, scope }, (payload) => {
      projectProtocolResponsePayload(payload);
      if (payload.type === 'set_default_model_result') onResult?.(payload);
    }),
  saveCustomModels: (
    settings: ScoutCustomModelsSaveSettings,
    onResult?: (payload: SaveCustomModelsResultPayload) => void,
    onError?: (message: string) => void,
  ) =>
    sendRouted(
      { type: 'save_custom_models', settings },
      (payload) => {
        projectProtocolResponsePayload(payload);
        if (payload.type === 'save_custom_models_result') onResult?.(payload);
      },
      (message) => {
        reportProtocolError(message);
        onError?.(message);
      },
    ),
  saveRuntimeSettings: (
    scope: ScoutSettingsScope,
    patch: ScoutRuntimeSettingsPatch,
    onResult?: (payload: SaveRuntimeSettingsResultPayload) => void,
    onError?: (message: string) => void,
  ) =>
    sendRouted(
      { type: 'save_runtime_settings', scope, patch },
      (payload) => {
        projectProtocolResponsePayload(payload);
        if (payload.type === 'save_runtime_settings_result') onResult?.(payload);
      },
      (message) => {
        reportProtocolError(message);
        onError?.(message);
      },
    ),
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
