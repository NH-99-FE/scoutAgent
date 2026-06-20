// ============================================================
// Agent event update coalescer
// 负责：在 host/webview 边界合并高频 message_update，降低 postMessage 压力。
// ============================================================

import type { ScoutAgentEvent } from '@scout-agent/shared';

// ---------- 类型 ----------

export interface AgentEventUpdateCoalescerOptions {
  publishEvent: (event: ScoutAgentEvent) => void;
  flushDelayMs?: number;
}

// ---------- 常量 ----------

const DEFAULT_FLUSH_DELAY_MS = 16;

// ---------- Coalescer ----------

export class AgentEventUpdateCoalescer {
  private readonly publishEvent: (event: ScoutAgentEvent) => void;
  private readonly flushDelayMs: number;
  private readonly pendingUpdates = new Map<
    string,
    Extract<ScoutAgentEvent, { type: 'message_update' }>
  >();
  private readonly endedMessageIds = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: AgentEventUpdateCoalescerOptions) {
    this.publishEvent = options.publishEvent;
    this.flushDelayMs = Math.max(0, options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS);
  }

  handle(event: ScoutAgentEvent): void {
    if (event.type === 'agent_start') {
      this.reset();
      this.publishEvent(event);
      return;
    }

    if (event.type === 'message_update') {
      if (this.endedMessageIds.has(event.messageId)) return;
      this.pendingUpdates.set(event.messageId, event);
      this.scheduleFlush();
      return;
    }

    if (event.type === 'message_end') {
      this.pendingUpdates.delete(event.messageId);
      this.endedMessageIds.add(event.messageId);
      this.publishEvent(event);
      return;
    }

    if (event.type === 'agent_end') {
      this.flush();
      this.publishEvent(event);
      return;
    }

    this.publishEvent(event);
  }

  flush(): void {
    this.clearTimer();
    if (this.pendingUpdates.size === 0) return;
    const updates = [...this.pendingUpdates.values()];
    this.pendingUpdates.clear();
    for (const update of updates) {
      this.publishEvent(update);
    }
  }

  discardPendingUpdates(): void {
    this.clearTimer();
    this.pendingUpdates.clear();
  }

  reset(): void {
    this.discardPendingUpdates();
    this.endedMessageIds.clear();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, this.flushDelayMs);
  }

  private clearTimer(): void {
    if (!this.flushTimer) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
  }
}
