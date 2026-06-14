// ============================================================
// Session event forwarder — SessionCoordinator 事件到 Webview 消息的映射
// 负责：维护宿主 busyState，并将 coordinator 事件转发为 shared 协议消息。
// ============================================================

import type { ExtensionEventMessage, ScoutBusyState } from '@scout-agent/shared';
import type { ScoutSessionEvent } from '../session-coordinator.ts';

// ---------- 类型 ----------

export interface SessionEventForwarderOptions {
  isStreaming: () => boolean;
  publishEvent: (message: ExtensionEventMessage) => void;
  pushState: () => Promise<void>;
  pushQueueState: () => void;
  pushTreeData: () => Promise<void>;
}

// ---------- 常量 ----------

const IDLE_BUSY_STATE: ScoutBusyState = {
  kind: 'idle',
  cancellable: false,
};

// ---------- Forwarder ----------

export class SessionEventForwarder {
  private readonly isStreaming: () => boolean;
  private readonly publishEvent: (message: ExtensionEventMessage) => void;
  private readonly pushState: () => Promise<void>;
  private readonly pushQueueState: () => void;
  private readonly pushTreeData: () => Promise<void>;
  private busyState: ScoutBusyState = IDLE_BUSY_STATE;

  constructor(options: SessionEventForwarderOptions) {
    this.isStreaming = options.isStreaming;
    this.publishEvent = options.publishEvent;
    this.pushState = options.pushState;
    this.pushQueueState = options.pushQueueState;
    this.pushTreeData = options.pushTreeData;
  }

  handle(event: ScoutSessionEvent): void {
    if (event.type === 'agent_event') {
      if (event.event.type === 'agent_start') {
        this.busyState = { kind: 'agent', label: 'Working', cancellable: true };
      }
      if (event.event.type === 'agent_end' && !event.event.willRetry) {
        this.busyState = IDLE_BUSY_STATE;
      }
      this.publishEvent({ type: 'agent_event', event: event.event });
    }

    if (event.type === 'auto_retry_start') {
      this.busyState = {
        kind: 'retry',
        label: 'Retrying',
        cancellable: true,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        reason: event.errorMessage,
      };
      this.publishEvent({
        type: 'auto_retry_start',
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        errorMessage: event.errorMessage,
      });
    }
    if (event.type === 'auto_retry_end') {
      this.busyState = IDLE_BUSY_STATE;
      this.publishEvent({
        type: 'auto_retry_end',
        success: event.success,
        attempt: event.attempt,
        finalError: event.finalError,
      });
    }

    if (event.type === 'compaction_start') {
      this.busyState = {
        kind: 'compaction',
        label: 'Compacting',
        cancellable: true,
        reason: event.reason,
      };
      this.publishEvent({ type: 'compaction_start', reason: event.reason });
    }
    if (event.type === 'compaction_end') {
      this.busyState = event.willRetry
        ? { kind: 'retry', label: 'Retrying', cancellable: true, reason: event.reason }
        : IDLE_BUSY_STATE;
      this.publishEvent({
        type: 'compaction_end',
        reason: event.reason,
        result: event.result,
        aborted: event.aborted,
        willRetry: event.willRetry,
        errorMessage: event.errorMessage,
      });
    }

    if (event.type === 'thinking_level_changed') {
      this.publishEvent({ type: 'thinking_level_changed', level: event.level });
    }

    if (event.type === 'state_change' || event.type === 'error') {
      if (event.type === 'error') {
        this.publishEvent({ type: 'notification', level: 'error', message: event.message });
      }
      void this.pushState();
    }

    if (event.type === 'queue_change') {
      this.pushQueueState();
    }

    if (event.type === 'tree_change') {
      void this.pushTreeData();
    }
  }

  getBusyState(): ScoutBusyState {
    if (this.busyState.kind === 'idle' && this.isStreaming()) {
      return { kind: 'agent', label: 'Working', cancellable: true };
    }
    return this.busyState;
  }
}
