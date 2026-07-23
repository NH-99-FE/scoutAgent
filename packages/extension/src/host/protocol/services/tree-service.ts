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
  openChatSurface?: () => void | Promise<void>;
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
  private readonly openChatSurface?: () => void | Promise<void>;

  constructor(options: TreeProtocolServiceOptions) {
    this.sessionManager = options.sessionManager;
    this.sessionIndex = options.sessionIndex;
    this.pushState = options.pushState;
    this.requestSessions = options.requestSessions;
    this.publishEvent = options.publishEvent;
    this.openChatSurface = options.openChatSurface;
  }

  async forkSession(
    message: ProtocolPayload<'fork_session'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    if (!this.matchesCurrentSession(message.session)) {
      respond({ type: 'fork_result', success: false, error: 'stale' });
      return;
    }
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
      targetSessionPath: result.cancelled ? undefined : this.sessionManager.sessionFile,
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
    signal?: AbortSignal,
  ): Promise<void> {
    const currentSession = this.sessionManager.sessionIdentity;
    const isTargetSessionCurrent = () =>
      this.sessionManager.sessionIdentity?.sessionId === message.session.sessionId &&
      this.sessionManager.sessionIdentity?.sessionPath === message.session.sessionPath;
    if (
      !currentSession ||
      currentSession.sessionId !== message.session.sessionId ||
      currentSession.sessionPath !== message.session.sessionPath
    ) {
      respond({
        type: 'navigate_tree_result',
        navigationId: message.navigationId,
        status: 'stale',
      });
      return;
    }
    let result: Awaited<ReturnType<ExtensionSessionCoordinator['navigateTree']>>;
    try {
      result = await this.sessionManager.navigateTree(
        message.targetId,
        {
          navigationId: message.navigationId,
          summarize: message.summarize,
          customInstructions: message.customInstructions,
          replaceInstructions: message.replaceInstructions,
          label: message.label,
        },
        signal,
      );
    } catch (error) {
      respond({
        type: 'navigate_tree_result',
        navigationId: message.navigationId,
        status: 'failed_before_commit',
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (result.status === 'committed' || result.status === 'blocked_after_commit') {
      this.sessionManager.setPendingComposerIntent(
        result.editorText === undefined
          ? {
              commandId: message.navigationId,
              session: message.session,
              kind: 'clear',
            }
          : {
              commandId: message.navigationId,
              session: message.session,
              kind: 'replace_text',
              text: result.editorText,
            },
      );
      try {
        if (result.editorText !== undefined) {
          await this.openChatSurface?.();
        }
        await this.pushState('chat');
      } catch (error) {
        if (isTargetSessionCurrent()) {
          this.publishEvent(
            {
              type: 'notification',
              level: 'warning',
              message: `Tree navigation succeeded, but the chat composer could not be opened or refreshed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
            'tree',
          );
        }
      }
    }

    respond({
      type: 'navigate_tree_result',
      navigationId: result.navigationId,
      status: result.status,
      error: result.error,
    });
  }

  async abortTreeNavigation(
    message: ProtocolPayload<'abort_tree_navigation'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    const snapshot = this.sessionManager.executionSnapshot;
    if (
      snapshot.session?.sessionId !== message.session.sessionId ||
      snapshot.session.sessionPath !== message.session.sessionPath
    ) {
      respond({ type: 'abort_tree_navigation_result', status: 'stale' });
      return;
    }
    if (
      snapshot.activity.kind !== 'tree_navigation' ||
      snapshot.activity.operationId !== message.navigationId ||
      snapshot.activity.phase !== 'preflight'
    ) {
      respond({ type: 'abort_tree_navigation_result', status: 'not_running' });
      return;
    }
    const cancelled = this.sessionManager.abortTreeNavigation(message.navigationId);
    respond({
      type: 'abort_tree_navigation_result',
      status: cancelled ? 'accepted' : 'not_running',
    });
  }

  async setLabel(message: ProtocolPayload<'set_label'>, respond: ProtocolResponder): Promise<void> {
    if (!this.matchesCurrentSession(message.session)) {
      respond({ type: 'label_result', success: false, error: 'stale' });
      return;
    }
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

  private matchesCurrentSession(session: ProtocolPayload<'set_label'>['session']): boolean {
    const current = this.sessionManager.sessionIdentity;
    return current?.sessionId === session.sessionId && current.sessionPath === session.sessionPath;
  }
}
