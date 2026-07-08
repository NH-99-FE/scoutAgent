// ============================================================
// Resource persist coordinator — 保存资源设置后的运行态刷新
// ============================================================

import type { ExtensionSessionCoordinator } from '../../../session-coordinator.ts';
import type { ScoutWebviewSurface } from '../../../webview-surface.ts';

// ---------- 类型 ----------

export interface ResourcePersistCallbacks {
  pushConfig: (surface?: ScoutWebviewSurface) => void;
  requestCommands: (surface?: ScoutWebviewSurface) => void;
  pushState: (surface?: ScoutWebviewSurface) => Promise<void>;
  pushTreeData: (surface?: ScoutWebviewSurface) => Promise<void>;
}

export interface ResourcePersistCoordinatorOptions extends ResourcePersistCallbacks {
  sessionManager: ExtensionSessionCoordinator;
}

export interface ResourceReloadMessages {
  cancelled: string;
  failedPrefix: string;
}

export interface ResourceReloadResult {
  succeeded: boolean;
  error?: string;
}

// ---------- Coordinator ----------

export class ResourcePersistCoordinator {
  private readonly sessionManager: ExtensionSessionCoordinator;
  private readonly callbacks: ResourcePersistCallbacks;

  constructor(options: ResourcePersistCoordinatorOptions) {
    this.sessionManager = options.sessionManager;
    this.callbacks = {
      pushConfig: options.pushConfig,
      requestCommands: options.requestCommands,
      pushState: options.pushState,
      pushTreeData: options.pushTreeData,
    };
  }

  async reloadAfterPersist(messages: ResourceReloadMessages): Promise<ResourceReloadResult> {
    try {
      const result = await this.sessionManager.reload();
      if (result.cancelled) {
        return { succeeded: false, error: messages.cancelled };
      }
      return { succeeded: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        succeeded: false,
        error: `${messages.failedPrefix}: ${message}`,
      };
    }
  }

  async pushAfterPersist(reloadSucceeded: boolean): Promise<void> {
    this.callbacks.pushConfig();
    if (reloadSucceeded) {
      this.callbacks.requestCommands();
      await this.callbacks.pushState();
      await this.callbacks.pushTreeData();
    }
  }
}
