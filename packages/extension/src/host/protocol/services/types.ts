// ============================================================
// Protocol service types — Webview protocol services 共享类型
// 负责：为各 service 注册文件提供统一 payload/host 类型。
// ============================================================

import type { WebviewRequestPayload } from '@scout-agent/shared';
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

// ---------- 注册辅助 ----------

export function registerPayloadHandler<TType extends WebviewRequestPayload['type']>(
  server: ProtocolServer,
  service: Parameters<ProtocolServer['register']>[0]['service'],
  method: string,
  payloadType: TType,
  handler: ProtocolHandlerFor<TType>,
): void {
  server.register({ service, method, payloadType }, async (context) => {
    await handler(context.payload as ProtocolPayload<TType>, context);
  });
}

// ---------- Host 能力 ----------

export interface LifecycleProtocolHost {
  ready: (surface: ScoutWebviewSurface) => Promise<void>;
}

export interface StateProtocolHost {
  pushState: (surface?: ScoutWebviewSurface) => Promise<void>;
  requestContextUsage: (surface?: ScoutWebviewSurface) => Promise<void>;
}

export interface ConfigProtocolHost {
  pushConfig: (surface?: ScoutWebviewSurface) => void;
  setModel: (message: ProtocolPayload<'select_model'>) => Promise<void>;
  setThinkingLevel: (message: ProtocolPayload<'select_thinking'>) => Promise<void>;
  setActiveTools: (message: ProtocolPayload<'set_active_tools'>) => void;
  reloadResources: (respond: ProtocolResponder) => Promise<void>;
}

export interface SessionProtocolHost {
  userMessage: (message: ProtocolPayload<'user_message'>) => Promise<void>;
  newSessionMessage: (
    message: ProtocolPayload<'new_session_message'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
  cancelFollowUp: (message: ProtocolPayload<'cancel_follow_up'>) => void;
  promoteFollowUp: (message: ProtocolPayload<'promote_follow_up'>) => Promise<void>;
  abort: () => void;
  abortRetry: () => void;
  compact: (message: ProtocolPayload<'compact'>) => Promise<void>;
  continueSession: (message: ProtocolPayload<'continue_session'>) => Promise<void>;
  clearConversation: () => void;
  requestSessions: (surface?: ScoutWebviewSurface) => Promise<void>;
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
  exportSession: (message: ProtocolPayload<'export_session'>, respond: ProtocolResponder) => void;
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
    surface?: ScoutWebviewSurface,
  ) => Promise<void>;
  requestTree: (surface?: ScoutWebviewSurface) => Promise<void>;
  navigateTree: (
    message: ProtocolPayload<'navigate_tree'>,
    respond: ProtocolResponder,
  ) => Promise<void>;
  setLabel: (message: ProtocolPayload<'set_label'>, respond: ProtocolResponder) => Promise<void>;
}

export interface MentionProtocolHost {
  requestFileMentions: (
    message: ProtocolPayload<'request_file_mentions'>,
    surface?: ScoutWebviewSurface,
  ) => Promise<void>;
}

export interface UiProtocolHost {
  requestCommands: (surface?: ScoutWebviewSurface) => void;
  openSettingsPanel: (respond: ProtocolResponder) => Promise<void>;
  openTreePanel: (respond: ProtocolResponder) => Promise<void>;
}
