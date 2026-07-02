// ============================================================
// Scout protocol host services — 协议 service 组装入口
// 负责：集中创建 host/protocol service，隔离 controller 与具体 service 构造细节。
// ============================================================

import type { ExtensionMessage } from '@scout-agent/shared';
import type { ConfigManager } from '../../config-manager.ts';
import type { FileReviewTurnSnapshot } from '../../core/review/file-review.ts';
import type { FileReviewArtifact } from '../review/file-review-artifact.ts';
import type { ExtensionSessionCoordinator } from '../session-coordinator.ts';
import type { SessionIndex } from '../session-index.ts';
import type { ScoutWebviewSurface } from '../webview-surface.ts';
import { DomainEventPublisher } from './domain-event-publisher.ts';
import { SessionEventForwarder } from './session-event-forwarder.ts';
import { type ScoutProtocolServices } from './services/index.ts';
import { ConfigProtocolService } from './services/config-service.ts';
import { ExtensionManagementProtocolService } from './services/extension-management-service.ts';
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
  agentDir: string;
  sessionManager: ExtensionSessionCoordinator;
  configManager: ConfigManager;
  sessionIndex: SessionIndex;
  openSettingsPanel?: () => void | Promise<void>;
  openTreePanel?: () => void | Promise<void>;
  openChangesReviewPanel?: (
    review: FileReviewTurnSnapshot | FileReviewArtifact,
    options: { allowCurrentFileContextExpansion?: boolean; cwd: string; recordId?: string },
  ) => void | Promise<void>;
  openTextFile?: (filePath: string) => Promise<void>;
  postMessage: (message: ExtensionMessage, surface?: ScoutWebviewSurface) => void;
  showErrorMessage?: (message: string) => void;
  log: (message: string) => void;
}

export interface ScoutProtocolHostServices {
  lifecycle: LifecycleProtocolService;
  state: StateProtocolService;
  config: ConfigProtocolService;
  extensions: ExtensionManagementProtocolService;
  session: SessionProtocolService;
  task: TaskProtocolService;
  tree: TreeProtocolService;
  mention: MentionProtocolService;
  ui: UiProtocolService;
  eventPublisher: DomainEventPublisher;
  sessionEventForwarder: SessionEventForwarder;
  protocolServices: ScoutProtocolServices;
}

// ---------- Factory ----------

export function createScoutProtocolHostServices(
  options: ScoutProtocolHostServicesOptions,
): ScoutProtocolHostServices {
  const bundle = {} as ScoutProtocolHostServices;
  bundle.eventPublisher = new DomainEventPublisher({
    postMessage: (message, surface) => options.postMessage(message, surface),
  });

  bundle.task = new TaskProtocolService({
    sessionIndex: options.sessionIndex,
    getActiveSessionFile: () => options.sessionManager.sessionFile,
    logError: options.log,
  });

  bundle.mention = new MentionProtocolService({
    cwd: options.cwd,
    logError: options.log,
  });

  bundle.ui = new UiProtocolService({
    getExtensionCommands: () => options.sessionManager.getCommands(),
    publishEvent: (message, surface) => bundle.eventPublisher.publish(message, surface),
    openSettingsPanel: options.openSettingsPanel,
    openTreePanel: options.openTreePanel,
    getChangesReview: (turnId) => options.sessionManager.getFileReviewTurn(turnId),
    getChangesReviewArtifact: (turnId) => options.sessionManager.getFileReviewArtifact(turnId),
    canExpandChangesReviewContext: (turnId) =>
      options.sessionManager.isLatestFileReviewArtifact(turnId),
    openChangesReviewPanel: options.openChangesReviewPanel
      ? (review, panelOptions) =>
          options.openChangesReviewPanel?.(review, {
            allowCurrentFileContextExpansion: panelOptions.allowCurrentFileContextExpansion,
            cwd: options.sessionManager.currentCwd,
            recordId: panelOptions.recordId,
          })
      : undefined,
  });
  options.sessionManager.setExtensionUIContext(bundle.ui.createExtensionUIContext(), (reason) =>
    bundle.ui.cancelExtensionUIRequests(reason),
  );

  bundle.state = new StateProtocolService({
    sessionManager: options.sessionManager,
    configManager: options.configManager,
    getCommands: () => bundle.ui.getCommands(),
    getBusyState: () => bundle.sessionEventForwarder.getBusyState(),
    getExtensionUIRequests: () => bundle.ui.getPendingExtensionUIRequests(),
    publishEvent: (message, surface) => bundle.eventPublisher.publish(message, surface),
  });

  bundle.tree = new TreeProtocolService({
    sessionManager: options.sessionManager,
    sessionIndex: options.sessionIndex,
    pushState: (surface) => bundle.state.pushState(surface),
    requestSessions: (surface) => bundle.session.pushSessionsUpdate(surface),
    publishEvent: (message, surface) => bundle.eventPublisher.publish(message, surface),
  });

  bundle.session = new SessionProtocolService({
    cwd: options.cwd,
    sessionManager: options.sessionManager,
    sessionIndex: options.sessionIndex,
    pushState: (surface) => bundle.state.pushState(surface),
    pushTreeData: (surface) => bundle.tree.pushTreeData(surface),
    requestRecentTasks: async () => {
      const result = await bundle.task.getTaskHistoryResult({
        type: 'request_task_history',
        query: '',
        limit: 3,
        offset: 0,
        purpose: 'recent',
      });
      bundle.eventPublisher.publishForProtocol('new_session_message', {
        type: 'task_history_update',
        query: result.query,
        purpose: result.purpose,
        tasks: result.tasks,
        offset: result.offset,
        hasMore: result.hasMore,
        nextOffset: result.nextOffset,
      });
    },
    publishEvent: (message, surface) => bundle.eventPublisher.publish(message, surface),
    logError: options.log,
  });

  bundle.config = new ConfigProtocolService({
    sessionManager: options.sessionManager,
    configManager: options.configManager,
    sessionIndex: options.sessionIndex,
    pushConfig: (surface) => bundle.state.pushConfig(surface),
    requestCommands: (surface) => bundle.ui.pushCommands(surface),
    pushState: (surface) => bundle.state.pushState(surface),
    pushTreeData: (surface) => bundle.tree.pushTreeData(surface),
  });

  bundle.extensions = new ExtensionManagementProtocolService({
    cwd: options.cwd,
    agentDir: options.agentDir,
    sessionManager: options.sessionManager,
    configManager: options.configManager,
    openTextFile: options.openTextFile,
    pushConfig: (surface) => bundle.state.pushConfig(surface),
    requestCommands: (surface) => bundle.ui.pushCommands(surface),
    pushState: (surface) => bundle.state.pushState(surface),
    pushTreeData: (surface) => bundle.tree.pushTreeData(surface),
  });

  bundle.lifecycle = new LifecycleProtocolService({
    sessionManager: options.sessionManager,
    getConfig: () => bundle.config.getConfig(),
    getState: () => bundle.state.getState(),
    getCommands: () => bundle.ui.getCommands(),
    getSessions: () => bundle.session.getSessionItems(),
    getRecentTasks: async () => {
      const result = await bundle.task.getTaskHistoryResult({
        type: 'request_task_history',
        query: '',
        limit: 3,
        offset: 0,
        purpose: 'recent',
      });
      return result.tasks;
    },
    getTreeResult: () => bundle.tree.getTreeResult(),
    logReady: (surface) => options.log(`[scout] Webview ready: ${surface}`),
    notifyReadyFailure: (surface, message) => {
      options.log(`[scout] Webview bootstrap failed (${surface}): ${message}`);
      options.showErrorMessage?.(`Scout 启动失败：${message}`);
    },
  });

  bundle.sessionEventForwarder = new SessionEventForwarder({
    isStreaming: () => options.sessionManager.isStreaming,
    getPreviewContext: () => {
      const editTool = options.sessionManager
        .getAllToolInfos()
        .find((tool) => tool.name === 'edit');
      return {
        generation: options.sessionManager.toolPreviewGeneration,
        sessionId: options.sessionManager.sessionId,
        sessionFile: options.sessionManager.sessionFile,
        cwd: options.sessionManager.currentCwd,
        editTool: editTool
          ? {
              active: editTool.active,
              source: editTool.sourceInfo.source,
              path: editTool.sourceInfo.path,
            }
          : undefined,
      };
    },
    publishEvent: (message) => bundle.eventPublisher.publish(message),
    pushState: () => bundle.state.pushState(),
    pushQueueState: () => bundle.state.pushQueueState(),
    pushTreeData: () => bundle.tree.pushTreeData(),
    logError: options.log,
  });

  bundle.protocolServices = {
    lifecycle: {
      ready: (surface, respond) => bundle.lifecycle.ready(surface, respond),
    },
    state: {
      pushState: (surface) => bundle.state.pushState(surface),
      requestState: (respond) => bundle.state.requestState(respond),
      requestContextUsage: (respond) => bundle.state.requestContextUsage(respond),
    },
    config: {
      pushConfig: (surface) => bundle.config.pushConfig(surface),
      requestConfig: (respond) => bundle.config.requestConfig(respond),
      requestCustomModels: (respond) => bundle.config.requestCustomModels(respond),
      requestRuntimeSettings: (respond) => bundle.config.requestRuntimeSettings(respond),
      setModel: (message) => bundle.config.setModel(message),
      setDefaultModel: (message, respond) => bundle.config.setDefaultModel(message, respond),
      saveCustomModels: (message, respond) => bundle.config.saveCustomModels(message, respond),
      saveRuntimeSettings: (message, respond) =>
        bundle.config.saveRuntimeSettings(message, respond),
      setThinkingLevel: (message) => bundle.config.setThinkingLevel(message),
      setActiveTools: (message) => bundle.config.setActiveTools(message),
      reloadResources: (respond) => bundle.config.reloadResources(respond),
    },
    extensions: {
      requestExtensions: (respond) => bundle.extensions.requestExtensions(respond),
      createExtensionFromTemplate: (message, respond) =>
        bundle.extensions.createExtensionFromTemplate(message, respond),
      openExtensionFile: (message, respond) =>
        bundle.extensions.openExtensionFile(message, respond),
    },
    session: {
      userMessage: (message) => bundle.session.userMessage(message),
      newSessionMessage: (message, respond) => bundle.session.newSessionMessage(message, respond),
      cancelFollowUp: (message) => bundle.session.cancelFollowUp(message),
      promoteFollowUp: (message) => bundle.session.promoteFollowUp(message),
      compact: (message) => bundle.session.compact(message),
      continueSession: (message) => bundle.session.continueSession(message),
      clearConversation: () => bundle.session.clearConversation(),
      requestSessions: (respond) => bundle.session.requestSessions(respond),
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
      forkSession: (message, respond) => bundle.tree.forkSession(message, respond),
      requestForkCandidates: (message, respond) =>
        bundle.tree.requestForkCandidates(message, respond),
      requestTree: (respond) => bundle.tree.requestTree(respond),
      navigateTree: (message, respond) => bundle.tree.navigateTree(message, respond),
      setLabel: (message, respond) => bundle.tree.setLabel(message, respond),
    },
    mention: {
      requestFileMentions: (message, respond) =>
        bundle.mention.requestFileMentions(message, respond),
    },
    ui: {
      requestCommands: (respond) => bundle.ui.requestCommands(respond),
      extensionUIResponse: (message) => bundle.ui.extensionUIResponse(message),
      openSettingsPanel: (respond) => bundle.ui.openSettingsPanel(respond),
      openTreePanel: (respond) => bundle.ui.openTreePanel(respond),
      openChangesReview: (message, respond) => bundle.ui.openChangesReview(message, respond),
    },
  };

  return bundle;
}
