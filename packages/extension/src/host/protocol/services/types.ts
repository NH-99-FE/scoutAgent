// ============================================================
// Protocol service types — Webview protocol services 共享类型
// 负责：为各 service 注册文件提供统一 payload/host 类型。
// ============================================================

import {
  SCOUT_PROTOCOL,
  type ScoutProtocolService,
  type WebviewRequestPayload,
} from '@scout-agent/shared';
import type { ScoutWebviewSurface } from '../../webview-surface.ts';
import type { ProtocolHandlerContext, ProtocolServer } from '../protocol-server.ts';

// ---------- 通用类型 ----------

export type ProtocolPayload<TType extends WebviewRequestPayload['type']> = Extract<
  WebviewRequestPayload,
  { type: TType }
>;

export type ProtocolResponder = ProtocolHandlerContext['respond'];

export type ProtocolHandlerFor<TType extends WebviewRequestPayload['type']> = (
  message: ProtocolPayload<TType>,
  context: ProtocolHandlerContext,
) => void | Promise<void>;

export type ProtocolServiceHandlerMap = Partial<
  Record<WebviewRequestPayload['type'], ProtocolHandlerFor<WebviewRequestPayload['type']>>
>;

// ---------- 注册辅助 ----------

export function registerProtocolServiceHandlers(
  server: ProtocolServer,
  service: ScoutProtocolService,
  handlers: ProtocolServiceHandlerMap,
): void {
  for (const [payloadType, route] of Object.entries(SCOUT_PROTOCOL) as Array<
    [WebviewRequestPayload['type'], (typeof SCOUT_PROTOCOL)[WebviewRequestPayload['type']]]
  >) {
    if (route.service !== service) continue;

    const handler = handlers[payloadType];
    if (!handler) {
      throw new Error(`Missing protocol handler: ${service}.${route.method} for ${payloadType}`);
    }
    server.register(
      { service: route.service, method: route.method, payloadType },
      async (context) => {
        await handler(context.payload as ProtocolPayload<typeof payloadType>, context);
      },
    );
  }
}

// ---------- Host 能力 ----------

export interface LifecycleProtocolHost {
  ready: (surface: ScoutWebviewSurface, respond: ProtocolResponder) => Promise<void>;
}

export interface StateProtocolHost {
  pushState: (surface?: ScoutWebviewSurface) => Promise<void>;
  requestState: (respond: ProtocolResponder) => Promise<void>;
  requestContextUsage: (respond: ProtocolResponder) => Promise<void>;
}

export interface ConfigProtocolHost {
  pushConfig: (surface?: ScoutWebviewSurface) => void;
  requestConfig: (respond: ProtocolResponder) => void;
  requestCustomModels: (respond: ProtocolResponder) => void;
  requestRuntimeSettings: (respond: ProtocolResponder) => void;
  setModel: (message: ProtocolPayload<'select_model'>) => Promise<void>;
  setDefaultModel: (
    message: ProtocolPayload<'set_default_model'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
  saveCustomModels: (
    message: ProtocolPayload<'save_custom_models'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
  saveRuntimeSettings: (
    message: ProtocolPayload<'save_runtime_settings'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
  setThinkingLevel: (message: ProtocolPayload<'select_thinking'>) => Promise<void>;
  setToolProfile: (message: ProtocolPayload<'set_tool_profile'>) => void;
  reloadResources: (respond: ProtocolResponder) => Promise<void>;
}

export interface SessionProtocolHost {
  userMessage: (
    message: ProtocolPayload<'user_message'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
  acknowledgeComposerIntent: (
    message: ProtocolPayload<'ack_composer_intent'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
  newSessionMessage: (
    message: ProtocolPayload<'new_session_message'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
  cancelFollowUp: (message: ProtocolPayload<'cancel_follow_up'>) => void;
  promoteFollowUp: (message: ProtocolPayload<'promote_follow_up'>) => Promise<void>;
  compact: (message: ProtocolPayload<'compact'>) => Promise<void>;
  continueSession: (message: ProtocolPayload<'continue_session'>) => Promise<void>;
  clearConversation: (message: ProtocolPayload<'clear_conversation'>) => Promise<void>;
  requestSessions: (respond: ProtocolResponder) => Promise<void>;
  openTask: (message: ProtocolPayload<'open_task'>, respond: ProtocolResponder) => Promise<void>;
  restoreSession: (
    message: ProtocolPayload<'restore_session'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
  pickImportSession: (respond: ProtocolResponder) => Promise<void>;
  importSession: (
    message: ProtocolPayload<'import_session'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
  deleteSession: (
    message: ProtocolPayload<'delete_session'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
  exportSession: (
    message: ProtocolPayload<'export_session'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
  setSessionName: (
    message: ProtocolPayload<'set_session_name'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
}

export interface TaskProtocolHost {
  requestTaskHistory: (
    message: ProtocolPayload<'request_task_history'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
}

export interface TreeProtocolHost {
  forkSession: (
    message: ProtocolPayload<'fork_session'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
  requestTree: (respond: ProtocolResponder) => Promise<void>;
  requestForkCandidates: (
    message: ProtocolPayload<'request_fork_candidates'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
  navigateTree: (
    message: ProtocolPayload<'navigate_tree'>,
    respond: ProtocolResponder,
    signal?: AbortSignal,
  ) => Promise<void>;
  abortTreeNavigation: (
    message: ProtocolPayload<'abort_tree_navigation'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
  setLabel: (message: ProtocolPayload<'set_label'>, respond: ProtocolResponder) => Promise<void>;
}

export interface MentionProtocolHost {
  pickComposerContent: (
    message: ProtocolPayload<'pick_composer_content'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
  requestFileMentions: (
    message: ProtocolPayload<'request_file_mentions'>,
    respond: ProtocolResponder,
    signal: AbortSignal,
  ) => Promise<void>;
  openMentionedFile: (
    message: ProtocolPayload<'open_mentioned_file'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
}

export interface ExtensionManagementProtocolHost {
  requestExtensions: (respond: ProtocolResponder) => Promise<void>;
  createExtensionFromTemplate: (
    message: ProtocolPayload<'create_extension_from_template'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
  openExtensionFile: (
    message: ProtocolPayload<'open_extension_file'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
}

export interface SkillManagementProtocolHost {
  requestSkills: (respond: ProtocolResponder) => Promise<void>;
  saveSkillsSettings: (
    message: ProtocolPayload<'save_skills_settings'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
  openSkillFile: (
    message: ProtocolPayload<'open_skill_file'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
}

export interface UiProtocolHost {
  requestCommands: (respond: ProtocolResponder) => void;
  extensionUIResponse: (message: ProtocolPayload<'extension_ui_response'>) => void;
  openSettingsPanel: (respond: ProtocolResponder) => Promise<void>;
  openTreePanel: (respond: ProtocolResponder) => Promise<void>;
  copyText: (message: ProtocolPayload<'copy_text'>, respond: ProtocolResponder) => Promise<void>;
  downloadImage: (
    message: ProtocolPayload<'download_image'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
  openChangesReview: (
    message: ProtocolPayload<'open_changes_review'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
  openCurrentChangesReview: (respond: ProtocolResponder) => Promise<void>;
}
