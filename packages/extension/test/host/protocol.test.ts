import { describe, expect, it } from 'vitest';
import {
  convertMessage,
  mapAgentEventToScout,
} from '../../src/host/protocol/agent-event-mapper.ts';
import { assistantMessage, userMessage } from '../core/test-utils.ts';

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
});
