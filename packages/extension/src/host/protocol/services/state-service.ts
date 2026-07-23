// ============================================================
// State protocol service — Webview 状态查询请求
// ============================================================

import type {
  ExtensionEventMessage,
  ScoutBusyState,
  ScoutCommandInfo,
  ScoutDiagnostic,
  ScoutExtensionUIRequest,
  ScoutResourceCollision,
  ScoutWebviewState,
} from '@scout-agent/shared';
import type { ConfigManager } from '../../../config-manager.ts';
import type { ExtensionSessionCoordinator } from '../../session-coordinator.ts';
import type { ScoutWebviewSurface } from '../../webview-surface.ts';
import type { ProtocolResponder, StateProtocolHost } from './types.ts';

// ---------- 类型 ----------

export interface StateProtocolServiceOptions {
  sessionManager: ExtensionSessionCoordinator;
  configManager: ConfigManager;
  getCommands: () => ScoutCommandInfo[];
  getBusyState: () => ScoutBusyState;
  getExtensionUIRequests: () => ScoutExtensionUIRequest[];
  publishEvent: (message: ExtensionEventMessage, surface?: ScoutWebviewSurface) => void;
}

// ---------- Service ----------

export class StateProtocolService implements StateProtocolHost {
  private readonly sessionManager: ExtensionSessionCoordinator;
  private readonly configManager: ConfigManager;
  private readonly getCommands: () => ScoutCommandInfo[];
  private readonly getBusyState: () => ScoutBusyState;
  private readonly getExtensionUIRequests: () => ScoutExtensionUIRequest[];
  private readonly publishEvent: (
    message: ExtensionEventMessage,
    surface?: ScoutWebviewSurface,
  ) => void;

  constructor(options: StateProtocolServiceOptions) {
    this.sessionManager = options.sessionManager;
    this.configManager = options.configManager;
    this.getCommands = options.getCommands;
    this.getBusyState = options.getBusyState;
    this.getExtensionUIRequests = options.getExtensionUIRequests;
    this.publishEvent = options.publishEvent;
  }

  async pushState(surface?: ScoutWebviewSurface): Promise<void> {
    this.publishEvent({ type: 'state_update', state: await this.buildState() }, surface);
  }

  async requestState(respond: ProtocolResponder): Promise<void> {
    respond({ type: 'state_result', state: await this.buildState() });
  }

  pushQueueState(surface?: ScoutWebviewSurface): void {
    const treeNavigationAdmission = this.sessionManager.getTreeNavigationAdmission();
    this.publishEvent(
      {
        type: 'queue_update',
        queueState: this.sessionManager.getQueueState(),
        treeNavigationAdmission,
      },
      surface,
    );
  }

  pushConfig(surface?: ScoutWebviewSurface): void {
    this.publishEvent(
      { type: 'config_update', config: this.configManager.getScoutConfig() },
      surface,
    );
  }

  async requestContextUsage(respond: ProtocolResponder): Promise<void> {
    const sessionStats = await this.sessionManager.getSessionStats();
    respond({ type: 'context_usage_result', contextUsage: sessionStats?.contextUsage });
  }

  async getState(): Promise<ScoutWebviewState> {
    return this.buildState();
  }

  private async buildState(): Promise<ScoutWebviewState> {
    const [sessionName, sessionStats, leafId] = await Promise.all([
      this.sessionManager.getSessionName(),
      this.sessionManager.getSessionStats(),
      this.sessionManager.getVisibleLeafId(),
    ]);
    const execution = this.sessionManager.executionSnapshot;
    const isStreaming = this.sessionManager.isStreaming;
    const runtimeBusyState = this.getBusyState();
    const treeNavigationAdmission = this.sessionManager.getTreeNavigationAdmission();
    const executionBusyState =
      execution.health.kind === 'blocked'
        ? ({
            kind: 'session_mutation',
            label: 'Session reload required',
            cancellable: false,
          } as const)
        : execution.activity.kind === 'agent_turn' &&
            !isStreaming &&
            (runtimeBusyState.kind === 'idle' || runtimeBusyState.kind === 'agent')
          ? ({
              kind: 'agent',
              label: 'Preparing message',
              cancellable: false,
            } as const)
          : execution.activity.kind === 'tree_navigation'
            ? {
                kind: 'tree_navigation' as const,
                operationId: execution.activity.operationId,
                phase: execution.activity.phase,
                label:
                  execution.activity.phase === 'preflight'
                    ? 'Navigating conversation tree'
                    : 'Finalizing tree navigation',
                cancellable: execution.activity.phase === 'preflight',
              }
            : execution.activity.kind === 'compaction'
              ? ({ kind: 'compaction', label: 'Compacting context', cancellable: true } as const)
              : execution.activity.kind === 'session_replacement' ||
                  execution.activity.kind === 'tree_mutation' ||
                  execution.activity.kind === 'session_mutation' ||
                  execution.activity.kind === 'extension_command'
                ? ({
                    kind: 'session_mutation',
                    label: 'Updating session',
                    cancellable: false,
                  } as const)
                : undefined;
    const busyState = executionBusyState ?? runtimeBusyState;
    return {
      messages: this.sessionManager.getScoutMessages(),
      isStreaming,
      busyState,
      queueState: this.sessionManager.getQueueState(),
      treeNavigationAdmission,
      modelProvider: this.sessionManager.model?.provider ?? '',
      modelId: this.sessionManager.model?.id ?? '',
      thinkingLevel: this.sessionManager.thinkingLevel,
      tools: this.sessionManager.getAllToolInfos(),
      activeToolNames: this.sessionManager.getActiveToolNames(),
      activeToolSelection: this.sessionManager.getActiveToolSelection(),
      commands: this.getCommands(),
      cwd: this.sessionManager.currentCwd,
      sessionId: this.sessionManager.sessionId,
      sessionName,
      sessionFile: this.sessionManager.sessionFile,
      parentSessionPath: this.sessionManager.parentSessionPath,
      forkPointEntryId: this.sessionManager.forkPointEntryId,
      leafId,
      contextUsage: sessionStats?.contextUsage,
      sessionStats,
      diagnostics: toScoutDiagnostics(this.sessionManager.diagnostics),
      extensionUIRequests: this.getExtensionUIRequests(),
      modelFallbackMessage: this.sessionManager.modelFallbackMessage,
      activeChangesReview: this.sessionManager.getActiveChangesReview(),
      pendingComposerIntent: this.sessionManager.getPendingComposerIntent(),
    };
  }
}

function toScoutDiagnostics(
  diagnostics: ReadonlyArray<{
    type: ScoutDiagnostic['type'];
    message: string;
    path?: string;
    collision?: unknown;
  }>,
): ScoutDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    type: diagnostic.type,
    message: diagnostic.message,
    path: diagnostic.path,
    collision: toScoutResourceCollision(diagnostic.collision),
  }));
}

function toScoutResourceCollision(value: unknown): ScoutResourceCollision | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isResourceType(value.resourceType) ||
    typeof value.name !== 'string' ||
    typeof value.winnerPath !== 'string' ||
    typeof value.loserPath !== 'string'
  ) {
    return undefined;
  }

  return {
    resourceType: value.resourceType,
    name: value.name,
    winnerPath: value.winnerPath,
    loserPath: value.loserPath,
  };
}

function isResourceType(value: unknown): value is ScoutResourceCollision['resourceType'] {
  return value === 'skill' || value === 'prompt' || value === 'extension';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
