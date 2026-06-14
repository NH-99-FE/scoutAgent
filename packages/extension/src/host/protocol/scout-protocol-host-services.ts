// ============================================================
// Scout protocol host services — 协议 service 组装入口
// 负责：集中创建 host/protocol service，隔离 controller 与具体 service 构造细节。
// ============================================================

import type { ExtensionMessage } from '@scout-agent/shared';
import type { ConfigManager } from '../../config-manager.ts';
import type { ExtensionSessionCoordinator } from '../session-coordinator.ts';
import type { SessionIndex } from '../session-index.ts';
import type { ScoutWebviewSurface } from '../webview-surface.ts';
import { SessionEventForwarder } from './session-event-forwarder.ts';
import { type ScoutProtocolServices } from './services/index.ts';
import { ConfigProtocolService } from './services/config-service.ts';
import { LifecycleProtocolService } from './services/lifecycle-service.ts';
import { MentionProtocolService } from './services/mention-service.ts';
import { SessionProtocolService } from './services/session-service.ts';
import { StateProtocolService } from './services/state-service.ts';
import { TaskProtocolService } from './services/task-service.ts';
import { TreeProtocolService } from './services/tree-service.ts';
import { UiProtocolService } from './services/ui-service.ts';

// ---------- 类型 ----------

export interface ScoutProtocolHostServicesOptions {
  cwd: string;
  sessionManager: ExtensionSessionCoordinator;
  configManager: ConfigManager;
  sessionIndex: SessionIndex;
  openSettingsPanel?: () => void | Promise<void>;
  openTreePanel?: () => void | Promise<void>;
  postMessage: (message: ExtensionMessage, surface?: ScoutWebviewSurface) => void;
  log: (message: string) => void;
}

export interface ScoutProtocolHostServices {
  lifecycle: LifecycleProtocolService;
  state: StateProtocolService;
  config: ConfigProtocolService;
  session: SessionProtocolService;
  task: TaskProtocolService;
  tree: TreeProtocolService;
  mention: MentionProtocolService;
  ui: UiProtocolService;
  sessionEventForwarder: SessionEventForwarder;
  protocolServices: ScoutProtocolServices;
}

// ---------- Factory ----------

export function createScoutProtocolHostServices(
  options: ScoutProtocolHostServicesOptions,
): ScoutProtocolHostServices {
  const bundle = {} as ScoutProtocolHostServices;

  bundle.task = new TaskProtocolService({
    sessionIndex: options.sessionIndex,
    getActiveSessionFile: () => options.sessionManager.sessionFile,
    logError: options.log,
  });

  bundle.mention = new MentionProtocolService({
    cwd: options.cwd,
    postMessage: options.postMessage,
    logError: options.log,
  });

  bundle.ui = new UiProtocolService({
    getExtensionCommands: () => options.sessionManager.getCommands(),
    postMessage: options.postMessage,
    openSettingsPanel: options.openSettingsPanel,
    openTreePanel: options.openTreePanel,
  });

  bundle.state = new StateProtocolService({
    sessionManager: options.sessionManager,
    configManager: options.configManager,
    getCommands: () => bundle.ui.getCommands(),
    getBusyState: () => bundle.sessionEventForwarder.getBusyState(),
    postMessage: options.postMessage,
  });

  bundle.tree = new TreeProtocolService({
    sessionManager: options.sessionManager,
    sessionIndex: options.sessionIndex,
    pushState: (surface) => bundle.state.pushState(surface),
    requestSessions: (surface) => bundle.session.requestSessions(surface),
    postMessage: options.postMessage,
  });

  bundle.session = new SessionProtocolService({
    cwd: options.cwd,
    sessionManager: options.sessionManager,
    sessionIndex: options.sessionIndex,
    pushState: (surface) => bundle.state.pushState(surface),
    pushTreeData: (surface) => bundle.tree.pushTreeData(surface),
    requestRecentTasks: () =>
      bundle.task.requestTaskHistory(
        {
          type: 'request_task_history',
          query: '',
          limit: 3,
          offset: 0,
          purpose: 'recent',
        },
        (payload) => options.postMessage(payload),
      ),
    postMessage: options.postMessage,
    logError: options.log,
  });

  bundle.config = new ConfigProtocolService({
    sessionManager: options.sessionManager,
    sessionIndex: options.sessionIndex,
    pushConfig: (surface) => bundle.state.pushConfig(surface),
    requestCommands: (surface) => bundle.ui.requestCommands(surface),
    pushState: (surface) => bundle.state.pushState(surface),
    pushTreeData: (surface) => bundle.tree.pushTreeData(surface),
  });

  bundle.lifecycle = new LifecycleProtocolService({
    sessionManager: options.sessionManager,
    pushConfig: (surface) => bundle.config.pushConfig(surface),
    pushState: (surface) => bundle.state.pushState(surface),
    requestCommands: (surface) => bundle.ui.requestCommands(surface),
    requestSessions: (surface) => bundle.session.requestSessions(surface),
    pushTreeData: (surface) => bundle.tree.pushTreeData(surface),
    logReady: (surface) => options.log(`[scout] Webview ready: ${surface}`),
  });

  bundle.sessionEventForwarder = new SessionEventForwarder({
    isStreaming: () => options.sessionManager.isStreaming,
    postMessage: (message) => options.postMessage(message),
    pushState: () => bundle.state.pushState(),
    pushQueueState: () => bundle.state.pushQueueState(),
    pushTreeData: () => bundle.tree.pushTreeData(),
  });

  bundle.protocolServices = {
    lifecycle: {
      ready: (surface) => bundle.lifecycle.ready(surface),
    },
    state: {
      pushState: (surface) => bundle.state.pushState(surface),
      requestContextUsage: (surface) => bundle.state.requestContextUsage(surface),
    },
    config: {
      pushConfig: (surface) => bundle.config.pushConfig(surface),
      setModel: (message) => bundle.config.setModel(message),
      setThinkingLevel: (message) => bundle.config.setThinkingLevel(message),
      setActiveTools: (message) => bundle.config.setActiveTools(message),
      reloadResources: (respond) => bundle.config.reloadResources(respond),
    },
    session: {
      userMessage: (message) => bundle.session.userMessage(message),
      newSessionMessage: (message, respond) => bundle.session.newSessionMessage(message, respond),
      cancelFollowUp: (message) => bundle.session.cancelFollowUp(message),
      promoteFollowUp: (message) => bundle.session.promoteFollowUp(message),
      abort: () => bundle.session.abort(),
      abortRetry: () => bundle.session.abortRetry(),
      compact: (message) => bundle.session.compact(message),
      continueSession: (message) => bundle.session.continueSession(message),
      clearConversation: () => bundle.session.clearConversation(),
      requestSessions: (surface) => bundle.session.requestSessions(surface),
      openTask: (message, respond) => bundle.session.openTask(message, respond),
      restoreSession: (message, respond) => bundle.session.restoreSession(message, respond),
      pickImportSession: (respond) => bundle.session.pickImportSession(respond),
      importSession: (message, respond) => bundle.session.importSession(message, respond),
      deleteSession: (message, respond) => bundle.session.deleteSession(message, respond),
      exportSession: (message, respond) => bundle.session.exportSession(message, respond),
      setSessionName: (message, respond) => bundle.session.setSessionName(message, respond),
    },
    task: {
      requestTaskHistory: (message, respond) => bundle.task.requestTaskHistory(message, respond),
    },
    tree: {
      forkSession: (message, surface) => bundle.tree.forkSession(message, surface),
      requestTree: (surface) => bundle.tree.requestTree(surface),
      navigateTree: (message, respond) => bundle.tree.navigateTree(message, respond),
      setLabel: (message, respond) => bundle.tree.setLabel(message, respond),
    },
    mention: {
      requestFileMentions: (message, surface) =>
        bundle.mention.requestFileMentions(message, surface),
    },
    ui: {
      requestCommands: (surface) => bundle.ui.requestCommands(surface),
      openSettingsPanel: (respond) => bundle.ui.openSettingsPanel(respond),
      openTreePanel: (respond) => bundle.ui.openTreePanel(respond),
    },
  };

  return bundle;
}
