import { describe, expect, it, vi } from 'vitest';
import { DomainEventPublisher } from '../../../src/host/protocol/domain-event-publisher.ts';

describe('DomainEventPublisher', () => {
  it('publishes extension events to the requested surface', () => {
    const postMessage = vi.fn();
    const publisher = new DomainEventPublisher({ postMessage });

    publisher.publish(
      {
        type: 'notification',
        level: 'info',
        message: 'hello',
      },
      'chat',
    );

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'notification',
        level: 'info',
        message: 'hello',
      },
      'chat',
    );
  });

  it('allows only events declared by the protocol manifest when scoped to a payload', () => {
    const postMessage = vi.fn();
    const publisher = new DomainEventPublisher({ postMessage });

    publisher.publishForProtocol('new_session_message', {
      type: 'task_history_update',
      query: '',
      purpose: 'recent',
      tasks: [],
      offset: 0,
      hasMore: false,
      nextOffset: 0,
    });

    expect(() =>
      publisher.publishForProtocol('request_config', {
        type: 'state_update',
        state: {
          messages: [],
          isStreaming: false,
          busyState: { kind: 'idle', cancellable: false },
          modelProvider: '',
          modelId: '',
          thinkingLevel: 'off',
          tools: [],
          activeToolNames: [],
          commands: [],
        },
      }),
    ).toThrow('Protocol event not declared: request_config emitted state_update');
    expect(postMessage).toHaveBeenCalledTimes(1);
  });
});
