// ============================================================
// Task protocol service — 历史任务查询请求
// ============================================================

import type { ScoutTaskItem } from '@scout-agent/shared';
import type { JsonlSessionMetadata } from '../../../core/session/index.ts';
import { SessionIndex, type SessionIndexScope } from '../../session-index.ts';
import {
  getTaskSearchCacheKey,
  matchesTaskSearch,
  normalizeTaskSearchLimit,
  normalizeTaskSearchOffset,
} from '../task-search.ts';
import type { ProtocolServer } from '../protocol-server.ts';
import {
  registerPayloadHandler,
  type ProtocolPayload,
  type ProtocolResponder,
  type TaskProtocolHost,
} from './types.ts';

// ---------- 类型 ----------

export interface TaskProtocolServiceOptions {
  sessionIndex: SessionIndex;
  getActiveSessionFile: () => string | undefined;
  logError: (message: string) => void;
}

// ---------- Service ----------

export class TaskProtocolService implements TaskProtocolHost {
  private readonly sessionIndex: SessionIndex;
  private readonly getActiveSessionFile: () => string | undefined;
  private readonly logError: (message: string) => void;

  constructor(options: TaskProtocolServiceOptions) {
    this.sessionIndex = options.sessionIndex;
    this.getActiveSessionFile = options.getActiveSessionFile;
    this.logError = options.logError;
  }

  async requestTaskHistory(
    message: ProtocolPayload<'request_task_history'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    const limit = normalizeTaskSearchLimit(message.limit);
    const offset = normalizeTaskSearchOffset(message.offset);
    try {
      const scope: SessionIndexScope = message.scope ?? 'workspace';
      const cacheKey = getTaskSearchCacheKey(message.query);
      const filtered = await this.sessionIndex.filter(scope, cacheKey, (session) =>
        matchesTaskSearch(session, message.query),
      );
      const page = filtered.slice(offset, offset + limit);
      respond({
        type: 'task_history_data',
        query: message.query,
        purpose: message.purpose,
        tasks: this.sessionsToTasks(page),
        offset,
        hasMore: offset + limit < filtered.length,
        nextOffset: offset + page.length,
      });
    } catch (error) {
      respond({
        type: 'task_history_data',
        query: message.query,
        purpose: message.purpose,
        tasks: [],
        offset,
        hasMore: false,
        nextOffset: offset,
      });
      this.logError(
        `[scout] List task history failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private sessionsToTasks(sessions: JsonlSessionMetadata[], limit?: number): ScoutTaskItem[] {
    const visibleSessions =
      limit === undefined ? sessions : sessions.slice(0, Math.max(1, Math.min(limit, 200)));
    const activeSessionFile = this.getActiveSessionFile();
    return visibleSessions.map((session) => ({
      id: session.path,
      sessionId: session.id,
      sessionPath: session.path,
      title: session.name ?? session.firstMessage ?? session.id,
      cwd: session.cwd,
      createdAt: session.createdAt,
      modifiedAt: session.modifiedAt,
      parentSessionPath: session.parentSessionPath,
      messageCount: session.messageCount,
      isCurrent: session.path === activeSessionFile,
    }));
  }
}

export function registerTaskService(server: ProtocolServer, host: TaskProtocolHost): void {
  registerPayloadHandler(
    server,
    'task',
    'search',
    'request_task_history',
    async (message, context) => {
      await host.requestTaskHistory(message, context.respond);
    },
  );
}
