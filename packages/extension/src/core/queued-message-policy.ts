// ============================================================
// Queued Message Policy — Agent 队列宿主态策略
// 负责：队列快照映射、follow-up 暂停态、continuation 消费策略
// ============================================================

import type { TextContent } from '@scout-agent/ai';
import type {
  AgentMessage,
  QueuedAgentMessage,
  QueuedAgentMessageDelivery,
} from '@scout-agent/agent';

// ---------- 类型 ----------

export type FollowUpQueuePauseReason = 'aborted';

export interface QueueContinuationPolicy {
  preserveFollowUps?: boolean;
}

export interface QueuedRuntimeMessage {
  id: string;
  delivery: QueuedAgentMessageDelivery;
  text: string;
  timestamp: number;
}

export interface QueuedFollowUpMessage {
  id: string;
  text: string;
  timestamp: number;
}

export interface QueuedRuntimeSnapshot {
  messages: QueuedRuntimeMessage[];
  followUps: QueuedFollowUpMessage[];
  followUpPaused: boolean;
  followUpPauseReason?: FollowUpQueuePauseReason;
}

export interface QueueRuntimeAgent {
  queueMessage?: (message: AgentMessage, delivery: QueuedAgentMessageDelivery) => string;
  steer?: (message: AgentMessage) => string | void;
  followUp?: (message: AgentMessage) => string | void;
  getQueuedMessages?: (delivery?: QueuedAgentMessageDelivery) => QueuedAgentMessage[];
  getSteeringQueue?: () => QueuedAgentMessage[];
  getFollowUpQueue?: () => QueuedAgentMessage[];
  hasQueuedMessages?: (delivery?: QueuedAgentMessageDelivery) => boolean;
  hasSteeringMessages?: () => boolean;
  clearQueuedMessages?: (delivery?: QueuedAgentMessageDelivery) => void;
  clearAllQueues?: () => void;
  clearSteeringQueue?: () => void;
  clearFollowUpQueue?: () => void;
  removeQueuedMessage?: (
    id: string,
    delivery?: QueuedAgentMessageDelivery,
  ) => QueuedAgentMessage | undefined;
  cancelFollowUp?: (id: string) => boolean;
  moveQueuedMessage?: (
    id: string,
    from: QueuedAgentMessageDelivery,
    to: QueuedAgentMessageDelivery,
  ) => boolean;
  promoteFollowUp?: (id: string) => boolean;
}

// ---------- 文本提取 ----------

function isTextContent(part: unknown): part is TextContent {
  return (
    typeof part === 'object' &&
    part !== null &&
    (part as { type?: unknown }).type === 'text' &&
    typeof (part as { text?: unknown }).text === 'string'
  );
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(isTextContent)
    .map((part) => part.text)
    .join('\n');
}

function queuedMessageText(message: AgentMessage): string {
  switch (message.role) {
    case 'user':
    case 'custom':
      return contentText(message.content);
    case 'bashExecution':
      return message.command;
    case 'branchSummary':
      return message.summary;
    case 'compactionSummary':
      return message.summary;
    default:
      return '';
  }
}

function toRuntimeMessage(entry: QueuedAgentMessage): QueuedRuntimeMessage {
  return {
    id: entry.id,
    delivery: entry.delivery,
    text: queuedMessageText(entry.message),
    timestamp: entry.timestamp,
  };
}

function toFollowUpMessage(entry: QueuedAgentMessage): QueuedFollowUpMessage {
  return {
    id: entry.id,
    text: queuedMessageText(entry.message),
    timestamp: entry.timestamp,
  };
}

// ---------- 策略对象 ----------

export class QueuedMessagePolicy {
  private followUpPaused = false;
  private pauseReason: FollowUpQueuePauseReason | undefined;

  snapshot(agent: QueueRuntimeAgent | undefined): QueuedRuntimeSnapshot {
    const messages = this.getQueuedMessages(agent);
    const followUps = this.getFollowUps(agent);
    const followUpPaused = this.isFollowUpPaused(agent);
    return {
      messages,
      followUps,
      followUpPaused,
      followUpPauseReason: followUpPaused ? this.pauseReason : undefined,
    };
  }

  getQueuedMessages(agent: QueueRuntimeAgent | undefined): QueuedRuntimeMessage[] {
    const entries = agent?.getQueuedMessages?.() ?? [
      ...this.getQueueEntries(agent, 'steer'),
      ...this.getQueueEntries(agent, 'followUp'),
    ];
    return entries.map(toRuntimeMessage);
  }

  getFollowUps(agent: QueueRuntimeAgent | undefined): QueuedFollowUpMessage[] {
    return this.getQueueEntries(agent, 'followUp').map(toFollowUpMessage);
  }

  isFollowUpPaused(agent: QueueRuntimeAgent | undefined): boolean {
    return this.followUpPaused && this.hasFollowUps(agent);
  }

  followUpPauseReason(agent: QueueRuntimeAgent | undefined): FollowUpQueuePauseReason | undefined {
    return this.isFollowUpPaused(agent) ? this.pauseReason : undefined;
  }

  queue(
    agent: QueueRuntimeAgent | undefined,
    message: AgentMessage,
    delivery: QueuedAgentMessageDelivery,
  ): void {
    if (!agent) return;
    if (agent.queueMessage) {
      agent.queueMessage(message, delivery);
    } else if (delivery === 'followUp') {
      agent.followUp?.(message);
    } else {
      agent.steer?.(message);
    }

    if (delivery === 'followUp') {
      this.resumeFollowUps();
    }
  }

  pauseFollowUpsAfterAbort(agent: QueueRuntimeAgent | undefined): boolean {
    if (agent?.clearQueuedMessages) {
      agent.clearQueuedMessages('steer');
    } else {
      agent?.clearSteeringQueue?.();
    }
    const hasFollowUps = this.hasFollowUps(agent);
    this.followUpPaused = hasFollowUps;
    this.pauseReason = hasFollowUps ? 'aborted' : undefined;
    return hasFollowUps;
  }

  resumeFollowUps(): void {
    this.followUpPaused = false;
    this.pauseReason = undefined;
  }

  reset(): void {
    this.resumeFollowUps();
  }

  clearFollowUps(agent: QueueRuntimeAgent | undefined): boolean {
    if (!agent) return false;
    const hadFollowUps = this.hasFollowUps(agent);
    const hadPausedFollowUps = this.followUpPaused;
    if (agent.clearQueuedMessages) {
      agent.clearQueuedMessages('followUp');
    } else {
      agent.clearFollowUpQueue?.();
    }
    this.resumeFollowUps();
    return hadFollowUps || hadPausedFollowUps;
  }

  clearAll(agent: QueueRuntimeAgent | undefined): boolean {
    if (!agent) return false;
    const hadQueuedMessages = this.hasAnyQueuedMessages(agent);
    const hadPausedFollowUps = this.followUpPaused;
    if (agent.clearQueuedMessages) {
      agent.clearQueuedMessages();
    } else {
      agent.clearAllQueues?.();
    }
    this.resumeFollowUps();
    return hadQueuedMessages || hadPausedFollowUps;
  }

  cancelFollowUp(agent: QueueRuntimeAgent | undefined, id: string): boolean {
    const cancelled =
      agent?.removeQueuedMessage?.(id, 'followUp') !== undefined ||
      agent?.cancelFollowUp?.(id) === true;
    if (cancelled) {
      this.clearPauseIfNoFollowUps(agent);
    }
    return cancelled;
  }

  promoteFollowUp(agent: QueueRuntimeAgent | undefined, id: string): boolean {
    const promoted =
      agent?.moveQueuedMessage?.(id, 'followUp', 'steer') === true ||
      agent?.promoteFollowUp?.(id) === true;
    if (promoted) {
      this.clearPauseIfNoFollowUps(agent);
    }
    return promoted;
  }

  hasContinuationMessages(
    agent: QueueRuntimeAgent | undefined,
    policy: QueueContinuationPolicy = {},
  ): boolean {
    if (!agent) return false;
    if (policy.preserveFollowUps) {
      return agent.hasQueuedMessages?.('steer') ?? agent.hasSteeringMessages?.() ?? false;
    }
    return this.hasAnyQueuedMessages(agent);
  }

  private hasAnyQueuedMessages(agent: QueueRuntimeAgent | undefined): boolean {
    return (
      agent?.hasQueuedMessages?.() ??
      this.getQueueEntries(agent, 'steer').length + this.getQueueEntries(agent, 'followUp').length >
        0
    );
  }

  private hasFollowUps(agent: QueueRuntimeAgent | undefined): boolean {
    return (
      agent?.hasQueuedMessages?.('followUp') ?? this.getQueueEntries(agent, 'followUp').length > 0
    );
  }

  private clearPauseIfNoFollowUps(agent: QueueRuntimeAgent | undefined): void {
    if (this.hasFollowUps(agent)) return;
    this.resumeFollowUps();
  }

  private getQueueEntries(
    agent: QueueRuntimeAgent | undefined,
    delivery: QueuedAgentMessageDelivery,
  ): QueuedAgentMessage[] {
    if (!agent) return [];
    const entries = agent.getQueuedMessages
      ? agent.getQueuedMessages(delivery)
      : delivery === 'followUp'
        ? (agent.getFollowUpQueue?.() ?? [])
        : (agent.getSteeringQueue?.() ?? []);
    return entries.map((entry) => ({ ...entry, delivery }));
  }
}
