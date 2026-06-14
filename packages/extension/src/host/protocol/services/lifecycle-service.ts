// ============================================================
// Lifecycle protocol service — Webview 生命周期请求
// ============================================================

import type {
  ScoutBootstrapResult,
  ScoutCommandInfo,
  ScoutConfig,
  ScoutSessionListItem,
  ScoutTaskItem,
  ScoutTreeResult,
  ScoutWebviewState,
} from '@scout-agent/shared';
import type { ExtensionSessionCoordinator } from '../../session-coordinator.ts';
import type { ScoutWebviewSurface } from '../../webview-surface.ts';
import { type LifecycleProtocolHost, type ProtocolResponder } from './types.ts';

// ---------- 类型 ----------

export interface LifecycleProtocolServiceOptions {
  sessionManager: ExtensionSessionCoordinator;
  getConfig: () => ScoutConfig;
  getState: () => Promise<ScoutWebviewState>;
  getCommands: () => ScoutCommandInfo[];
  getSessions: () => Promise<ScoutSessionListItem[]>;
  getRecentTasks: () => Promise<ScoutTaskItem[]>;
  getTreeResult: () => Promise<ScoutTreeResult>;
  logReady: (surface: ScoutWebviewSurface) => void;
}

// ---------- Service ----------

export class LifecycleProtocolService implements LifecycleProtocolHost {
  private readonly sessionManager: ExtensionSessionCoordinator;
  private readonly getConfig: () => ScoutConfig;
  private readonly getState: () => Promise<ScoutWebviewState>;
  private readonly getCommands: () => ScoutCommandInfo[];
  private readonly getSessions: () => Promise<ScoutSessionListItem[]>;
  private readonly getRecentTasks: () => Promise<ScoutTaskItem[]>;
  private readonly getTreeResult: () => Promise<ScoutTreeResult>;
  private readonly logReady: (surface: ScoutWebviewSurface) => void;

  constructor(options: LifecycleProtocolServiceOptions) {
    this.sessionManager = options.sessionManager;
    this.getConfig = options.getConfig;
    this.getState = options.getState;
    this.getCommands = options.getCommands;
    this.getSessions = options.getSessions;
    this.getRecentTasks = options.getRecentTasks;
    this.getTreeResult = options.getTreeResult;
    this.logReady = options.logReady;
  }

  async ready(surface: ScoutWebviewSurface, respond: ProtocolResponder): Promise<void> {
    this.logReady(surface);
    await this.sessionManager.initialize();
    const result: ScoutBootstrapResult = {
      type: 'bootstrap_result',
      surface,
      config: this.getConfig(),
      state: await this.getState(),
      commands: this.getCommands(),
    };
    if (surface === 'chat') {
      result.sessions = await this.getSessions();
      result.recentTasks = await this.getRecentTasks();
    }
    if (surface === 'tree') {
      const tree = await this.getTreeResult();
      result.tree = { nodes: tree.tree, leafId: tree.leafId };
    }
    respond(result);
  }
}
