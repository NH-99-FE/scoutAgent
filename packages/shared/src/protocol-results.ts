// ============================================================
// Shared 协议结果契约：请求响应 payload
// ============================================================

import type { ScoutCustomModelsSettings } from './models.ts';
import type { ScoutExtensionsSettings } from './protocol-extensions.ts';
import type { ScoutRuntimeSettingsState } from './settings.ts';
import type {
  ScoutCommandInfo,
  ScoutFileMentionItem,
  ScoutSessionListItem,
  ScoutSessionTreeNode,
  ScoutTaskHistoryPurpose,
  ScoutTaskItem,
  ScoutWebviewSurface,
} from './protocol-core.ts';
import type { ScoutConfig, ScoutContextUsage, ScoutWebviewState } from './protocol-state.ts';

// ---------- 请求级协议结果 ----------

export interface ScoutBootstrapResult {
  type: 'bootstrap_result';
  surface: ScoutWebviewSurface;
  config: ScoutConfig;
  state: ScoutWebviewState;
  commands: ScoutCommandInfo[];
  sessions?: ScoutSessionListItem[];
  recentTasks?: ScoutTaskItem[];
  tree?: {
    nodes: ScoutSessionTreeNode[];
    leafId: string | null;
  };
}

export interface ScoutStateResult {
  type: 'state_result';
  state: ScoutWebviewState;
}

export interface ScoutConfigResult {
  type: 'config_result';
  config: ScoutConfig;
}

export interface ScoutCustomModelsResult {
  type: 'custom_models_result';
  settings: ScoutCustomModelsSettings;
}

export interface ScoutRuntimeSettingsResult {
  type: 'runtime_settings_result';
  settings: ScoutRuntimeSettingsState;
}

export interface ScoutExtensionsResult {
  type: 'extensions_result';
  settings: ScoutExtensionsSettings;
}

export interface ScoutContextUsageResult {
  type: 'context_usage_result';
  contextUsage?: ScoutContextUsage;
}

export interface ScoutCommandsResult {
  type: 'commands_result';
  commands: ScoutCommandInfo[];
}

export interface ScoutTreeResult {
  type: 'tree_result';
  tree: ScoutSessionTreeNode[];
  leafId: string | null;
}

export interface ScoutSessionsResult {
  type: 'sessions_result';
  sessions: ScoutSessionListItem[];
}

export interface ScoutFileMentionsResult {
  type: 'file_mentions_result';
  query: string;
  items: ScoutFileMentionItem[];
}

export interface ScoutTaskHistoryResult {
  type: 'task_history_result';
  query: string;
  purpose?: ScoutTaskHistoryPurpose;
  tasks: ScoutTaskItem[];
  offset: number;
  hasMore: boolean;
  nextOffset: number;
}

export type ScoutGenericCommandResultType =
  | 'new_session_result'
  | 'open_task_result'
  | 'open_settings_panel_result'
  | 'open_tree_panel_result'
  | 'open_changes_review_result'
  | 'open_current_changes_review_result'
  | 'restore_session_result'
  | 'import_session_result'
  | 'export_session_result'
  | 'navigate_tree_result'
  | 'label_result'
  | 'set_session_name_result'
  | 'set_default_model_result'
  | 'create_extension_from_template_result'
  | 'open_extension_file_result'
  | 'reload_result'
  | 'delete_session_result';

interface ScoutCommandResultBase {
  success: boolean;
  error?: string;
  sessionPath?: string;
  path?: string;
  editorText?: string;
}

export type ScoutGenericCommandResult = {
  [TType in ScoutGenericCommandResultType]: ScoutCommandResultBase & { type: TType };
}[ScoutGenericCommandResultType];

export interface ScoutSaveCustomModelsResult extends ScoutCommandResultBase {
  type: 'save_custom_models_result';
  settings?: ScoutCustomModelsSettings;
}

export interface ScoutSaveRuntimeSettingsResult extends ScoutCommandResultBase {
  type: 'save_runtime_settings_result';
  settings?: ScoutRuntimeSettingsState;
}

export interface ScoutForkResult {
  type: 'fork_result';
  success: boolean;
  error?: string;
  // fork_result 专用：目标会话与被选中的用户消息文本，用于回填到新会话 composer
  targetSessionId?: string;
  selectedText?: string;
}

export type ScoutCommandResult =
  | ScoutGenericCommandResult
  | ScoutSaveCustomModelsResult
  | ScoutSaveRuntimeSettingsResult
  | ScoutForkResult;

// fork 候选：从当前 session raw entries 中提取的全部历史 user message。
// 数据源为完整分支（root→leaf），不受压缩展示投影影响。
export interface ScoutForkCandidate {
  entryId: string;
  text: string;
}

export interface ScoutForkCandidatesResult {
  type: 'fork_candidates_result';
  sessionId: string;
  candidates: ScoutForkCandidate[];
}

export type ScoutProtocolResponsePayload =
  | ScoutBootstrapResult
  | ScoutStateResult
  | ScoutConfigResult
  | ScoutCustomModelsResult
  | ScoutRuntimeSettingsResult
  | ScoutExtensionsResult
  | ScoutContextUsageResult
  | ScoutCommandsResult
  | ScoutTreeResult
  | ScoutSessionsResult
  | ScoutFileMentionsResult
  | ScoutTaskHistoryResult
  | ScoutForkCandidatesResult
  | ScoutCommandResult;

export type ScoutProtocolResponsePayloadType = ScoutProtocolResponsePayload['type'];
