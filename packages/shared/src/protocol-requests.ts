// ============================================================
// Shared 协议请求契约：Webview 请求与路由表
// ============================================================

import type { ScoutCustomModelsSaveSettings, ThinkingLevel } from './models.ts';
import type { ScoutRuntimeSettingsPatch, ScoutSettingsScope } from './settings.ts';
import type { ScoutDomainEventType } from './protocol-events.ts';
import type { ScoutProtocolResponsePayloadType } from './protocol-results.ts';
import type { ScoutImageContent } from './protocol-state.ts';
import type {
  ScoutComposerDocument,
  ScoutTaskHistoryPurpose,
  ScoutWebviewSurface,
} from './protocol-core.ts';
import type { ScoutExtensionScope, ScoutExtensionTemplateId } from './protocol-extensions.ts';
import type { ScoutSkillScope, ScoutSkillToggleIntent } from './protocol-skills.ts';

// ---------- Webview 到 Extension ----------

export type ScoutProtocolService =
  | 'lifecycle'
  | 'state'
  | 'config'
  | 'session'
  | 'task'
  | 'tree'
  | 'mention'
  | 'extensions'
  | 'skills'
  | 'ui';

export type ScoutProtocolKind = 'lifecycle' | 'query' | 'command';

export interface ScoutProtocolRoute {
  kind: ScoutProtocolKind;
  service: ScoutProtocolService;
  method: string;
  response?: ScoutProtocolResponsePayloadType;
  emits?: readonly ScoutDomainEventType[];
  surfaces?: readonly ScoutWebviewSurface[];
}

export interface ScoutProtocolRequest<T = WebviewRequestPayload> {
  type: 'protocol_request';
  /**
   * Transport-only correlation id. 仅用于 webview-extension envelope
   * 响应匹配与取消，不属于业务 payload。
   */
  requestId: string;
  service: ScoutProtocolService;
  method: string;
  payload: T;
  streaming?: boolean;
}

export interface ScoutProtocolCancel {
  type: 'protocol_cancel';
  /** 取消对应 transport envelope，不取消某个业务实体。 */
  requestId: string;
}

export type ScoutControlMessage = { type: 'control_abort' } | { type: 'control_abort_retry' };

export type WebviewMessage = ScoutProtocolRequest | ScoutProtocolCancel | ScoutControlMessage;

export const WEBVIEW_TO_EXTENSION_MESSAGE_TYPES = [
  'protocol_request',
  'protocol_cancel',
  'control_abort',
  'control_abort_retry',
] as const satisfies readonly WebviewMessage['type'][];

export type WebviewRequestPayload =
  | { type: 'ready' }
  | { type: 'request_state' }
  | { type: 'request_config' }
  | { type: 'request_custom_models' }
  | { type: 'request_runtime_settings' }
  | { type: 'request_extensions' }
  | { type: 'request_skills' }
  | { type: 'request_context_usage' }
  | {
      type: 'user_message';
      text: string;
      document?: ScoutComposerDocument;
      images?: ScoutImageContent[];
      deliverAs?: 'steer' | 'followUp';
      clearFollowUpQueue?: boolean;
    }
  | {
      type: 'new_session_message';
      text: string;
      document?: ScoutComposerDocument;
      images?: ScoutImageContent[];
    }
  | { type: 'cancel_follow_up'; id: string }
  | {
      type: 'promote_follow_up';
      id: string;
      resume?: boolean;
      preserveFollowUpQueue?: boolean;
    }
  | { type: 'compact'; customInstructions?: string }
  | { type: 'select_model'; provider: string; modelId: string }
  | { type: 'set_default_model'; provider: string; modelId: string; scope: ScoutSettingsScope }
  | { type: 'save_custom_models'; settings: ScoutCustomModelsSaveSettings }
  | {
      type: 'save_runtime_settings';
      scope: ScoutSettingsScope;
      patch: ScoutRuntimeSettingsPatch;
    }
  | { type: 'select_thinking'; level: ThinkingLevel }
  | { type: 'set_active_tools'; toolNames: string[] }
  | { type: 'clear_conversation' }
  | { type: 'reload_resources' }
  | {
      type: 'create_extension_from_template';
      templateId: ScoutExtensionTemplateId;
      scope: ScoutExtensionScope;
      overwrite?: boolean;
    }
  | { type: 'open_extension_file'; path: string }
  | {
      type: 'save_skills_settings';
      scope: ScoutSkillScope;
      entries: string[];
      toggles?: ScoutSkillToggleIntent[];
    }
  | { type: 'open_skill_file'; path: string }
  | { type: 'open_settings_panel' }
  | { type: 'open_tree_panel' }
  | { type: 'copy_text'; text: string }
  | { type: 'download_image'; data: string; mimeType: string; fileName: string }
  | { type: 'open_changes_review'; turnId: string; recordId?: string }
  | { type: 'open_current_changes_review' }
  | { type: 'fork_session'; entryId: string; position: 'before' | 'at' }
  | { type: 'request_fork_candidates'; sessionId: string }
  | { type: 'request_tree' }
  | {
      type: 'navigate_tree';
      targetId: string;
      summarize: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    }
  | { type: 'set_label'; entryId: string; label?: string }
  | { type: 'set_session_name'; name: string }
  | { type: 'continue_session'; preserveFollowUpQueue?: boolean }
  | { type: 'request_commands' }
  | { type: 'extension_ui_response'; id: string; action: 'confirm' }
  | { type: 'extension_ui_response'; id: string; action: 'select'; value: string }
  | { type: 'extension_ui_response'; id: string; action: 'input'; value: string }
  | { type: 'extension_ui_response'; id: string; action: 'cancel' }
  | { type: 'pick_composer_content'; selectionKind: 'file' | 'directory' }
  | { type: 'request_file_mentions'; query: string; limit?: number }
  | { type: 'open_mentioned_file'; path: string }
  | {
      type: 'request_task_history';
      query: string;
      limit?: number;
      offset?: number;
      scope?: 'workspace' | 'all';
      purpose?: ScoutTaskHistoryPurpose;
    }
  | {
      type: 'open_task';
      taskId: string;
      sessionPath: string;
      cwdOverride?: string;
    }
  | { type: 'request_sessions' }
  | {
      type: 'restore_session';
      sessionId: string;
      sessionPath: string;
      cwdOverride?: string;
    }
  | { type: 'pick_import_session' }
  | { type: 'import_session'; sessionPath: string; cwdOverride?: string }
  | { type: 'delete_session'; sessionId: string; sessionPath: string }
  | { type: 'export_session'; format: 'jsonl'; outputPath?: string };

export const SCOUT_PROTOCOL = {
  ready: {
    kind: 'lifecycle',
    service: 'lifecycle',
    method: 'ready',
    response: 'bootstrap_result',
    surfaces: ['chat', 'settings', 'tree'],
  },
  request_state: {
    kind: 'query',
    service: 'state',
    method: 'request_state',
    response: 'state_result',
    surfaces: ['chat', 'settings', 'tree'],
  },
  request_config: {
    kind: 'query',
    service: 'config',
    method: 'request_config',
    response: 'config_result',
    surfaces: ['chat', 'settings', 'tree'],
  },
  request_custom_models: {
    kind: 'query',
    service: 'config',
    method: 'request_custom_models',
    response: 'custom_models_result',
    surfaces: ['settings'],
  },
  request_runtime_settings: {
    kind: 'query',
    service: 'config',
    method: 'request_runtime_settings',
    response: 'runtime_settings_result',
    surfaces: ['settings'],
  },
  request_extensions: {
    kind: 'query',
    service: 'extensions',
    method: 'request_extensions',
    response: 'extensions_result',
    surfaces: ['settings'],
  },
  request_skills: {
    kind: 'query',
    service: 'skills',
    method: 'request_skills',
    response: 'skills_result',
    surfaces: ['settings'],
  },
  request_context_usage: {
    kind: 'query',
    service: 'state',
    method: 'request_context_usage',
    response: 'context_usage_result',
    surfaces: ['chat'],
  },
  user_message: {
    kind: 'command',
    service: 'session',
    method: 'user_message',
    emits: [
      'state_update',
      'queue_update',
      'runtime_state_update',
      'agent_event',
      'tool_call_preview_update',
      'context_usage_update',
      'tree_update',
      'task_history_update',
    ],
    surfaces: ['chat'],
  },
  new_session_message: {
    kind: 'command',
    service: 'session',
    method: 'new_session_message',
    response: 'new_session_result',
    emits: [
      'state_update',
      'runtime_state_update',
      'agent_event',
      'tool_call_preview_update',
      'tree_update',
      'task_history_update',
      'sessions_update',
    ],
    surfaces: ['chat'],
  },
  cancel_follow_up: {
    kind: 'command',
    service: 'session',
    method: 'cancel_follow_up',
    emits: ['queue_update'],
    surfaces: ['chat'],
  },
  promote_follow_up: {
    kind: 'command',
    service: 'session',
    method: 'promote_follow_up',
    emits: [
      'state_update',
      'queue_update',
      'runtime_state_update',
      'agent_event',
      'tool_call_preview_update',
      'tree_update',
    ],
    surfaces: ['chat'],
  },
  compact: {
    kind: 'command',
    service: 'session',
    method: 'compact',
    emits: [
      'runtime_state_update',
      'compaction_start',
      'compaction_end',
      'state_update',
      'tree_update',
    ],
    surfaces: ['chat'],
  },
  select_model: {
    kind: 'command',
    service: 'config',
    method: 'select_model',
    emits: ['state_update', 'config_update'],
    surfaces: ['chat', 'settings'],
  },
  set_default_model: {
    kind: 'command',
    service: 'config',
    method: 'set_default_model',
    response: 'set_default_model_result',
    emits: ['state_update', 'config_update', 'tree_update'],
    surfaces: ['settings'],
  },
  save_custom_models: {
    kind: 'command',
    service: 'config',
    method: 'save_custom_models',
    response: 'save_custom_models_result',
    emits: ['config_update', 'commands_update', 'state_update', 'tree_update'],
    surfaces: ['settings'],
  },
  save_runtime_settings: {
    kind: 'command',
    service: 'config',
    method: 'save_runtime_settings',
    response: 'save_runtime_settings_result',
    emits: ['config_update', 'commands_update', 'state_update', 'tree_update'],
    surfaces: ['settings'],
  },
  select_thinking: {
    kind: 'command',
    service: 'config',
    method: 'select_thinking',
    emits: ['state_update'],
    surfaces: ['chat', 'settings'],
  },
  set_active_tools: {
    kind: 'command',
    service: 'config',
    method: 'set_active_tools',
    emits: ['state_update', 'config_update'],
    surfaces: ['chat', 'settings'],
  },
  clear_conversation: {
    kind: 'command',
    service: 'session',
    method: 'clear_conversation',
    emits: ['state_update', 'tree_update'],
    surfaces: ['chat'],
  },
  reload_resources: {
    kind: 'command',
    service: 'config',
    method: 'reload_resources',
    response: 'reload_result',
    emits: ['config_update', 'commands_update', 'state_update', 'tree_update'],
    surfaces: ['chat', 'settings'],
  },
  create_extension_from_template: {
    kind: 'command',
    service: 'extensions',
    method: 'create_extension_from_template',
    response: 'create_extension_from_template_result',
    emits: ['config_update', 'commands_update', 'state_update', 'tree_update'],
    surfaces: ['settings'],
  },
  open_extension_file: {
    kind: 'command',
    service: 'extensions',
    method: 'open_extension_file',
    response: 'open_extension_file_result',
    surfaces: ['settings'],
  },
  save_skills_settings: {
    kind: 'command',
    service: 'skills',
    method: 'save_skills_settings',
    response: 'save_skills_settings_result',
    emits: ['config_update', 'commands_update', 'state_update', 'tree_update'],
    surfaces: ['settings'],
  },
  open_skill_file: {
    kind: 'command',
    service: 'skills',
    method: 'open_skill_file',
    response: 'open_skill_file_result',
    surfaces: ['chat', 'settings'],
  },
  open_settings_panel: {
    kind: 'command',
    service: 'ui',
    method: 'open_settings_panel',
    response: 'open_settings_panel_result',
    surfaces: ['chat', 'tree'],
  },
  open_tree_panel: {
    kind: 'command',
    service: 'ui',
    method: 'open_tree_panel',
    response: 'open_tree_panel_result',
    surfaces: ['chat', 'settings'],
  },
  copy_text: {
    kind: 'command',
    service: 'ui',
    method: 'copy_text',
    response: 'copy_text_result',
    surfaces: ['chat', 'settings', 'tree'],
  },
  download_image: {
    kind: 'command',
    service: 'ui',
    method: 'download_image',
    response: 'download_image_result',
    surfaces: ['chat'],
  },
  open_changes_review: {
    kind: 'command',
    service: 'ui',
    method: 'open_changes_review',
    response: 'open_changes_review_result',
    surfaces: ['chat'],
  },
  open_current_changes_review: {
    kind: 'command',
    service: 'ui',
    method: 'open_current_changes_review',
    response: 'open_current_changes_review_result',
    surfaces: ['chat'],
  },
  fork_session: {
    kind: 'command',
    service: 'tree',
    method: 'fork_session',
    response: 'fork_result',
    emits: ['state_update', 'tree_update', 'sessions_update'],
    surfaces: ['chat', 'tree'],
  },
  request_fork_candidates: {
    kind: 'query',
    service: 'tree',
    method: 'request_fork_candidates',
    response: 'fork_candidates_result',
    surfaces: ['chat', 'tree'],
  },
  request_tree: {
    kind: 'query',
    service: 'tree',
    method: 'request_tree',
    response: 'tree_result',
    surfaces: ['chat', 'tree'],
  },
  navigate_tree: {
    kind: 'command',
    service: 'tree',
    method: 'navigate_tree',
    response: 'navigate_tree_result',
    emits: ['state_update', 'tree_update'],
    surfaces: ['tree'],
  },
  set_label: {
    kind: 'command',
    service: 'tree',
    method: 'set_label',
    response: 'label_result',
    emits: ['tree_update'],
    surfaces: ['tree'],
  },
  set_session_name: {
    kind: 'command',
    service: 'session',
    method: 'set_session_name',
    response: 'set_session_name_result',
    emits: ['sessions_update', 'state_update'],
    surfaces: ['chat', 'tree'],
  },
  continue_session: {
    kind: 'command',
    service: 'session',
    method: 'continue_session',
    emits: [
      'state_update',
      'queue_update',
      'runtime_state_update',
      'agent_event',
      'tool_call_preview_update',
      'tree_update',
    ],
    surfaces: ['chat'],
  },
  request_commands: {
    kind: 'query',
    service: 'ui',
    method: 'request_commands',
    response: 'commands_result',
    surfaces: ['chat', 'settings'],
  },
  extension_ui_response: {
    kind: 'command',
    service: 'ui',
    method: 'extension_ui_response',
    surfaces: ['chat', 'settings', 'tree'],
  },
  pick_composer_content: {
    kind: 'command',
    service: 'mention',
    method: 'pick_composer_content',
    response: 'composer_content_pick_result',
    surfaces: ['chat'],
  },
  request_file_mentions: {
    kind: 'query',
    service: 'mention',
    method: 'request_file_mentions',
    response: 'file_mentions_result',
    surfaces: ['chat'],
  },
  open_mentioned_file: {
    kind: 'command',
    service: 'mention',
    method: 'open_mentioned_file',
    response: 'open_mentioned_file_result',
    surfaces: ['chat'],
  },
  request_task_history: {
    kind: 'query',
    service: 'task',
    method: 'request_task_history',
    response: 'task_history_result',
    surfaces: ['chat'],
  },
  open_task: {
    kind: 'command',
    service: 'session',
    method: 'open_task',
    response: 'open_task_result',
    emits: ['state_update', 'tree_update', 'sessions_update'],
    surfaces: ['chat'],
  },
  request_sessions: {
    kind: 'query',
    service: 'session',
    method: 'request_sessions',
    response: 'sessions_result',
    surfaces: ['chat', 'tree'],
  },
  restore_session: {
    kind: 'command',
    service: 'session',
    method: 'restore_session',
    response: 'restore_session_result',
    emits: ['state_update', 'tree_update', 'sessions_update'],
    surfaces: ['chat', 'tree'],
  },
  pick_import_session: {
    kind: 'command',
    service: 'session',
    method: 'pick_import_session',
    response: 'import_session_result',
    emits: ['state_update', 'tree_update', 'sessions_update'],
    surfaces: ['chat'],
  },
  import_session: {
    kind: 'command',
    service: 'session',
    method: 'import_session',
    response: 'import_session_result',
    emits: ['state_update', 'tree_update', 'sessions_update'],
    surfaces: ['chat'],
  },
  delete_session: {
    kind: 'command',
    service: 'session',
    method: 'delete_session',
    response: 'delete_session_result',
    emits: ['sessions_update'],
    surfaces: ['chat'],
  },
  export_session: {
    kind: 'command',
    service: 'session',
    method: 'export_session',
    response: 'export_session_result',
    surfaces: ['chat'],
  },
} as const satisfies Record<WebviewRequestPayload['type'], ScoutProtocolRoute>;

export type ScoutProtocolPayloadType = WebviewRequestPayload['type'];
