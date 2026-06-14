// ============================================================
// State protocol service — Webview 状态查询请求
// ============================================================

import type {
  ExtensionEventMessage,
  ScoutBusyState,
  ScoutCommandInfo,
  ScoutWebviewState,
} from '@scout-agent/shared';
import type { ConfigManager } from '../../../config-manager.ts';
import type { ExtensionSessionCoordinator } from '../../session-coordinator.ts';
import type { ScoutWebviewSurface } from '../../webview-surface.ts';
import type { ProtocolServer } from '../protocol-server.ts';
import { registerPayloadHandler, type StateProtocolHost } from './types.ts';

// ---------- 类型 ----------

export interface StateProtocolServiceOptions {
  sessionManager: ExtensionSessionCoordinator;
  configManager: ConfigManager;
  getCommands: () => ScoutCommandInfo[];
  getBusyState: () => ScoutBusyState;
  postMessage: (message: ExtensionEventMessage, surface?: ScoutWebviewSurface) => void;
}

// ---------- Service ----------

export class StateProtocolService implements StateProtocolHost {
  private readonly sessionManager: ExtensionSessionCoordinator;
  private readonly configManager: ConfigManager;
  private readonly getCommands: () => ScoutCommandInfo[];
  private readonly getBusyState: () => ScoutBusyState;
  private readonly postMessage: (
    message: ExtensionEventMessage,
    surface?: ScoutWebviewSurface,
  ) => void;

  constructor(options: StateProtocolServiceOptions) {
    this.sessionManager = options.sessionManager;
    this.configManager = options.configManager;
    this.getCommands = options.getCommands;
    this.getBusyState = options.getBusyState;
    this.postMessage = options.postMessage;
  }

  async pushState(surface?: ScoutWebviewSurface): Promise<void> {
    this.postMessage({ type: 'state_update', state: await this.buildState() }, surface);
  }

  pushQueueState(surface?: ScoutWebviewSurface): void {
    this.postMessage(
      { type: 'queue_update', queueState: this.sessionManager.getQueueState() },
      surface,
    );
  }

  pushConfig(surface?: ScoutWebviewSurface): void {
    this.postMessage(
      { type: 'config_update', config: this.configManager.getScoutConfig() },
      surface,
    );
  }

  async requestContextUsage(surface?: ScoutWebviewSurface): Promise<void> {
    const sessionStats = await this.sessionManager.getSessionStats();
    this.postMessage(
      {
        type: 'context_usage_update',
        contextUsage: sessionStats?.contextUsage,
      },
      surface,
    );
  }

  private async buildState(): Promise<ScoutWebviewState> {
    const [sessionName, sessionStats, leafId] = await Promise.all([
      this.sessionManager.getSessionName(),
      this.sessionManager.getSessionStats(),
      this.sessionManager.getVisibleLeafId(),
    ]);
    return {
      messages: this.sessionManager.getScoutMessages(),
      isStreaming: this.sessionManager.isStreaming,
      busyState: this.getBusyState(),
      queueState: this.sessionManager.getQueueState(),
      modelProvider: this.sessionManager.model?.provider ?? '',
      modelId: this.sessionManager.model?.id ?? '',
      thinkingLevel: this.sessionManager.thinkingLevel,
      tools: this.sessionManager.getAllToolInfos(),
      activeToolNames: this.sessionManager.getActiveToolNames(),
      commands: this.getCommands(),
      cwd: this.sessionManager.currentCwd,
      sessionId: this.sessionManager.sessionId,
      sessionName,
      sessionFile: this.sessionManager.sessionFile,
      parentSessionPath: this.sessionManager.parentSessionPath,
      leafId,
      contextUsage: sessionStats?.contextUsage,
      sessionStats,
      diagnostics: [...this.sessionManager.diagnostics],
      modelFallbackMessage: this.sessionManager.modelFallbackMessage,
    };
  }
}

export function registerStateService(server: ProtocolServer, host: StateProtocolHost): void {
  registerPayloadHandler(
    server,
    'state',
    'request_state',
    'request_state',
    async (_message, context) => {
      await host.pushState(context.surface);
    },
  );
  registerPayloadHandler(
    server,
    'state',
    'request_context_usage',
    'request_context_usage',
    async (_message, context) => {
      await host.requestContextUsage(context.surface);
    },
  );
}
