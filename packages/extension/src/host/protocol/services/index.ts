// ============================================================
// Protocol services — Webview protocol service 注册入口
// ============================================================

import type { WebviewRequestPayload } from '@scout-agent/shared';
import type { ProtocolServer } from '../protocol-server.ts';
import type {
  ConfigProtocolHost,
  LifecycleProtocolHost,
  MentionProtocolHost,
  ProtocolPayload,
  SessionProtocolHost,
  StateProtocolHost,
  TaskProtocolHost,
  TreeProtocolHost,
  UiProtocolHost,
} from './types.ts';
import { registerProtocolServiceHandlers } from './types.ts';

// ---------- 类型 ----------

export type { ProtocolResponder } from './types.ts';

export interface ScoutProtocolServices {
  lifecycle: LifecycleProtocolHost;
  state: StateProtocolHost;
  config: ConfigProtocolHost;
  session: SessionProtocolHost;
  task: TaskProtocolHost;
  tree: TreeProtocolHost;
  mention: MentionProtocolHost;
  ui: UiProtocolHost;
}

// ---------- 注册 ----------

export function registerScoutProtocolServices(
  server: ProtocolServer,
  services: ScoutProtocolServices,
): void {
  registerProtocolServiceHandlers(server, 'lifecycle', {
    ready: async (_message, context) => {
      await services.lifecycle.ready(context.surface, context.respond);
    },
  });

  registerProtocolServiceHandlers(server, 'state', {
    request_state: async (_message, context) => {
      await services.state.requestState(context.respond);
    },
    request_context_usage: async (_message, context) => {
      await services.state.requestContextUsage(context.respond);
    },
  });

  registerProtocolServiceHandlers(server, 'config', {
    request_config: (_message, context) => {
      services.config.requestConfig(context.respond);
    },
    request_custom_models: (_message, context) => {
      services.config.requestCustomModels(context.respond);
    },
    request_runtime_settings: (_message, context) => {
      services.config.requestRuntimeSettings(context.respond);
    },
    select_model: async (message) => {
      await services.config.setModel(payload<'select_model'>(message));
    },
    set_default_model: async (message, context) => {
      await services.config.setDefaultModel(payload<'set_default_model'>(message), context.respond);
    },
    save_custom_models: async (message, context) => {
      await services.config.saveCustomModels(
        payload<'save_custom_models'>(message),
        context.respond,
      );
    },
    save_runtime_settings: async (message, context) => {
      await services.config.saveRuntimeSettings(
        payload<'save_runtime_settings'>(message),
        context.respond,
      );
    },
    select_thinking: async (message) => {
      await services.config.setThinkingLevel(payload<'select_thinking'>(message));
    },
    set_active_tools: (message) => {
      services.config.setActiveTools(payload<'set_active_tools'>(message));
    },
    reload_resources: async (_message, context) => {
      await services.config.reloadResources(context.respond);
    },
  });

  registerProtocolServiceHandlers(server, 'session', {
    user_message: async (message) => {
      await services.session.userMessage(payload<'user_message'>(message));
    },
    new_session_message: async (message, context) => {
      await services.session.newSessionMessage(
        payload<'new_session_message'>(message),
        context.respond,
      );
    },
    cancel_follow_up: (message) => {
      services.session.cancelFollowUp(payload<'cancel_follow_up'>(message));
    },
    promote_follow_up: async (message) => {
      await services.session.promoteFollowUp(payload<'promote_follow_up'>(message));
    },
    compact: async (message) => {
      await services.session.compact(payload<'compact'>(message));
    },
    continue_session: async (message) => {
      await services.session.continueSession(payload<'continue_session'>(message));
    },
    clear_conversation: () => {
      services.session.clearConversation();
    },
    request_sessions: async (_message, context) => {
      await services.session.requestSessions(context.respond);
    },
    open_task: async (message, context) => {
      await services.session.openTask(payload<'open_task'>(message), context.respond);
    },
    restore_session: async (message, context) => {
      await services.session.restoreSession(payload<'restore_session'>(message), context.respond);
    },
    pick_import_session: async (_message, context) => {
      await services.session.pickImportSession(context.respond);
    },
    import_session: async (message, context) => {
      await services.session.importSession(payload<'import_session'>(message), context.respond);
    },
    delete_session: async (message, context) => {
      await services.session.deleteSession(payload<'delete_session'>(message), context.respond);
    },
    export_session: (message, context) => {
      services.session.exportSession(payload<'export_session'>(message), context.respond);
    },
    set_session_name: async (message, context) => {
      await services.session.setSessionName(payload<'set_session_name'>(message), context.respond);
    },
  });

  registerProtocolServiceHandlers(server, 'task', {
    request_task_history: async (message, context) => {
      await services.task.requestTaskHistory(
        payload<'request_task_history'>(message),
        context.respond,
      );
    },
  });

  registerProtocolServiceHandlers(server, 'tree', {
    fork_session: async (message, context) => {
      await services.tree.forkSession(payload<'fork_session'>(message), context.respond);
    },
    request_fork_candidates: async (message, context) => {
      await services.tree.requestForkCandidates(
        payload<'request_fork_candidates'>(message),
        context.respond,
      );
    },
    request_tree: async (_message, context) => {
      await services.tree.requestTree(context.respond);
    },
    navigate_tree: async (message, context) => {
      await services.tree.navigateTree(payload<'navigate_tree'>(message), context.respond);
    },
    set_label: async (message, context) => {
      await services.tree.setLabel(payload<'set_label'>(message), context.respond);
    },
  });

  registerProtocolServiceHandlers(server, 'mention', {
    request_file_mentions: async (message, context) => {
      await services.mention.requestFileMentions(
        payload<'request_file_mentions'>(message),
        context.respond,
      );
    },
  });

  registerProtocolServiceHandlers(server, 'ui', {
    request_commands: (_message, context) => {
      services.ui.requestCommands(context.respond);
    },
    open_settings_panel: async (_message, context) => {
      await services.ui.openSettingsPanel(context.respond);
    },
    open_tree_panel: async (_message, context) => {
      await services.ui.openTreePanel(context.respond);
    },
  });
}

function payload<TType extends WebviewRequestPayload['type']>(
  message: WebviewRequestPayload,
): ProtocolPayload<TType> {
  return message as ProtocolPayload<TType>;
}
