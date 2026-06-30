// ============================================================
// Session protocol service — 会话运行与历史恢复请求
// ============================================================

import * as vscode from 'vscode';
import { join } from 'node:path';
import type { ExtensionEventMessage, ScoutSessionListItem } from '@scout-agent/shared';
import { isPathInsideOrEqual, resolveSessionCwdPolicy } from '../../../core/session-cwd.ts';
import {
  createDefaultSessionExportFileName,
  readSessionFileInfo,
} from '../../../core/session/index.ts';
import type {
  ExtensionSessionCoordinator,
  UserSessionOperationToken,
} from '../../session-coordinator.ts';
import type { SessionIndex } from '../../session-index.ts';
import type { ScoutWebviewSurface } from '../../webview-surface.ts';
import { type ProtocolPayload, type ProtocolResponder, type SessionProtocolHost } from './types.ts';

// ---------- 类型 ----------

export interface SessionProtocolServiceOptions {
  cwd: string;
  sessionManager: ExtensionSessionCoordinator;
  sessionIndex: SessionIndex;
  pushState: (surface?: ScoutWebviewSurface) => Promise<void>;
  pushTreeData: (surface?: ScoutWebviewSurface) => Promise<void>;
  requestRecentTasks: () => Promise<void>;
  publishEvent: (message: ExtensionEventMessage, surface?: ScoutWebviewSurface) => void;
  logError: (message: string) => void;
}

interface RestoreSessionByPathResult {
  type: 'restore_session_result';
  success: boolean;
  error?: string;
  stale?: boolean;
}

// ---------- Service ----------

export class SessionProtocolService implements SessionProtocolHost {
  private readonly cwd: string;
  private readonly sessionManager: ExtensionSessionCoordinator;
  private readonly sessionIndex: SessionIndex;
  private readonly pushState: (surface?: ScoutWebviewSurface) => Promise<void>;
  private readonly pushTreeData: (surface?: ScoutWebviewSurface) => Promise<void>;
  private readonly requestRecentTasks: () => Promise<void>;
  private readonly publishEvent: (
    message: ExtensionEventMessage,
    surface?: ScoutWebviewSurface,
  ) => void;
  private readonly logError: (message: string) => void;

  constructor(options: SessionProtocolServiceOptions) {
    this.cwd = options.cwd;
    this.sessionManager = options.sessionManager;
    this.sessionIndex = options.sessionIndex;
    this.pushState = options.pushState;
    this.pushTreeData = options.pushTreeData;
    this.requestRecentTasks = options.requestRecentTasks;
    this.publishEvent = options.publishEvent;
    this.logError = options.logError;
  }

  async userMessage(message: ProtocolPayload<'user_message'>): Promise<void> {
    await this.sessionManager.prompt(message.text, {
      deliverAs: message.deliverAs,
      images: message.images,
      clearFollowUpQueue: message.clearFollowUpQueue,
    });
    await this.pushState();
  }

  async newSessionMessage(
    message: ProtocolPayload<'new_session_message'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    const operation = this.sessionManager.beginUserSessionOperation('new_session_message');
    let turnPromise: Promise<void> | undefined;

    try {
      const operationResult = await this.sessionManager.newUserSession(operation, {
        withSession: async (ctx) => {
          if (!operation.isLatest()) return;
          const content =
            message.images && message.images.length > 0
              ? [{ type: 'text' as const, text: message.text }, ...message.images]
              : message.text;
          const started = await ctx.startUserMessage(content);
          turnPromise = started.turn;
        },
      });
      this.watchNewSessionInitialTurn(operation, turnPromise);
      if (operationResult.status === 'stale') {
        return;
      }
      if (operationResult.status === 'failed') {
        respond({
          type: 'new_session_result',
          success: false,
          error: operationResult.error,
        });
        return;
      }
      const result = operationResult.value;
      if (result.cancelled) {
        respond({
          type: 'new_session_result',
          success: false,
          error: 'cancelled',
        });
        return;
      }
      await this.pushState();
      this.sessionIndex.invalidate();
      respond({ type: 'new_session_result', success: true });
    } catch (error) {
      respond({
        type: 'new_session_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  cancelFollowUp(message: ProtocolPayload<'cancel_follow_up'>): void {
    this.sessionManager.cancelFollowUp(message.id);
  }

  async promoteFollowUp(message: ProtocolPayload<'promote_follow_up'>): Promise<void> {
    const promoted = this.sessionManager.promoteFollowUp(message.id);
    if (promoted && message.resume) {
      await this.sessionManager.continue({
        preserveFollowUpQueue: message.preserveFollowUpQueue,
      });
    }
  }

  async compact(message: ProtocolPayload<'compact'>): Promise<void> {
    try {
      await this.sessionManager.compact(message.customInstructions);
    } catch (error) {
      this.publishEvent({
        type: 'notification',
        level: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async continueSession(message: ProtocolPayload<'continue_session'>): Promise<void> {
    await this.sessionManager.continue({
      preserveFollowUpQueue: message.preserveFollowUpQueue,
    });
  }

  clearConversation(): void {
    void this.sessionManager.newSession();
    this.sessionIndex.invalidate();
  }

  async requestSessions(respond: ProtocolResponder): Promise<void> {
    respond({ type: 'sessions_result', sessions: await this.getSessionItems() });
  }

  async pushSessionsUpdate(surface?: ScoutWebviewSurface): Promise<void> {
    this.publishEvent({ type: 'sessions_update', sessions: await this.getSessionItems() }, surface);
  }

  async getSessionItems(): Promise<ScoutSessionListItem[]> {
    try {
      const sessions = await this.listAvailableSessions();
      return sessions.map((session) => ({
        id: session.id,
        path: session.path,
        cwd: session.cwd,
        createdAt: session.createdAt,
        modifiedAt: session.modifiedAt,
        name: session.name,
        messageCount: session.messageCount,
        firstMessage: session.firstMessage,
        parentSessionPath: session.parentSessionPath,
        forkPointEntryId: session.forkPointEntryId,
        isCurrent: session.path === this.sessionManager.sessionFile,
      }));
    } catch (error) {
      this.logError(
        `[scout] List sessions failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  async openTask(message: ProtocolPayload<'open_task'>, respond: ProtocolResponder): Promise<void> {
    const operation = this.sessionManager.beginUserSessionOperation('open_task');
    try {
      const result = await this.restoreSessionByPath({
        sessionId: message.taskId,
        sessionPath: message.sessionPath,
        cwdOverride: message.cwdOverride,
        operation,
      });
      if (result.stale) return;
      respond({
        type: 'open_task_result',
        sessionPath: message.sessionPath,
        success: result.success,
        error: result.error,
      });
    } catch (error) {
      respond({
        type: 'open_task_result',
        sessionPath: message.sessionPath,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async restoreSession(
    message: ProtocolPayload<'restore_session'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    const operation = this.sessionManager.beginUserSessionOperation('restore_session');
    try {
      const result = await this.restoreSessionByPath({ ...message, operation });
      if (result.stale) return;
      respond(result);
    } catch (error) {
      respond({
        type: 'restore_session_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async pickImportSession(respond: ProtocolResponder): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'JSONL Session': ['jsonl'], 'All Files': ['*'] },
      openLabel: 'Import Session',
    });
    const sessionPath = selected?.[0]?.fsPath;
    if (!sessionPath) {
      respond({ type: 'import_session_result', success: false, error: 'cancelled' });
      return;
    }
    await this.importSession({ type: 'import_session', sessionPath }, respond);
  }

  async importSession(
    message: ProtocolPayload<'import_session'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    try {
      const sessionInfo = readSessionFileInfo(message.sessionPath);
      const cwd = message.cwdOverride ?? (await this.resolveSessionCwd(sessionInfo.cwd));
      if (!cwd) {
        respond({ type: 'import_session_result', success: false, error: 'cancelled' });
        return;
      }

      const result = await this.sessionManager.importSessionFromJsonl(message.sessionPath, {
        cwdOverride: cwd,
      });
      this.sessionIndex.invalidate();
      respond({
        type: 'import_session_result',
        success: !result.cancelled,
        error: result.cancelled ? 'cancelled' : undefined,
      });
      if (!result.cancelled) {
        await this.pushState();
        await this.pushTreeData();
      }
    } catch (error) {
      respond({
        type: 'import_session_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async deleteSession(
    message: ProtocolPayload<'delete_session'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    try {
      const sessions = await this.listAvailableSessions();
      const target = this.findSessionByPath(sessions, message);
      if (!target) {
        respond({
          type: 'delete_session_result',
          success: false,
          error: `Session not found: ${message.sessionId}`,
        });
        return;
      }
      if (target.path === this.sessionManager.sessionFile) {
        respond({
          type: 'delete_session_result',
          success: false,
          error: 'Cannot delete the active session',
        });
        return;
      }
      await this.sessionManager.deleteSession(target);
      this.sessionIndex.invalidate();
      respond({ type: 'delete_session_result', success: true });
    } catch (error) {
      respond({
        type: 'delete_session_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async exportSession(
    message: ProtocolPayload<'export_session'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    try {
      const outputPath = message.outputPath ?? (await this.pickExportSessionPath());
      if (!outputPath) {
        respond({ type: 'export_session_result', success: false, error: 'cancelled' });
        return;
      }

      const path = this.sessionManager.exportSessionToJsonl(outputPath);
      if (!path) {
        respond({
          type: 'export_session_result',
          success: false,
          error: '导出会话失败：当前没有活动会话',
        });
        return;
      }
      respond({ type: 'export_session_result', success: true, path });
    } catch (error) {
      respond({
        type: 'export_session_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async pickExportSessionPath(): Promise<string | undefined> {
    const selected = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        join(
          this.cwd,
          createDefaultSessionExportFileName({ sessionId: this.sessionManager.sessionId }),
        ),
      ),
      filters: { 'JSONL Session': ['jsonl'], 'All Files': ['*'] },
      saveLabel: 'Export Session',
    });
    return selected?.fsPath;
  }

  async setSessionName(
    message: ProtocolPayload<'set_session_name'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    try {
      await this.sessionManager.setSessionName(message.name);
      this.sessionIndex.invalidate();
      respond({ type: 'set_session_name_result', success: true });
      await this.pushState();
      await this.pushSessionsUpdate();
    } catch (error) {
      respond({
        type: 'set_session_name_result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private watchNewSessionInitialTurn(
    operation: UserSessionOperationToken,
    turnPromise: Promise<void> | undefined,
  ): void {
    if (!turnPromise) return;
    void turnPromise
      .then(async () => {
        if (!operation.isLatest()) return;
        await this.pushState();
        this.sessionIndex.invalidate();
        await this.requestRecentTasks();
      })
      .catch((error) => {
        if (!operation.isLatest()) return;
        this.publishEvent({
          type: 'notification',
          level: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }

  private async listAvailableSessions() {
    return await this.sessionIndex.list('all');
  }

  private async restoreSessionByPath(message: {
    sessionId: string;
    sessionPath: string;
    cwdOverride?: string;
    operation?: UserSessionOperationToken;
  }): Promise<RestoreSessionByPathResult> {
    const sessions = await this.listAvailableSessions();
    if (message.operation && !message.operation.isLatest()) {
      return {
        type: 'restore_session_result',
        success: false,
        stale: true,
      };
    }

    const target = this.findSessionByPath(sessions, message);
    if (!target) {
      return {
        type: 'restore_session_result',
        success: false,
        error: `Session not found: ${message.sessionId}`,
      };
    }

    const cwd = message.cwdOverride ?? (await this.resolveSessionCwd(target.cwd));
    if (message.operation && !message.operation.isLatest()) {
      return {
        type: 'restore_session_result',
        success: false,
        stale: true,
      };
    }
    if (!cwd) {
      return {
        type: 'restore_session_result',
        success: false,
        error: 'cancelled',
      };
    }

    const operationResult = message.operation
      ? await this.sessionManager.restoreUserSession(message.operation, target, {
          cwdOverride: cwd,
        })
      : {
          status: 'completed' as const,
          value: await this.sessionManager.restore(target, { cwdOverride: cwd }),
        };
    if (operationResult.status === 'stale') {
      return {
        type: 'restore_session_result',
        success: false,
        stale: true,
      };
    }
    if (operationResult.status === 'failed') {
      return {
        type: 'restore_session_result',
        success: false,
        error: operationResult.error,
      };
    }

    const result = operationResult.value;
    if (!result.cancelled) {
      await this.pushState();
      await this.pushTreeData();
    }
    return {
      type: 'restore_session_result',
      success: !result.cancelled,
      error: result.cancelled ? 'cancelled' : undefined,
    };
  }

  private findSessionByPath(
    sessions: Awaited<ReturnType<ExtensionSessionCoordinator['listSessions']>>,
    message: { sessionId: string; sessionPath: string },
  ) {
    const byPath = sessions.find((session) => session.path === message.sessionPath);
    if (byPath) return byPath;
    return message.sessionPath
      ? undefined
      : sessions.find((session) => session.id === message.sessionId);
  }

  private getWorkspaceFolders(): string[] {
    return vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
  }

  private getFallbackCwd(workspaceFolders: string[]): string {
    if (workspaceFolders.some((folder) => isPathInsideOrEqual(this.cwd, folder))) {
      return this.cwd;
    }
    return workspaceFolders[0] ?? this.cwd;
  }

  private async resolveSessionCwd(sessionCwd?: string): Promise<string | undefined> {
    const workspaceFolders = this.getWorkspaceFolders();
    const decision = resolveSessionCwdPolicy({
      sessionCwd,
      fallbackCwd: this.getFallbackCwd(workspaceFolders),
      workspaceFolders,
    });

    if (decision.type === 'use-session-cwd' || decision.type === 'use-fallback-cwd') {
      return decision.cwd;
    }

    if (decision.reason === 'missing-path') {
      const selected = await vscode.window.showWarningMessage(
        `The original session folder no longer exists:\n${decision.sessionCwd}\n\nUse current workspace instead?`,
        'Use Current Workspace',
        'Choose Folder',
        'Cancel',
      );
      if (selected === 'Use Current Workspace') return decision.fallbackCwd;
      if (selected === 'Choose Folder') return this.pickFolder();
      return undefined;
    }

    if (decision.reason === 'no-workspace') {
      const selected = await vscode.window.showWarningMessage(
        `This session was created in:\n${decision.sessionCwd}\n\nNo VS Code workspace is open.`,
        'Use Original Folder',
        'Choose Folder',
        'Cancel',
      );
      if (selected === 'Use Original Folder') return decision.sessionCwd;
      if (selected === 'Choose Folder') return this.pickFolder();
      return undefined;
    }

    const selected = await vscode.window.showWarningMessage(
      `This session was created outside the current workspace:\n${decision.sessionCwd}\n\nCurrent workspace:\n${decision.fallbackCwd}`,
      'Use Original Folder',
      'Use Current Workspace',
      'Choose Folder',
      'Cancel',
    );
    if (selected === 'Use Original Folder') return decision.sessionCwd;
    if (selected === 'Use Current Workspace') return decision.fallbackCwd;
    if (selected === 'Choose Folder') return this.pickFolder();
    return undefined;
  }

  private async pickFolder(): Promise<string | undefined> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Use Folder',
    });
    return selected?.[0]?.fsPath;
  }
}
