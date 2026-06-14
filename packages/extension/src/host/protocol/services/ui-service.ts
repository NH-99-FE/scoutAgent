// ============================================================
// UI protocol service — 宿主 UI 面板与命令查询请求
// ============================================================

import type { ExtensionEventMessage, ScoutCommandInfo } from '@scout-agent/shared';
import type { ScoutWebviewSurface } from '../../webview-surface.ts';
import type { ProtocolResponder, UiProtocolHost } from './types.ts';

// ---------- 常量 ----------

const BUILTIN_SOURCE_INFO = {
  path: '<builtin:webview>',
  source: 'builtin',
  scope: 'temporary',
  origin: 'top-level',
} as const;

const BUILTIN_WEBVIEW_COMMANDS: ScoutCommandInfo[] = [
  {
    name: 'settings',
    description: 'Open Scout settings',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'tree',
    description: 'Open the conversation tree',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'model',
    description: 'Change the active model',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'compact',
    description: 'Manually compact the current session',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'new',
    description: 'Start a new session',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'sessions',
    description: 'List saved sessions',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'fork',
    description: 'Fork from a tree entry',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'resume',
    description: 'Resume a saved task',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'name',
    description: 'Rename the current session',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'export',
    description: 'Export the current session as JSONL',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'import',
    description: 'Import a JSONL session',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'reload',
    description: 'Reload Scout resources',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'continue',
    description: 'Continue the current response',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
];

// ---------- 类型 ----------

export interface UiProtocolServiceOptions {
  getExtensionCommands: () => ScoutCommandInfo[];
  publishEvent: (message: ExtensionEventMessage, surface?: ScoutWebviewSurface) => void;
  openSettingsPanel?: () => void | Promise<void>;
  openTreePanel?: () => void | Promise<void>;
}

// ---------- Service ----------

export class UiProtocolService implements UiProtocolHost {
  private readonly getExtensionCommands: () => ScoutCommandInfo[];
  private readonly publishEvent: (
    message: ExtensionEventMessage,
    surface?: ScoutWebviewSurface,
  ) => void;
  private readonly openSettingsPanelCallback?: () => void | Promise<void>;
  private readonly openTreePanelCallback?: () => void | Promise<void>;

  constructor(options: UiProtocolServiceOptions) {
    this.getExtensionCommands = options.getExtensionCommands;
    this.publishEvent = options.publishEvent;
    this.openSettingsPanelCallback = options.openSettingsPanel;
    this.openTreePanelCallback = options.openTreePanel;
  }

  requestCommands(respond: ProtocolResponder): void {
    respond({ type: 'commands_result', commands: this.getCommands() });
  }

  pushCommands(surface?: ScoutWebviewSurface): void {
    this.publishEvent({ type: 'commands_update', commands: this.getCommands() }, surface);
  }

  async openSettingsPanel(respond: ProtocolResponder): Promise<void> {
    try {
      if (!this.openSettingsPanelCallback) {
        respond({
          type: 'open_settings_panel_result',
          success: false,
          error: 'Settings panel is not registered',
        });
        return;
      }
      await this.openSettingsPanelCallback();
      respond({ type: 'open_settings_panel_result', success: true });
    } catch (error) {
      respond({
        type: 'open_settings_panel_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async openTreePanel(respond: ProtocolResponder): Promise<void> {
    try {
      if (!this.openTreePanelCallback) {
        respond({
          type: 'open_tree_panel_result',
          success: false,
          error: 'Tree panel is not registered',
        });
        return;
      }
      await this.openTreePanelCallback();
      respond({ type: 'open_tree_panel_result', success: true });
    } catch (error) {
      respond({
        type: 'open_tree_panel_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  getCommands(): ScoutCommandInfo[] {
    return [...BUILTIN_WEBVIEW_COMMANDS, ...this.getExtensionCommands()];
  }
}
