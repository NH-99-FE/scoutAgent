// ============================================================
// File review artifact flush scheduler — review artifact 持久化调度器
// 负责：维护 pending review artifact 的 debounce 状态，并由 AgentSession 生命周期驱动最终 flush。
// ============================================================

import type { AgentSession } from '../../core/agent-session.ts';
import type { FileReviewTurnSnapshot } from '../../core/review/file-review.ts';

// ---------- 类型 ----------

export interface FileReviewArtifactFlushEntry {
  agentSession: AgentSession;
  sessionId: string;
  review: FileReviewTurnSnapshot;
}

export interface FileReviewArtifactFlushSchedulerOptions {
  debounceMs?: number;
  startSave: (entry: FileReviewArtifactFlushEntry) => Promise<void>;
}

interface PendingFileReviewArtifactFlushEntry extends FileReviewArtifactFlushEntry {
  debounced: boolean;
}

// ---------- Scheduler ----------

export class FileReviewArtifactFlushScheduler {
  private readonly debounceMs: number;
  private readonly startSave: (entry: FileReviewArtifactFlushEntry) => Promise<void>;
  private readonly pending = new Map<string, PendingFileReviewArtifactFlushEntry>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly idleAgentSessions = new WeakSet<AgentSession>();

  constructor(options: FileReviewArtifactFlushSchedulerOptions) {
    this.debounceMs = options.debounceMs ?? 100;
    this.startSave = options.startSave;
  }

  enqueue(agentSession: AgentSession, review: FileReviewTurnSnapshot): void {
    const sessionId = agentSession.sessionId;
    if (!sessionId) return;

    const key = this.createKey(sessionId, review.turnId);
    this.pending.set(key, {
      agentSession,
      sessionId,
      review,
      debounced: false,
    });

    const existingTimer = this.timers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.timers.delete(key);
      const pending = this.pending.get(key);
      if (!pending) return;
      pending.debounced = true;
      this.flushReadyForAgentSession(pending.agentSession);
    }, this.debounceMs);
    this.timers.set(key, timer);
  }

  setAgentSessionIdle(agentSession: AgentSession, idle: boolean): Promise<void>[] {
    if (idle) {
      this.idleAgentSessions.add(agentSession);
      return this.flushReadyForAgentSession(agentSession);
    }

    this.idleAgentSessions.delete(agentSession);
    return [];
  }

  markAgentSessionBusy(agentSession: AgentSession): void {
    this.idleAgentSessions.delete(agentSession);
  }

  flushAllNow(): Promise<void>[] {
    this.clearTimers();
    const pending = Array.from(this.pending.values());
    this.pending.clear();
    return pending.map((entry) => this.startSave(this.toFlushEntry(entry)));
  }

  flushOneNow(sessionId: string, turnId: string): Promise<void> | undefined {
    const key = this.createKey(sessionId, turnId);
    const pending = this.pending.get(key);
    if (!pending) return undefined;

    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    this.pending.delete(key);
    return this.startSave(this.toFlushEntry(pending));
  }

  hasPendingWork(): boolean {
    return this.pending.size > 0 || this.timers.size > 0;
  }

  dispose(): void {
    this.clearTimers();
    this.pending.clear();
  }

  private flushReadyForAgentSession(agentSession: AgentSession): Promise<void>[] {
    if (!this.idleAgentSessions.has(agentSession)) return [];

    const ready = Array.from(this.pending.entries()).filter(
      ([, entry]) => entry.agentSession === agentSession && entry.debounced,
    );
    const writes: Promise<void>[] = [];
    for (const [key, entry] of ready) {
      this.pending.delete(key);
      writes.push(this.startSave(this.toFlushEntry(entry)));
    }
    return writes;
  }

  private clearTimers(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private createKey(sessionId: string, turnId: string): string {
    return `${sessionId}\u0000${turnId}`;
  }

  private toFlushEntry(entry: PendingFileReviewArtifactFlushEntry): FileReviewArtifactFlushEntry {
    return {
      agentSession: entry.agentSession,
      sessionId: entry.sessionId,
      review: entry.review,
    };
  }
}
