// ============================================================
// Tree protocol service — 会话树查询、导航与标签请求
// ============================================================

import type { ExtensionEventMessage } from '@scout-agent/shared';
import type { ExtensionSessionCoordinator } from '../../session-coordinator.ts';
import type { SessionIndex } from '../../session-index.ts';
import type { ScoutWebviewSurface } from '../../webview-surface.ts';
import type { ProtocolServer } from '../protocol-server.ts';
import {
  registerPayloadHandler,
  type ProtocolPayload,
  type ProtocolResponder,
  type TreeProtocolHost,
} from './types.ts';

// ---------- 类型 ----------

export interface TreeProtocolServiceOptions {
  sessionManager: ExtensionSessionCoordinator;
  sessionIndex: SessionIndex;
  pushState: (surface?: ScoutWebviewSurface) => Promise<void>;
  requestSessions: (surface?: ScoutWebviewSurface) => Promise<void>;
  postMessage: (message: ExtensionEventMessage, surface?: ScoutWebviewSurface) => void;
}

// ---------- Service ----------

export class TreeProtocolService implements TreeProtocolHost {
  private readonly sessionManager: ExtensionSessionCoordinator;
  private readonly sessionIndex: SessionIndex;
  private readonly pushState: (surface?: ScoutWebviewSurface) => Promise<void>;
  private readonly requestSessions: (surface?: ScoutWebviewSurface) => Promise<void>;
  private readonly postMessage: (
    message: ExtensionEventMessage,
    surface?: ScoutWebviewSurface,
  ) => void;

  constructor(options: TreeProtocolServiceOptions) {
    this.sessionManager = options.sessionManager;
    this.sessionIndex = options.sessionIndex;
    this.pushState = options.pushState;
    this.requestSessions = options.requestSessions;
    this.postMessage = options.postMessage;
  }

  async forkSession(
    message: ProtocolPayload<'fork_session'>,
    surface?: ScoutWebviewSurface,
  ): Promise<void> {
    try {
      const result = await this.sessionManager.fork(message.entryId, message.position);
      this.postMessage(
        {
          type: 'fork_result',
          success: !result.cancelled,
          error: result.cancelled ? 'cancelled' : undefined,
        },
        surface,
      );
      if (!result.cancelled) {
        this.sessionIndex.invalidate();
        await this.pushState();
        await this.pushTreeData();
        await this.requestSessions();
      }
    } catch (error) {
      this.postMessage(
        {
          type: 'fork_result',
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        surface,
      );
    }
  }

  async requestTree(surface?: ScoutWebviewSurface): Promise<void> {
    await this.pushTreeData(surface);
  }

  async navigateTree(
    message: ProtocolPayload<'navigate_tree'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    try {
      const result = await this.sessionManager.navigateTree(message.targetId, {
        summarize: message.summarize,
        customInstructions: message.customInstructions,
        replaceInstructions: message.replaceInstructions,
        label: message.label,
      });
      respond({
        type: 'navigate_tree_result',
        success: !result.cancelled,
        editorText: result.editorText,
      });
    } catch (error) {
      respond({
        type: 'navigate_tree_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async setLabel(message: ProtocolPayload<'set_label'>, respond: ProtocolResponder): Promise<void> {
    try {
      await this.sessionManager.setLabel(message.entryId, message.label);
      respond({ type: 'label_result', success: true });
    } catch (error) {
      respond({
        type: 'label_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async pushTreeData(surface?: ScoutWebviewSurface): Promise<void> {
    const { tree, leafId } = await this.sessionManager.getTreeData();
    this.postMessage({ type: 'tree_data', tree, leafId }, surface);
  }
}

export function registerTreeService(server: ProtocolServer, host: TreeProtocolHost): void {
  registerPayloadHandler(
    server,
    'tree',
    'fork_session',
    'fork_session',
    async (message, context) => {
      await host.forkSession(message, context.surface);
    },
  );
  registerPayloadHandler(
    server,
    'tree',
    'request_tree',
    'request_tree',
    async (_message, context) => {
      await host.requestTree(context.surface);
    },
  );
  registerPayloadHandler(
    server,
    'tree',
    'navigate_tree',
    'navigate_tree',
    async (message, context) => {
      await host.navigateTree(message, context.respond);
    },
  );
  registerPayloadHandler(server, 'tree', 'set_label', 'set_label', async (message, context) => {
    await host.setLabel(message, context.respond);
  });
}
