// ============================================================
// Protocol request registry — Webview request 生命周期管理
// 负责：按 requestId 追踪协议请求，统一取消、cleanup 和流式序号。
// ============================================================

import type { ScoutProtocolRequest } from '@scout-agent/shared';
import type { ScoutWebviewSurface } from '../webview-surface.ts';

// ---------- 类型 ----------

export type ProtocolRequestCleanup = () => void;

export interface ProtocolRequestHandle {
  requestId: string;
  surface: ScoutWebviewSurface;
  signal: AbortSignal;
  isCanceled: () => boolean;
  isClosed: () => boolean;
  hasResponded: () => boolean;
  markResponded: () => void;
  nextSequence: () => number;
  registerCleanup: (cleanup: ProtocolRequestCleanup) => void;
}

interface ProtocolRequestState {
  request: ScoutProtocolRequest;
  surface: ScoutWebviewSurface;
  abortController: AbortController;
  cleanups: Set<ProtocolRequestCleanup>;
  canceled: boolean;
  closed: boolean;
  responded: boolean;
  sequence: number;
}

// ---------- Registry ----------

export class ProtocolRequestRegistry {
  private readonly active = new Map<string, ProtocolRequestState>();

  begin(request: ScoutProtocolRequest, surface: ScoutWebviewSurface): ProtocolRequestHandle {
    this.cancel(request.requestId);

    const state: ProtocolRequestState = {
      request,
      surface,
      abortController: new AbortController(),
      cleanups: new Set(),
      canceled: false,
      closed: false,
      responded: false,
      sequence: 0,
    };
    this.active.set(request.requestId, state);

    return {
      requestId: request.requestId,
      surface,
      signal: state.abortController.signal,
      isCanceled: () => state.canceled,
      isClosed: () => state.closed,
      hasResponded: () => state.responded,
      markResponded: () => {
        state.responded = true;
      },
      nextSequence: () => {
        state.sequence += 1;
        return state.sequence;
      },
      registerCleanup: (cleanup) => {
        if (state.closed || state.canceled) {
          cleanup();
          return;
        }
        state.cleanups.add(cleanup);
      },
    };
  }

  cancel(requestId: string): boolean {
    const state = this.active.get(requestId);
    if (!state) return false;

    state.canceled = true;
    state.closed = true;
    this.active.delete(requestId);
    state.abortController.abort();
    this.runCleanups(state);
    return true;
  }

  finish(requestId: string): void {
    const state = this.active.get(requestId);
    if (!state) return;

    state.closed = true;
    this.active.delete(requestId);
    this.runCleanups(state);
  }

  dispose(): void {
    for (const requestId of [...this.active.keys()]) {
      this.cancel(requestId);
    }
  }

  private runCleanups(state: ProtocolRequestState): void {
    for (const cleanup of state.cleanups) {
      try {
        cleanup();
      } catch {
        // cleanup 不应破坏协议层取消流程。
      }
    }
    state.cleanups.clear();
  }
}
