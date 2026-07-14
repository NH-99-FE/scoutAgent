// ============================================================
// Protocol Client — typed Webview → Extension 请求入口
// ============================================================

import type {
  ScoutComposerDocument,
  ScoutCustomModelsSaveSettings,
  ScoutExtensionScope,
  ScoutExtensionTemplateId,
  ScoutForkCandidate,
  ScoutProtocolResponsePayload,
  ScoutImageContent,
  ScoutRuntimeSettingsPatch,
  ScoutSkillScope,
  ScoutSkillToggleIntent,
  ScoutSettingsScope,
  ScoutTaskHistoryPurpose,
  ScoutTaskItem,
  ThinkingLevel,
  WebviewRequestPayload,
} from '@scout-agent/shared';
import { projectExtensionEvent } from './extension-event-projector';
import { resolveProtocolRoute } from './protocol-route';
import {
  projectBootstrapFailure,
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
  document?: ScoutComposerDocument;
  images?: ScoutImageContent[];
}

interface ContinueSessionOptions {
  preserveFollowUpQueue?: boolean;
}

interface RequestFileMentionsOptions {
  limit: number;
  onError?: (message: string) => void;
  onResult: (result: FileMentionsResultPayload) => void;
  query: string;
}

interface CancellableProtocolRequest {
  cancel: () => void;
}

interface NavigateTreeOptions {
  targetId: string;
  summarize: boolean;
  customInstructions?: string;
}

type LabelResultPayload = Extract<ScoutProtocolResponsePayload, { type: 'label_result' }>;
type SetSessionNameResultPayload = Extract<
  ScoutProtocolResponsePayload,
  { type: 'set_session_name_result' }
>;
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
type ExtensionsResultPayload = Extract<ScoutProtocolResponsePayload, { type: 'extensions_result' }>;
type SkillsResultPayload = Extract<ScoutProtocolResponsePayload, { type: 'skills_result' }>;
type SaveRuntimeSettingsResultPayload = Extract<
  ScoutProtocolResponsePayload,
  { type: 'save_runtime_settings_result' }
>;
type SaveSkillsSettingsResultPayload = Extract<
  ScoutProtocolResponsePayload,
  { type: 'save_skills_settings_result' }
>;
type CreateExtensionFromTemplateResultPayload = Extract<
  ScoutProtocolResponsePayload,
  { type: 'create_extension_from_template_result' }
>;
type OpenExtensionFileResultPayload = Extract<
  ScoutProtocolResponsePayload,
  { type: 'open_extension_file_result' }
>;
type OpenSkillFileResultPayload = Extract<
  ScoutProtocolResponsePayload,
  { type: 'open_skill_file_result' }
>;
type OpenMentionedFileResultPayload = Extract<
  ScoutProtocolResponsePayload,
  { type: 'open_mentioned_file_result' }
>;
type CopyTextResultPayload = Extract<ScoutProtocolResponsePayload, { type: 'copy_text_result' }>;
type DownloadImageResultPayload = Extract<
  ScoutProtocolResponsePayload,
  { type: 'download_image_result' }
>;
type ComposerContentPickResultPayload = Extract<
  ScoutProtocolResponsePayload,
  { type: 'composer_content_pick_result' }
>;
type FileMentionsResultPayload = Extract<
  ScoutProtocolResponsePayload,
  { type: 'file_mentions_result' }
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

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type ExtensionUIResponsePayload = DistributiveOmit<
  Extract<WebviewRequestPayload, { type: 'extension_ui_response' }>,
  'type'
>;

export const protocolClient = {
  ready: () =>
    sendRouted({ type: 'ready' }, projectProtocolResponsePayload, (message) => {
      projectBootstrapFailure(message);
    }),
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
  requestExtensions: (
    onResult?: (payload: ExtensionsResultPayload) => void,
    onError?: (message: string) => void,
  ) =>
    sendRouted(
      { type: 'request_extensions' },
      (payload) => {
        projectProtocolResponsePayload(payload);
        if (payload.type === 'extensions_result') onResult?.(payload);
      },
      (message) => {
        reportProtocolError(message);
        onError?.(message);
      },
    ),
  requestSkills: (
    onResult?: (payload: SkillsResultPayload) => void,
    onError?: (message: string) => void,
  ) =>
    sendRouted(
      { type: 'request_skills' },
      (payload) => {
        projectProtocolResponsePayload(payload);
        if (payload.type === 'skills_result') onResult?.(payload);
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
  setSessionName: (
    name: string,
    onResult?: (payload: SetSessionNameResultPayload) => void,
    onError?: (message: string) => void,
  ) =>
    sendRouted(
      { type: 'set_session_name', name },
      (payload) => {
        projectProtocolResponsePayload(payload);
        if (payload.type === 'set_session_name_result') onResult?.(payload);
      },
      (message) => {
        reportProtocolError(message);
        onError?.(message);
      },
    ),
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
  exportSession: () =>
    sendRouted({ type: 'export_session', format: 'jsonl' }, projectProtocolResponsePayload),
  openTreePanel: () => sendRouted({ type: 'open_tree_panel' }, projectProtocolResponsePayload),
  copyText: (
    text: string,
    onResult?: (payload: CopyTextResultPayload) => void,
    onError?: (message: string) => void,
  ) =>
    sendRouted(
      { type: 'copy_text', text },
      (payload) => {
        if (payload.type === 'copy_text_result') onResult?.(payload);
      },
      (message) => {
        reportProtocolError(message);
        onError?.(message);
      },
    ),
  downloadImage: (
    image: ScoutImageContent,
    fileName: string,
    onResult?: (payload: DownloadImageResultPayload) => void,
    onError?: (message: string) => void,
  ) =>
    sendRouted(
      { type: 'download_image', data: image.data, mimeType: image.mimeType, fileName },
      (payload) => {
        if (payload.type !== 'download_image_result') return;
        if (!payload.success && payload.error && payload.error !== 'cancelled') {
          reportProtocolError(payload.error);
        }
        onResult?.(payload);
      },
      (message) => {
        reportProtocolError(message);
        onError?.(message);
      },
    ),
  openChangesReview: (turnId: string, recordId?: string) => {
    const payload: WebviewRequestPayload = { type: 'open_changes_review', turnId };
    if (recordId) payload.recordId = recordId;
    return sendRouted(payload, projectProtocolResponsePayload);
  },
  openCurrentChangesReview: () =>
    sendRouted({ type: 'open_current_changes_review' }, projectProtocolResponsePayload),
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
    if (options?.document) payload.document = options.document;
    if (options?.clearFollowUpQueue) {
      payload.clearFollowUpQueue = true;
    }
    send(payload);
  },
  newSessionMessage: (
    text: string,
    images?: ScoutImageContent[],
    document?: ScoutComposerDocument,
    toolProfileId?: string,
  ) => {
    discardProtocolRequest(pendingOpenTaskRequestId);
    pendingOpenTaskRequestId = undefined;
    const payload: WebviewRequestPayload = { type: 'new_session_message', text };
    if (images && images.length > 0) {
      payload.images = images;
    }
    if (document) payload.document = document;
    if (toolProfileId) payload.toolProfileId = toolProfileId;
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
  saveSkillsSettings: (
    scope: ScoutSkillScope,
    entries: string[],
    toggles: ScoutSkillToggleIntent[],
    onResult?: (payload: SaveSkillsSettingsResultPayload) => void,
    onError?: (message: string) => void,
  ) =>
    sendRouted(
      { type: 'save_skills_settings', scope, entries, toggles },
      (payload) => {
        projectProtocolResponsePayload(payload);
        if (payload.type === 'save_skills_settings_result') onResult?.(payload);
      },
      (message) => {
        reportProtocolError(message);
        onError?.(message);
      },
    ),
  createExtensionFromTemplate: (
    templateId: ScoutExtensionTemplateId,
    scope: ScoutExtensionScope,
    onResult?: (payload: CreateExtensionFromTemplateResultPayload) => void,
    onError?: (message: string) => void,
  ) =>
    sendRouted(
      { type: 'create_extension_from_template', templateId, scope },
      (payload) => {
        projectProtocolResponsePayload(payload);
        if (payload.type === 'create_extension_from_template_result') onResult?.(payload);
      },
      (message) => {
        reportProtocolError(message);
        onError?.(message);
      },
    ),
  openExtensionFile: (
    path: string,
    onResult?: (payload: OpenExtensionFileResultPayload) => void,
    onError?: (message: string) => void,
  ) =>
    sendRouted(
      { type: 'open_extension_file', path },
      (payload) => {
        projectProtocolResponsePayload(payload);
        if (payload.type === 'open_extension_file_result') onResult?.(payload);
      },
      (message) => {
        reportProtocolError(message);
        onError?.(message);
      },
    ),
  openSkillFile: (
    path: string,
    onResult?: (payload: OpenSkillFileResultPayload) => void,
    onError?: (message: string) => void,
  ) =>
    sendRouted(
      { type: 'open_skill_file', path },
      (payload) => {
        projectProtocolResponsePayload(payload);
        if (payload.type === 'open_skill_file_result') onResult?.(payload);
      },
      (message) => {
        reportProtocolError(message);
        onError?.(message);
      },
    ),
  openMentionedFile: (
    path: string,
    onResult?: (payload: OpenMentionedFileResultPayload) => void,
    onError?: (message: string) => void,
  ) =>
    sendRouted(
      { type: 'open_mentioned_file', path },
      (payload) => {
        projectProtocolResponsePayload(payload);
        if (payload.type === 'open_mentioned_file_result') onResult?.(payload);
      },
      (message) => {
        reportProtocolError(message);
        onError?.(message);
      },
    ),
  selectThinking: (level: ThinkingLevel) => send({ type: 'select_thinking', level }),
  setToolProfile: (profileId: string) => send({ type: 'set_tool_profile', profileId }),
  requestCommands: () => sendRouted({ type: 'request_commands' }, projectProtocolResponsePayload),
  extensionUIResponse: (payload: ExtensionUIResponsePayload) =>
    send({ type: 'extension_ui_response', ...payload }),
  pickComposerContent: (
    selectionKind: 'file' | 'directory',
    onResult: (result: ComposerContentPickResultPayload) => void,
  ) =>
    sendRouted({ type: 'pick_composer_content', selectionKind }, (payload) => {
      if (payload.type === 'composer_content_pick_result') onResult(payload);
    }),
  requestFileMentions: ({ limit, onError, onResult, query }: RequestFileMentionsOptions) => {
    const requestId = sendRouted(
      { type: 'request_file_mentions', query, limit },
      (payload) => {
        if (payload.type === 'file_mentions_result') onResult(payload);
      },
      (message) => onError?.(message),
    );
    return {
      cancel: () => cancelProtocolRequest(requestId),
    } satisfies CancellableProtocolRequest;
  },
};

function createTaskHistoryQueryToken(): string {
  const random =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  return `history:${random}`;
}
