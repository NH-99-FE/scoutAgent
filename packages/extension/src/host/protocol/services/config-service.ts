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

  requestCustomModels(respond: ProtocolResponder): void {
    respond({
      type: 'custom_models_result',
      settings: this.configManager.getCustomModelsSettings(),
    });
  }

  requestRuntimeSettings(respond: ProtocolResponder): void {
    respond({ type: 'runtime_settings_result', settings: this.configManager.getRuntimeSettings() });
  }

  async setModel(message: ProtocolPayload<'select_model'>): Promise<void> {
    await this.sessionManager.setModel(message.modelId, message.provider);
  }

  async setDefaultModel(
    message: ProtocolPayload<'set_default_model'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    try {
      this.configManager.setDefaultModel(message.provider, message.modelId, message.scope);
      await this.sessionManager.setModel(message.modelId, message.provider);
      respond({ type: 'set_default_model_result', success: true });
      this.pushConfig();
      await this.pushState();
      await this.pushTreeData();
    } catch (error) {
      respond({
        type: 'set_default_model_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async saveCustomModels(
    message: ProtocolPayload<'save_custom_models'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    let settings: ReturnType<ConfigManager['saveCustomModels']>;
    try {
      settings = this.configManager.saveCustomModels(message.settings);
    } catch (error) {
      respond({
        type: 'save_custom_models_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const reload = await this.reloadAfterPersist();
    respond({
      type: 'save_custom_models_result',
      success: true,
      error: reload.error,
      settings,
    });
    await this.pushAfterPersist(reload.succeeded);
  }

  async saveRuntimeSettings(
    message: ProtocolPayload<'save_runtime_settings'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    let settings: ReturnType<ConfigManager['saveRuntimeSettings']>;
    try {
      settings = this.configManager.saveRuntimeSettings(message.scope, message.patch);
    } catch (error) {
      respond({
        type: 'save_runtime_settings_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const reload = await this.reloadAfterPersist();
    respond({
      type: 'save_runtime_settings_result',
      success: true,
      error: reload.error,
      settings,
    });
    await this.pushAfterPersist(reload.succeeded);
  }

  async setThinkingLevel(message: ProtocolPayload<'select_thinking'>): Promise<void> {
    await this.sessionManager.setThinkingLevel(message.level);
  }

  setToolProfile(message: ProtocolPayload<'set_tool_profile'>): void {
    void this.sessionManager.setToolProfile(message.profileId);
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

  private async reloadAfterPersist(): Promise<{ succeeded: boolean; error?: string }> {
    try {
      const result = await this.sessionManager.reload();
      if (result.cancelled) {
        return { succeeded: false, error: 'Runtime reload cancelled after saving settings' };
      }
      return { succeeded: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        succeeded: false,
        error: `Runtime reload failed after saving settings: ${message}`,
      };
    }
  }

  private async pushAfterPersist(reloadSucceeded: boolean): Promise<void> {
    this.pushConfig();
    if (reloadSucceeded) {
      this.requestCommandsCallback();
      await this.pushState();
      await this.pushTreeData();
    }
  }
}
