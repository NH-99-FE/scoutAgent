// ============================================================
// Tree protocol service — 会话树查询、导航与标签请求
// ============================================================

import type { ExtensionEventMessage, ScoutTreeResult } from '@scout-agent/shared';
import type { ExtensionSessionCoordinator } from '../../session-coordinator.ts';
import type { SessionIndex } from '../../session-index.ts';
import type { ScoutWebviewSurface } from '../../webview-surface.ts';
import { type ProtocolPayload, type ProtocolResponder, type TreeProtocolHost } from './types.ts';

// ---------- 类型 ----------

export interface TreeProtocolServiceOptions {
  sessionManager: ExtensionSessionCoordinator;
  sessionIndex: SessionIndex;
  pushState: (surface?: ScoutWebviewSurface) => Promise<void>;
  requestSessions: (surface?: ScoutWebviewSurface) => Promise<void>;
  publishEvent: (message: ExtensionEventMessage, surface?: ScoutWebviewSurface) => void;
}

// ---------- Service ----------

export class TreeProtocolService implements TreeProtocolHost {
  private readonly sessionManager: ExtensionSessionCoordinator;
  private readonly sessionIndex: SessionIndex;
  private readonly pushState: (surface?: ScoutWebviewSurface) => Promise<void>;
  private readonly requestSessions: (surface?: ScoutWebviewSurface) => Promise<void>;
  private readonly publishEvent: (
    message: ExtensionEventMessage,
    surface?: ScoutWebviewSurface,
  ) => void;

  constructor(options: TreeProtocolServiceOptions) {
    this.sessionManager = options.sessionManager;
    this.sessionIndex = options.sessionIndex;
    this.pushState = options.pushState;
    this.requestSessions = options.requestSessions;
    this.publishEvent = options.publishEvent;
  }

  async forkSession(
    message: ProtocolPayload<'fork_session'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    let result: Awaited<ReturnType<ExtensionSessionCoordinator['fork']>>;
    try {
      result = await this.sessionManager.fork(message.entryId, message.position);
    } catch (error) {
      respond({
        type: 'fork_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    respond({
      type: 'fork_result',
      success: !result.cancelled,
      error: result.cancelled ? 'cancelled' : undefined,
      targetSessionId: result.cancelled ? undefined : this.sessionManager.sessionId,
      selectedText: result.cancelled ? undefined : result.selectedText,
    });

    if (result.cancelled) return;

    try {
      this.sessionIndex.invalidate();
      await this.pushState();
      await this.pushTreeData();
      await this.requestSessions();
    } catch (error) {
      this.publishEvent({
        type: 'notification',
        level: 'error',
        message: `Fork succeeded, but refresh failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  async requestForkCandidates(
    message: ProtocolPayload<'request_fork_candidates'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    const sessionId = message.sessionId;
    const candidates =
      sessionId === this.sessionManager.sessionId ? this.sessionManager.getForkCandidates() : [];
    respond({
      type: 'fork_candidates_result',
      sessionId,
      candidates,
    });
  }

  async requestTree(respond: ProtocolResponder): Promise<void> {
    respond(await this.getTreeResult());
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
    const result = await this.getTreeResult();
    this.publishEvent({ type: 'tree_update', tree: result.tree, leafId: result.leafId }, surface);
  }

  async getTreeResult(): Promise<ScoutTreeResult> {
    const { tree, leafId } = await this.sessionManager.getTreeData();
    return { type: 'tree_result', tree, leafId };
  }
}
