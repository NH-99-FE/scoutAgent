// ============================================================
// UI protocol service — 宿主 UI 面板与命令查询请求
// ============================================================

import type {
  ExtensionEventMessage,
  ScoutCommandInfo,
  ScoutExtensionUIRequest,
  ScoutExtensionUIRequestClosedReason,
} from '@scout-agent/shared';
import type { ExtensionUIContext } from '../../../core/extensions/index.ts';
import type { FileReviewTurnSnapshot } from '../../../core/review/file-review.ts';
import type { FileReviewArtifact } from '../../review/file-review-artifact.ts';
import type { ScoutWebviewSurface } from '../../webview-surface.ts';
import type { ProtocolPayload, ProtocolResponder, UiProtocolHost } from './types.ts';
import { ExtensionUIRequestBroker } from './extension-ui-request-broker.ts';

// ---------- 常量 ----------

const BUILTIN_SOURCE_INFO = {
  path: '<builtin:webview>',
  source: 'builtin',
  scope: 'temporary',
  origin: 'top-level',
} as const;

const BUILTIN_WEBVIEW_COMMANDS: ScoutCommandInfo[] = [
  {
    name: 'tree',
    description: '查看会话树',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'compact',
    description: '手动压缩当前会话',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'new',
    description: '开始新会话',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'sessions',
    description: '查看已保存会话',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'fork',
    description: '从会话树节点创建分支',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'resume',
    description: '恢复已保存任务',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'name',
    description: '重命名当前会话',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'export',
    description: '导出当前会话 JSONL',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'import',
    description: '导入 JSONL 会话',
    source: 'builtin',
    sourceInfo: BUILTIN_SOURCE_INFO,
  },
  {
    name: 'reload',
    description: '重新加载 Scout 资源',
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
  getChangesReview?: (turnId: string) => FileReviewTurnSnapshot | undefined;
  getChangesReviewArtifact?: (
    turnId: string,
  ) => FileReviewArtifact | undefined | Promise<FileReviewArtifact | undefined>;
  getCurrentChangesReview?: () => FileReviewTurnSnapshot | undefined;
  getCurrentCwd?: () => string;
  getCurrentSessionId?: () => string;
  canExpandChangesReviewContext?: (turnId: string) => boolean;
  openChangesReviewPanel?: (
    review: FileReviewTurnSnapshot | FileReviewArtifact,
    options: { allowCurrentFileContextExpansion?: boolean; recordId?: string },
  ) => void | Promise<void>;
  openCurrentChangesReviewPanel?: (
    review: FileReviewTurnSnapshot | undefined,
    options: { cwd: string; sessionId: string },
  ) => void | Promise<void>;
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
  private readonly getChangesReview?: (turnId: string) => FileReviewTurnSnapshot | undefined;
  private readonly getChangesReviewArtifact?: (
    turnId: string,
  ) => FileReviewArtifact | undefined | Promise<FileReviewArtifact | undefined>;
  private readonly getCurrentChangesReview?: () => FileReviewTurnSnapshot | undefined;
  private readonly getCurrentCwd?: () => string;
  private readonly getCurrentSessionId?: () => string;
  private readonly canExpandChangesReviewContext?: (turnId: string) => boolean;
  private readonly openChangesReviewPanelCallback?: (
    review: FileReviewTurnSnapshot | FileReviewArtifact,
    options: { allowCurrentFileContextExpansion?: boolean; recordId?: string },
  ) => void | Promise<void>;
  private readonly openCurrentChangesReviewPanelCallback?: (
    review: FileReviewTurnSnapshot | undefined,
    options: { cwd: string; sessionId: string },
  ) => void | Promise<void>;
  private readonly extensionUIBroker: ExtensionUIRequestBroker;

  constructor(options: UiProtocolServiceOptions) {
    this.getExtensionCommands = options.getExtensionCommands;
    this.publishEvent = options.publishEvent;
    this.openSettingsPanelCallback = options.openSettingsPanel;
    this.openTreePanelCallback = options.openTreePanel;
    this.getChangesReview = options.getChangesReview;
    this.getChangesReviewArtifact = options.getChangesReviewArtifact;
    this.getCurrentChangesReview = options.getCurrentChangesReview;
    this.getCurrentCwd = options.getCurrentCwd;
    this.getCurrentSessionId = options.getCurrentSessionId;
    this.canExpandChangesReviewContext = options.canExpandChangesReviewContext;
    this.openChangesReviewPanelCallback = options.openChangesReviewPanel;
    this.openCurrentChangesReviewPanelCallback = options.openCurrentChangesReviewPanel;
    this.extensionUIBroker = new ExtensionUIRequestBroker({
      publishEvent: (message) => this.publishEvent(message),
      notify: (message, type = 'info') => {
        this.publishEvent({ type: 'notification', level: type, message });
      },
    });
  }

  requestCommands(respond: ProtocolResponder): void {
    respond({ type: 'commands_result', commands: this.getCommands() });
  }

  createExtensionUIContext(): ExtensionUIContext {
    return this.extensionUIBroker.createContext();
  }

  extensionUIResponse(message: ProtocolPayload<'extension_ui_response'>): void {
    this.extensionUIBroker.respond(message);
  }

  cancelExtensionUIRequests(reason: ScoutExtensionUIRequestClosedReason = 'cancelled'): void {
    this.extensionUIBroker.cancelAll(reason);
  }

  getPendingExtensionUIRequests(): ScoutExtensionUIRequest[] {
    return this.extensionUIBroker.getPendingRequests();
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

  async openChangesReview(
    message: ProtocolPayload<'open_changes_review'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    try {
      if (
        (!this.getChangesReview && !this.getChangesReviewArtifact) ||
        !this.openChangesReviewPanelCallback
      ) {
        respond({
          type: 'open_changes_review_result',
          success: false,
          error: 'Changes review panel is not registered',
        });
        return;
      }
      const artifact = await this.getChangesReviewArtifact?.(message.turnId);
      const runtimeReview = artifact ? undefined : this.getChangesReview?.(message.turnId);
      const review =
        artifact ?? (runtimeReview && !runtimeReview.contentReleased ? runtimeReview : undefined);
      if (!review) {
        respond({
          type: 'open_changes_review_result',
          success: false,
          error: 'Changes are no longer available',
        });
        return;
      }
      if (
        message.recordId &&
        !review.records.some((record) => record.recordId === message.recordId)
      ) {
        respond({
          type: 'open_changes_review_result',
          success: false,
          error: 'Changes are no longer available',
        });
        return;
      }
      const recordId = message.recordId;
      await this.openChangesReviewPanelCallback(review, {
        allowCurrentFileContextExpansion: artifact
          ? (this.canExpandChangesReviewContext?.(artifact.turnId) ?? false)
          : true,
        recordId,
      });
      respond({ type: 'open_changes_review_result', success: true });
    } catch (error) {
      respond({
        type: 'open_changes_review_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async openCurrentChangesReview(respond: ProtocolResponder): Promise<void> {
    try {
      if (
        !this.openCurrentChangesReviewPanelCallback ||
        !this.getCurrentSessionId ||
        !this.getCurrentCwd
      ) {
        respond({
          type: 'open_current_changes_review_result',
          success: false,
          error: 'Changes review panel is not registered',
        });
        return;
      }
      const sessionId = this.getCurrentSessionId();
      if (!sessionId) {
        respond({
          type: 'open_current_changes_review_result',
          success: false,
          error: 'No active session for changes review',
        });
        return;
      }
      await this.openCurrentChangesReviewPanelCallback(this.getCurrentChangesReview?.(), {
        cwd: this.getCurrentCwd(),
        sessionId,
      });
      respond({ type: 'open_current_changes_review_result', success: true });
    } catch (error) {
      respond({
        type: 'open_current_changes_review_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  getCommands(): ScoutCommandInfo[] {
    return [...BUILTIN_WEBVIEW_COMMANDS, ...this.getExtensionCommands()];
  }
}
