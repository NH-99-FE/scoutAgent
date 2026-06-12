// ============================================================
// agent-event-correlator — AgentEvent 流式消息关联
// 负责：在 Host 协议边界为 message_start/update/end 分配 transient messageId。
// ============================================================

import type { ScoutAgentEvent } from '@scout-agent/shared';
import type { AgentEvent } from '@scout-agent/agent';
import { mapAgentEventToScout } from './agent-event-mapper.ts';

export interface AgentEventCorrelationContext {
  sessionId?: string;
}

// ---------- AgentEventCorrelator ----------

export class AgentEventCorrelator {
  private sequence = 0;
  private activeMessageId: string | undefined;

  reset(): void {
    this.activeMessageId = undefined;
  }

  map(event: AgentEvent, context: AgentEventCorrelationContext = {}): ScoutAgentEvent | null {
    return mapAgentEventToScout(event, {
      messageId: this.getMessageId(event, context.sessionId),
    });
  }

  private createMessageId(sessionId: string | undefined): string {
    this.sequence += 1;
    return `${sessionId?.trim() || 'session'}:message:${this.sequence}`;
  }

  private getMessageId(event: AgentEvent, sessionId: string | undefined): string | undefined {
    if (event.type === 'agent_start' || event.type === 'agent_end') {
      this.reset();
      return undefined;
    }

    if (event.type === 'message_start') {
      this.activeMessageId = this.createMessageId(sessionId);
      return this.activeMessageId;
    }

    if (event.type === 'message_update') {
      this.activeMessageId ??= this.createMessageId(sessionId);
      return this.activeMessageId;
    }

    if (event.type === 'message_end') {
      const messageId = this.activeMessageId ?? this.createMessageId(sessionId);
      this.reset();
      return messageId;
    }

    return undefined;
  }
}
