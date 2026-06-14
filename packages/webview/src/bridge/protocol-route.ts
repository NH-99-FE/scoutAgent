// ============================================================
// Protocol Route — Webview payload 到 Extension service 的路由表
// ============================================================

import type { ScoutProtocolService, WebviewRequestPayload } from '@scout-agent/shared';

// ---------- 类型 ----------

export interface ProtocolRoute {
  service: ScoutProtocolService;
  method: string;
}

// ---------- 路由 ----------

const PAYLOAD_ROUTES = {
  ready: { service: 'lifecycle', method: 'ready' },
  request_state: { service: 'state', method: 'request_state' },
  request_config: { service: 'config', method: 'request_config' },
  request_context_usage: { service: 'state', method: 'request_context_usage' },
  user_message: { service: 'session', method: 'user_message' },
  new_session_message: { service: 'session', method: 'new_session_message' },
  cancel_follow_up: { service: 'session', method: 'cancel_follow_up' },
  promote_follow_up: { service: 'session', method: 'promote_follow_up' },
  abort: { service: 'session', method: 'abort' },
  abort_retry: { service: 'session', method: 'abort_retry' },
  compact: { service: 'session', method: 'compact' },
  select_model: { service: 'config', method: 'select_model' },
  select_thinking: { service: 'config', method: 'select_thinking' },
  set_active_tools: { service: 'config', method: 'set_active_tools' },
  clear_conversation: { service: 'session', method: 'clear_conversation' },
  reload_resources: { service: 'config', method: 'reload_resources' },
  open_settings_panel: { service: 'ui', method: 'open_settings_panel' },
  open_tree_panel: { service: 'ui', method: 'open_tree_panel' },
  fork_session: { service: 'tree', method: 'fork_session' },
  request_tree: { service: 'tree', method: 'request_tree' },
  navigate_tree: { service: 'tree', method: 'navigate_tree' },
  set_label: { service: 'tree', method: 'set_label' },
  set_session_name: { service: 'session', method: 'set_session_name' },
  continue_session: { service: 'session', method: 'continue_session' },
  request_commands: { service: 'ui', method: 'request_commands' },
  request_file_mentions: { service: 'mention', method: 'search' },
  request_task_history: { service: 'task', method: 'search' },
  open_task: { service: 'session', method: 'open_task' },
  request_sessions: { service: 'session', method: 'request_sessions' },
  restore_session: { service: 'session', method: 'restore_session' },
  pick_import_session: { service: 'session', method: 'pick_import_session' },
  import_session: { service: 'session', method: 'import_session' },
  delete_session: { service: 'session', method: 'delete_session' },
  export_session: { service: 'session', method: 'export_session' },
} satisfies Record<WebviewRequestPayload['type'], ProtocolRoute>;

export function resolveProtocolRoute(payload: WebviewRequestPayload): ProtocolRoute {
  return PAYLOAD_ROUTES[payload.type];
}
