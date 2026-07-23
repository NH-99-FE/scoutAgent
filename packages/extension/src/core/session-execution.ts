// ============================================================
// Session execution port — core 可依赖的最小顶层 mutation 互斥契约
// ============================================================

import type { ScoutSessionIdentity } from '@scout-agent/shared';

export type SessionExecutionKind =
  | 'agent_turn'
  | 'tree_navigation'
  | 'tree_mutation'
  | 'session_mutation'
  | 'compaction'
  | 'extension_command'
  | 'session_replacement';

export type SessionExecutionActivity =
  | { kind: 'idle' }
  | { kind: 'agent_turn'; operationId: string }
  | {
      kind: 'tree_navigation';
      operationId: string;
      phase: 'preflight' | 'reconciling';
    }
  | { kind: 'tree_mutation'; operationId: string }
  | { kind: 'session_mutation'; operationId: string }
  | { kind: 'compaction'; operationId: string }
  | { kind: 'extension_command'; operationId: string }
  | { kind: 'session_replacement'; operationId: string };

export interface SessionExecutionSnapshot {
  session?: ScoutSessionIdentity;
  activity: SessionExecutionActivity;
  health: { kind: 'ready' } | { kind: 'blocked'; reason: string };
}

export interface SessionExecutionLease {
  readonly operationId: string;
  run<T>(operation: () => Promise<T>): Promise<T>;
  transition(phase: 'preflight' | 'reconciling'): void;
  finish(): void;
}

export type SessionExecutionBeginResult =
  | { ok: true; lease: SessionExecutionLease }
  | { ok: false; reason: 'busy' | 'blocked' | 'stale' };

export interface SessionExecutionPort {
  snapshot(): SessionExecutionSnapshot;
  tryBegin(input: {
    kind: SessionExecutionKind;
    operationId: string;
    session: ScoutSessionIdentity;
  }): SessionExecutionBeginResult;
  run<T>(
    input: {
      kind: SessionExecutionKind;
      operationId: string;
      session: ScoutSessionIdentity;
    },
    operation: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; reason: 'busy' | 'blocked' | 'stale' }>;
  block(operationId: string, reason: string): void;
}
