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

const AGENT_BUSY_STATE: ScoutBusyState = {
  kind: 'agent',
  label: 'Working',
  cancellable: true,
};

function createRetryBusyState(
  details: Partial<
    Pick<Extract<ScoutBusyState, { kind: 'retry' }>, 'attempt' | 'maxAttempts' | 'reason'>
  > = {},
): ScoutBusyState {
  return {
    kind: 'retry',
    label: 'Retrying',
    cancellable: true,
    ...details,
  };
}

function reduceBusyState(current: ScoutBusyState, event: ScoutSessionEvent): ScoutBusyState {
  if (event.type === 'agent_event') {
    if (event.event.type === 'agent_start') return AGENT_BUSY_STATE;
    if (event.event.type === 'agent_end') {
      return event.event.willRetry ? createRetryBusyState() : IDLE_BUSY_STATE;
    }
    return current;
  }

  if (event.type === 'auto_retry_start') {
    return createRetryBusyState({
      attempt: event.attempt,
      maxAttempts: event.maxAttempts,
      reason: event.errorMessage,
    });
  }

  if (event.type === 'auto_retry_end') {
    return current.kind === 'retry' ? IDLE_BUSY_STATE : current;
  }

  if (event.type === 'compaction_start') {
    return {
      kind: 'compaction',
      label: 'Compacting',
      cancellable: true,
      reason: event.reason,
    };
  }

  if (event.type === 'compaction_end') {
    return event.willRetry ? createRetryBusyState({ reason: event.reason }) : IDLE_BUSY_STATE;
  }

  return current;
}

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
    this.busyState = reduceBusyState(this.busyState, event);

    if (event.type === 'agent_event') {
      this.publishEvent({ type: 'agent_event', event: event.event });
    }

    if (event.type === 'auto_retry_start') {
      this.publishEvent({
        type: 'auto_retry_start',
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        errorMessage: event.errorMessage,
      });
    }
    if (event.type === 'auto_retry_end') {
      this.publishEvent({
        type: 'auto_retry_end',
        success: event.success,
        attempt: event.attempt,
        finalError: event.finalError,
      });
    }

    if (event.type === 'compaction_start') {
      this.publishEvent({ type: 'compaction_start', reason: event.reason });
    }
    if (event.type === 'compaction_end') {
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
      return AGENT_BUSY_STATE;
    }
    return this.busyState;
  }
}
