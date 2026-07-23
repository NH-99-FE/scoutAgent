// ============================================================
// SessionExecutionGate — 宿主层会话执行门
// 负责：单 owner、fail-fast、同 owner 重入，以及不可恢复状态封锁。
// ============================================================

import type { ScoutSessionIdentity } from '@scout-agent/shared';
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  SessionExecutionActivity,
  SessionExecutionBeginResult,
  SessionExecutionKind,
  SessionExecutionPort,
  SessionExecutionSnapshot,
} from '../core/session-execution.ts';

// ---------- SessionExecutionGate ----------

export class SessionExecutionGate implements SessionExecutionPort {
  private currentSession?: ScoutSessionIdentity;
  private activity: SessionExecutionActivity = { kind: 'idle' };
  private health: SessionExecutionSnapshot['health'] = { kind: 'ready' };
  private onExecutionChange?: (snapshot: SessionExecutionSnapshot) => void;
  private readonly ownerContext = new AsyncLocalStorage<string>();

  setOnExecutionChange(listener: (snapshot: SessionExecutionSnapshot) => void): void {
    this.onExecutionChange = listener;
  }

  setCurrentSession(session: ScoutSessionIdentity | undefined): void {
    this.currentSession = session;
    this.health = { kind: 'ready' };
    this.publishExecutionChange();
  }

  snapshot(): SessionExecutionSnapshot {
    return {
      session: this.currentSession,
      activity: this.activity,
      health: this.health,
    };
  }

  tryBegin(input: {
    kind: SessionExecutionKind;
    operationId: string;
    session: ScoutSessionIdentity;
  }): SessionExecutionBeginResult {
    const ownerOperationId = this.ownerContext.getStore();
    if (
      ownerOperationId &&
      this.activity.kind !== 'idle' &&
      this.activity.operationId === ownerOperationId
    ) {
      return {
        ok: true,
        lease: {
          operationId: input.operationId,
          run: async (operation) => await this.ownerContext.run(ownerOperationId, operation),
          transition: () => undefined,
          finish: () => undefined,
        },
      };
    }
    if (!this.matchesCurrentSession(input.session)) return { ok: false, reason: 'stale' };
    if (this.health.kind === 'blocked' && input.kind !== 'session_replacement') {
      return { ok: false, reason: 'blocked' };
    }
    if (this.activity.kind !== 'idle') return { ok: false, reason: 'busy' };

    this.activity =
      input.kind === 'tree_navigation'
        ? { kind: input.kind, operationId: input.operationId, phase: 'preflight' }
        : { kind: input.kind, operationId: input.operationId };
    this.publishExecutionChange();
    let finished = false;
    return {
      ok: true,
      lease: {
        operationId: input.operationId,
        run: async (operation) => await this.ownerContext.run(input.operationId, operation),
        transition: (phase) => {
          if (
            this.activity.kind !== 'tree_navigation' ||
            this.activity.operationId !== input.operationId
          ) {
            return;
          }
          this.activity = { ...this.activity, phase };
          this.publishExecutionChange();
        },
        finish: () => {
          if (finished) return;
          finished = true;
          if (this.activity.kind === 'idle' || this.activity.operationId !== input.operationId) {
            return;
          }
          this.activity = { kind: 'idle' };
          this.publishExecutionChange();
        },
      },
    };
  }

  async run<T>(
    input: {
      kind: SessionExecutionKind;
      operationId: string;
      session: ScoutSessionIdentity;
    },
    operation: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; reason: 'busy' | 'blocked' | 'stale' }> {
    const inheritedOwnerOperationId = this.ownerContext.getStore();
    const begin = this.tryBegin(input);
    if (!begin.ok) return begin;
    try {
      const ownerOperationId =
        inheritedOwnerOperationId &&
        this.activity.kind !== 'idle' &&
        this.activity.operationId === inheritedOwnerOperationId
          ? inheritedOwnerOperationId
          : begin.lease.operationId;
      const value = await this.ownerContext.run(ownerOperationId, operation);
      return { ok: true, value };
    } finally {
      begin.lease.finish();
    }
  }

  block(operationId: string, reason: string): void {
    if (this.activity.kind === 'idle') return;
    const ownerOperationId = this.ownerContext.getStore();
    if (
      this.activity.operationId !== operationId &&
      this.activity.operationId !== ownerOperationId
    ) {
      return;
    }
    this.health = { kind: 'blocked', reason };
    this.publishExecutionChange();
  }

  private matchesCurrentSession(session: ScoutSessionIdentity): boolean {
    return (
      this.currentSession?.sessionId === session.sessionId &&
      this.currentSession.sessionPath === session.sessionPath
    );
  }

  private publishExecutionChange(): void {
    this.onExecutionChange?.(this.snapshot());
  }
}
