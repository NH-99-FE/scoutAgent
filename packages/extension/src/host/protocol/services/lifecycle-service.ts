// ============================================================
// Lifecycle protocol service — Webview 生命周期请求
// ============================================================

import type { ExtensionSessionCoordinator } from '../../session-coordinator.ts';
import type { ScoutWebviewSurface } from '../../webview-surface.ts';
import type { ProtocolServer } from '../protocol-server.ts';
import { registerPayloadHandler, type LifecycleProtocolHost } from './types.ts';

// ---------- 类型 ----------

export interface LifecycleProtocolServiceOptions {
  sessionManager: ExtensionSessionCoordinator;
  pushConfig: (surface?: ScoutWebviewSurface) => void;
  pushState: (surface?: ScoutWebviewSurface) => Promise<void>;
  requestCommands: (surface?: ScoutWebviewSurface) => void;
  requestSessions: (surface?: ScoutWebviewSurface) => Promise<void>;
  pushTreeData: (surface?: ScoutWebviewSurface) => Promise<void>;
  logReady: (surface: ScoutWebviewSurface) => void;
}

// ---------- Service ----------

export class LifecycleProtocolService implements LifecycleProtocolHost {
  private readonly sessionManager: ExtensionSessionCoordinator;
  private readonly pushConfig: (surface?: ScoutWebviewSurface) => void;
  private readonly pushState: (surface?: ScoutWebviewSurface) => Promise<void>;
  private readonly requestCommands: (surface?: ScoutWebviewSurface) => void;
  private readonly requestSessions: (surface?: ScoutWebviewSurface) => Promise<void>;
  private readonly pushTreeData: (surface?: ScoutWebviewSurface) => Promise<void>;
  private readonly logReady: (surface: ScoutWebviewSurface) => void;

  constructor(options: LifecycleProtocolServiceOptions) {
    this.sessionManager = options.sessionManager;
    this.pushConfig = options.pushConfig;
    this.pushState = options.pushState;
    this.requestCommands = options.requestCommands;
    this.requestSessions = options.requestSessions;
    this.pushTreeData = options.pushTreeData;
    this.logReady = options.logReady;
  }

  async ready(surface: ScoutWebviewSurface): Promise<void> {
    this.logReady(surface);
    await this.sessionManager.initialize();
    this.pushConfig();
    await this.pushState();
    this.requestCommands();
    if (surface === 'chat') {
      await this.requestSessions();
    }
    if (surface === 'tree') {
      await this.pushTreeData(surface);
    }
  }
}

export function registerLifecycleService(
  server: ProtocolServer,
  host: LifecycleProtocolHost,
): void {
  registerPayloadHandler(server, 'lifecycle', 'ready', 'ready', async (_message, context) => {
    await host.ready(context.surface);
  });
}
