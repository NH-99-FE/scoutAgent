// ============================================================
// Domain event publisher — Extension broadcast event 统一出口
// 负责：集中发布 ExtensionEventMessage，并为协议 emits 约束提供单点入口。
// ============================================================

import type { ExtensionEventMessage, ScoutProtocolPayloadType } from '@scout-agent/shared';
import { SCOUT_PROTOCOL } from '@scout-agent/shared';
import type { ScoutWebviewSurface } from '../webview-surface.ts';

// ---------- 类型 ----------

export interface DomainEventPublisherOptions {
  postMessage: (message: ExtensionEventMessage, surface?: ScoutWebviewSurface) => void;
}

// ---------- Publisher ----------

export class DomainEventPublisher {
  private readonly postMessage: (
    message: ExtensionEventMessage,
    surface?: ScoutWebviewSurface,
  ) => void;

  constructor(options: DomainEventPublisherOptions) {
    this.postMessage = options.postMessage;
  }

  publish(message: ExtensionEventMessage, surface?: ScoutWebviewSurface): void {
    this.postMessage(message, surface);
  }

  publishForProtocol(
    payloadType: ScoutProtocolPayloadType,
    message: ExtensionEventMessage,
    surface?: ScoutWebviewSurface,
  ): void {
    const route = SCOUT_PROTOCOL[payloadType];
    const allowedEvents =
      'emits' in route ? (route.emits as readonly string[] | undefined) : undefined;
    if (!allowedEvents || !allowedEvents.includes(message.type)) {
      throw new Error(`Protocol event not declared: ${payloadType} emitted ${message.type}`);
    }
    this.publish(message, surface);
  }
}
