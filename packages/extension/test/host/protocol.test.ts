import { describe, expect, it } from 'vitest';
import {
  convertMessage,
  mapAgentEventToScout,
} from '../../src/host/protocol/agent-event-mapper.ts';
import { AgentEventCorrelator } from '../../src/host/protocol/agent-event-correlator.ts';
import type { ScoutAgentEvent } from '@scout-agent/shared';
import { assistantMessage, userMessage } from '../core/test-utils.ts';

type MessageScoutEvent = Extract<ScoutAgentEvent, { messageId: string }>;

function expectMessageEvent(event: ScoutAgentEvent | null): MessageScoutEvent {
  expect(event).not.toBeNull();
  expect(event).toHaveProperty('messageId');
  return event as MessageScoutEvent;
}

describe('agent event mapper', () => {
  it('converts assistant content into serializable Scout content', () => {
    const message = assistantMessage('hello', {
      content: [
        { type: 'thinking', thinking: 'think', redacted: false },
        { type: 'text', text: 'hello' },
        { type: 'toolCall', id: 'tool-1', name: 'read', arguments: { file: 'a.ts' } },
      ],
    });

    expect(convertMessage(message)).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'think', redacted: false },
        { type: 'text', text: 'hello' },
        { type: 'toolCall', id: 'tool-1', name: 'read', arguments: { file: 'a.ts' } },
      ],
    });
  });

  it('keeps image blocks in user messages as serializable Scout content', () => {
    const message = {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: 'visible' },
        { type: 'image' as const, data: 'base64', mimeType: 'image/png' },
      ],
      timestamp: 1,
    };

    expect(convertMessage(message)).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: 'visible' },
        { type: 'image', data: 'base64', mimeType: 'image/png' },
      ],
    });
  });

  it('maps tool execution results with content blocks and details', () => {
    const event = mapAgentEventToScout({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'read',
      result: {
        content: [
          { type: 'text', text: 'ok' },
          { type: 'image', data: 'base64', mimeType: 'image/png' },
        ],
        details: { path: 'a.png' },
      },
      isError: false,
    });

    expect(event).toEqual({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'read',
      result: {
        content: [
          { type: 'text', text: 'ok' },
          { type: 'image', data: 'base64', mimeType: 'image/png' },
        ],
        details: { path: 'a.png' },
      },
      isError: false,
    });
  });

  it('returns null for custom messages that are not part of the webview protocol', () => {
    expect(
      mapAgentEventToScout({
        type: 'message_end',
        message: {
          role: 'custom',
          customType: 'extension',
          content: 'hidden',
          display: false,
          timestamp: 1,
        },
      }),
    ).toBeNull();
  });

  it('maps visible custom messages into the webview protocol', () => {
    expect(
      convertMessage({
        role: 'custom',
        customType: 'extension',
        content: [
          { type: 'text', text: 'shown' },
          { type: 'image', data: 'base64', mimeType: 'image/png' },
        ],
        display: true,
        details: { source: 'test' },
        timestamp: 1,
      }),
    ).toEqual({
      role: 'custom',
      customType: 'extension',
      content: [
        { type: 'text', text: 'shown' },
        { type: 'image', data: 'base64', mimeType: 'image/png' },
      ],
      details: { source: 'test' },
      timestamp: 1,
    });
  });

  it('maps agent lifecycle events without leaking runtime-only payloads', () => {
    expect(mapAgentEventToScout({ type: 'agent_start' })).toEqual({ type: 'agent_start' });
    expect(
      mapAgentEventToScout({
        type: 'agent_end',
        messages: [userMessage('done')],
        willRetry: true,
      } as any),
    ).toEqual({
      type: 'agent_end',
      willRetry: true,
    });
  });

  it('requires and echoes protocol message ids for visible message events', () => {
    expect(
      mapAgentEventToScout(
        {
          type: 'message_start',
          message: userMessage('hello'),
        },
        { messageId: 'message-1' },
      ),
    ).toMatchObject({
      type: 'message_start',
      messageId: 'message-1',
      message: { role: 'user', content: 'hello' },
    });

    expect(() =>
      mapAgentEventToScout({
        type: 'message_start',
        message: userMessage('hello'),
      }),
    ).toThrow('Missing Scout protocol messageId for message_start event');
  });
});

describe('AgentEventCorrelator', () => {
  it('correlates transient message events before persistence assigns entry ids', () => {
    const correlator = new AgentEventCorrelator();

    const userStart = expectMessageEvent(
      correlator.map(
        { type: 'message_start', message: userMessage('hello') },
        { sessionId: 'session-1' },
      ),
    );
    const userEnd = expectMessageEvent(
      correlator.map(
        { type: 'message_end', message: userMessage('hello') },
        { sessionId: 'session-1' },
      ),
    );
    const assistantStart = expectMessageEvent(
      correlator.map(
        { type: 'message_start', message: assistantMessage('hel') },
        { sessionId: 'session-1' },
      ),
    );
    const assistantUpdate = expectMessageEvent(
      correlator.map(
        { type: 'message_update', message: assistantMessage('hello') } as any,
        { sessionId: 'session-1' },
      ),
    );
    const assistantEnd = expectMessageEvent(
      correlator.map(
        { type: 'message_end', message: assistantMessage('hello!') },
        { sessionId: 'session-1' },
      ),
    );

    expect(userStart.messageId).toBe('session-1:message:1');
    expect(userEnd.messageId).toBe(userStart.messageId);
    expect(assistantStart.messageId).toBe('session-1:message:2');
    expect(assistantUpdate.messageId).toBe(assistantStart.messageId);
    expect(assistantEnd.messageId).toBe(assistantStart.messageId);
  });

  it('clears active message state without reusing protocol ids', () => {
    const correlator = new AgentEventCorrelator();
    const first = expectMessageEvent(
      correlator.map(
        { type: 'message_start', message: assistantMessage('streaming') },
        { sessionId: 'session-1' },
      ),
    );

    correlator.reset();

    const next = expectMessageEvent(
      correlator.map(
        { type: 'message_start', message: userMessage('next') },
        { sessionId: 'session-1' },
      ),
    );

    expect(next.messageId).toBe('session-1:message:2');
    expect(next.messageId).not.toBe(first.messageId);
  });
});
