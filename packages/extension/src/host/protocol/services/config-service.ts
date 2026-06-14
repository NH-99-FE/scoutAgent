// ============================================================
// Config protocol service — 模型、配置与资源刷新请求
// ============================================================

import type { ExtensionSessionCoordinator } from '../../session-coordinator.ts';
import type { ConfigManager } from '../../../config-manager.ts';
import type { SessionIndex } from '../../session-index.ts';
import type { ScoutWebviewSurface } from '../../webview-surface.ts';
import { type ConfigProtocolHost, type ProtocolPayload, type ProtocolResponder } from './types.ts';

// ---------- 类型 ----------

export interface ConfigProtocolServiceOptions {
  sessionManager: ExtensionSessionCoordinator;
  configManager: ConfigManager;
  sessionIndex: SessionIndex;
  pushConfig: (surface?: ScoutWebviewSurface) => void;
  requestCommands: (surface?: ScoutWebviewSurface) => void;
  pushState: (surface?: ScoutWebviewSurface) => Promise<void>;
  pushTreeData: (surface?: ScoutWebviewSurface) => Promise<void>;
}

// ---------- Service ----------

export class ConfigProtocolService implements ConfigProtocolHost {
  private readonly sessionManager: ExtensionSessionCoordinator;
  private readonly configManager: ConfigManager;
  private readonly sessionIndex: SessionIndex;
  private readonly pushConfigCallback: (surface?: ScoutWebviewSurface) => void;
  private readonly requestCommandsCallback: (surface?: ScoutWebviewSurface) => void;
  private readonly pushState: (surface?: ScoutWebviewSurface) => Promise<void>;
  private readonly pushTreeData: (surface?: ScoutWebviewSurface) => Promise<void>;

  constructor(options: ConfigProtocolServiceOptions) {
    this.sessionManager = options.sessionManager;
    this.configManager = options.configManager;
    this.sessionIndex = options.sessionIndex;
    this.pushConfigCallback = options.pushConfig;
    this.requestCommandsCallback = options.requestCommands;
    this.pushState = options.pushState;
    this.pushTreeData = options.pushTreeData;
  }

  pushConfig(surface?: ScoutWebviewSurface): void {
    this.pushConfigCallback(surface);
  }

  requestConfig(respond: ProtocolResponder): void {
    respond({ type: 'config_result', config: this.getConfig() });
  }

  getConfig() {
    return this.configManager.getScoutConfig();
  }

  async setModel(message: ProtocolPayload<'select_model'>): Promise<void> {
    await this.sessionManager.setModel(message.modelId, message.provider);
  }

  async setThinkingLevel(message: ProtocolPayload<'select_thinking'>): Promise<void> {
    await this.sessionManager.setThinkingLevel(message.level);
  }

  setActiveTools(message: ProtocolPayload<'set_active_tools'>): void {
    void this.sessionManager.setActiveTools(message.toolNames);
  }

  async reloadResources(respond: ProtocolResponder): Promise<void> {
    try {
      const result = await this.sessionManager.reload();
      this.sessionIndex.invalidate();
      respond({
        type: 'reload_result',
        success: !result.cancelled,
        error: result.cancelled ? 'cancelled' : undefined,
      });
      if (!result.cancelled) {
        this.pushConfig();
        this.requestCommandsCallback();
        await this.pushState();
        await this.pushTreeData();
      }
    } catch (error) {
      respond({
        type: 'reload_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
