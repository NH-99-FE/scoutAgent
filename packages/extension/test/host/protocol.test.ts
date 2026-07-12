import { describe, expect, it } from 'vitest';
import {
  convertMessage,
  mapAgentEventToScout,
} from '../../src/host/protocol/agent-event-mapper.ts';
import { AgentEventCorrelator } from '../../src/host/protocol/agent-event-correlator.ts';
import { createDisplayArguments } from '../../src/host/protocol/display-arguments.ts';
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

  it('projects display arguments for declared tool call path fields', () => {
    const message = assistantMessage('hello', {
      content: [
        {
          type: 'toolCall',
          id: 'tool-1',
          name: 'read',
          arguments: {
            path: '/workspace/src/app.ts',
            cwd: '/workspace',
            count: 1,
          },
        },
      ],
    });

    expect(
      convertMessage(message, {
        formatDisplayPath: (path) => path.replace('/workspace/', ''),
        getToolPresentation: (toolName) =>
          toolName === 'read' ? { pathArguments: ['path'] } : undefined,
      }),
    ).toMatchObject({
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          arguments: {
            path: '/workspace/src/app.ts',
            cwd: '/workspace',
            count: 1,
          },
          displayArguments: {
            path: 'src/app.ts',
            cwd: '/workspace',
            count: 1,
          },
        },
      ],
    });
  });

  it('does not guess display arguments without tool presentation metadata', () => {
    const message = assistantMessage('hello', {
      content: [
        {
          type: 'toolCall',
          id: 'tool-1',
          name: 'extension-tool',
          arguments: {
            target: '/workspace/not-necessarily-a-path',
            cwd: '/workspace',
          },
        },
      ],
    });

    expect(
      convertMessage(message, {
        formatDisplayPath: (path) => path.replace('/workspace/', ''),
      }),
    ).toMatchObject({
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          arguments: {
            target: '/workspace/not-necessarily-a-path',
            cwd: '/workspace',
          },
        },
      ],
    });
    const toolCall = convertMessage(message, {
      formatDisplayPath: (path) => path.replace('/workspace/', ''),
    });
    expect(toolCall?.role === 'assistant' ? toolCall.content[0] : undefined).not.toHaveProperty(
      'displayArguments',
    );
  });

  it('projects display arguments with tool-specific path argument declarations', () => {
    const message = assistantMessage('hello', {
      content: [
        {
          type: 'toolCall',
          id: 'tool-1',
          name: 'rename',
          arguments: {
            from: '/workspace/src/old.ts',
            to: '/workspace/src/new.ts',
            path: '/workspace/metadata.json',
          },
        },
      ],
    });

    expect(
      convertMessage(message, {
        formatDisplayPath: (path) => path.replace('/workspace/', ''),
        getToolPresentation: (toolName) =>
          toolName === 'rename' ? { pathArguments: ['from', 'to'] } : undefined,
      }),
    ).toMatchObject({
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          arguments: {
            from: '/workspace/src/old.ts',
            to: '/workspace/src/new.ts',
            path: '/workspace/metadata.json',
          },
          displayArguments: {
            from: 'src/old.ts',
            to: 'src/new.ts',
            path: '/workspace/metadata.json',
          },
        },
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

  it('uses live composer presentation instead of guessing references from text', () => {
    const message = {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: 'Review @src/a.ts。 with @alice' },
        { type: 'image' as const, data: 'base64', mimeType: 'image/png' },
      ],
      timestamp: 1,
    };
    const document = {
      segments: [
        { type: 'text' as const, text: 'Review ' },
        {
          type: 'reference' as const,
          reference: {
            fileKind: 'file' as const,
            id: 'src/a.ts',
            kind: 'file' as const,
            label: 'a.ts',
            path: 'src/a.ts',
          },
        },
        { type: 'text' as const, text: '。 with @alice' },
      ],
    };

    expect(convertMessage(message, { userMessageDetails: document })).toMatchObject({
      role: 'user',
      content: [
        { type: 'composerDocument', document },
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

  it('enriches tool result message details at the protocol boundary', () => {
    const message = convertMessage(
      {
        role: 'toolResult' as const,
        toolCallId: 'tool-1',
        toolName: 'edit',
        content: [],
        details: {
          kind: 'file_change',
          path: '/workspace/src/app.ts',
          additions: 1,
          deletions: 1,
          review: { turnId: 'turn-1', recordId: 'record-1' },
        },
        isError: false,
        timestamp: 1,
      },
      {
        enrichToolResultDetails: (details) => ({
          ...(details as Record<string, unknown>),
          diffPreview: {
            rows: [{ type: 'added', newLineNumber: 1, text: 'const value = 1;' }],
          },
        }),
      },
    );

    expect(message).toMatchObject({
      role: 'toolResult',
      details: {
        kind: 'file_change',
        diffPreview: {
          rows: [{ type: 'added', newLineNumber: 1, text: 'const value = 1;' }],
        },
      },
    });
  });

  it('enriches runtime tool execution result details at the protocol boundary', () => {
    const event = mapAgentEventToScout(
      {
        type: 'tool_execution_end',
        toolCallId: 'tool-1',
        toolName: 'edit',
        result: {
          content: [{ type: 'text', text: 'done' }],
          details: {
            kind: 'file_change',
            path: '/workspace/src/app.ts',
            additions: 1,
            deletions: 1,
            review: { turnId: 'turn-1', recordId: 'record-1' },
          },
        },
        isError: false,
      },
      {
        enrichToolResultDetails: (details) => ({
          ...(details as Record<string, unknown>),
          diffPreview: {
            rows: [{ type: 'removed', oldLineNumber: 1, text: 'old' }],
          },
        }),
      },
    );

    expect(event).toMatchObject({
      type: 'tool_execution_end',
      result: {
        details: {
          kind: 'file_change',
          diffPreview: {
            rows: [{ type: 'removed', oldLineNumber: 1, text: 'old' }],
          },
        },
      },
    });
  });

  it('does not enrich partial tool execution update details', () => {
    let enrichCount = 0;
    const event = mapAgentEventToScout(
      {
        type: 'tool_execution_update',
        toolCallId: 'tool-1',
        toolName: 'edit',
        args: {},
        partialResult: {
          content: [{ type: 'text', text: 'partial' }],
          details: {
            kind: 'file_change',
            path: '/workspace/src/app.ts',
            additions: 1,
            deletions: 1,
            review: { turnId: 'turn-1', recordId: 'record-1' },
          },
        },
      },
      {
        enrichToolResultDetails: (details) => {
          enrichCount += 1;
          return {
            ...(details as Record<string, unknown>),
            diffPreview: {
              rows: [{ type: 'added', newLineNumber: 1, text: 'should not attach' }],
            },
          };
        },
      },
    );

    expect(enrichCount).toBe(0);
    expect(event).toMatchObject({
      type: 'tool_execution_update',
      partialResult: {
        details: {
          kind: 'file_change',
          path: '/workspace/src/app.ts',
        },
      },
    });
    expect(
      event?.type === 'tool_execution_update'
        ? (event.partialResult.details as Record<string, unknown>).diffPreview
        : undefined,
    ).toBeUndefined();
  });

  it('enriches final tool result message_end details', () => {
    let enrichCount = 0;
    const event = mapAgentEventToScout(
      {
        type: 'message_end',
        message: {
          role: 'toolResult',
          toolCallId: 'tool-1',
          toolName: 'edit',
          content: [],
          details: {
            kind: 'file_change',
            path: '/workspace/src/app.ts',
            additions: 1,
            deletions: 1,
            review: { turnId: 'turn-1', recordId: 'record-1' },
          },
          isError: false,
          timestamp: 1,
        },
      } as any,
      {
        messageId: 'message-1',
        enrichToolResultDetails: (details) => {
          enrichCount += 1;
          return {
            ...(details as Record<string, unknown>),
            diffPreview: {
              rows: [{ type: 'added', newLineNumber: 1, text: 'const value = 1;' }],
            },
          };
        },
      },
    );

    expect(enrichCount).toBe(1);
    expect(event).toMatchObject({
      type: 'message_end',
      message: {
        role: 'toolResult',
        details: {
          kind: 'file_change',
          path: '/workspace/src/app.ts',
          diffPreview: {
            rows: [{ type: 'added', newLineNumber: 1, text: 'const value = 1;' }],
          },
        },
      },
    });
  });

  it('does not enrich runtime tool result message_update details', () => {
    let enrichCount = 0;
    const event = mapAgentEventToScout(
      {
        type: 'message_update',
        message: {
          role: 'toolResult',
          toolCallId: 'tool-1',
          toolName: 'edit',
          content: [],
          details: {
            kind: 'file_change',
            path: '/workspace/src/app.ts',
            additions: 1,
            deletions: 1,
            review: { turnId: 'turn-1', recordId: 'record-1' },
          },
          isError: false,
          timestamp: 1,
        },
      } as any,
      {
        messageId: 'message-1',
        enrichToolResultDetails: (details) => {
          enrichCount += 1;
          return {
            ...(details as Record<string, unknown>),
            diffPreview: {
              rows: [{ type: 'added', newLineNumber: 1, text: 'should not attach' }],
            },
          };
        },
      },
    );

    expect(enrichCount).toBe(0);
    expect(event).toMatchObject({
      type: 'message_update',
      message: {
        role: 'toolResult',
        details: {
          kind: 'file_change',
          path: '/workspace/src/app.ts',
        },
      },
    });
    expect(
      event?.type === 'message_update' && event.message.role === 'toolResult'
        ? (event.message.details as Record<string, unknown>).diffPreview
        : undefined,
    ).toBeUndefined();
  });

  it('projects display args for declared tool execution path fields', () => {
    expect(
      mapAgentEventToScout(
        {
          type: 'tool_execution_start',
          toolCallId: 'tool-1',
          toolName: 'edit',
          args: {
            filePath: '/workspace/src/app.ts',
            query: 'value',
          },
        },
        {
          formatDisplayPath: (path) => path.replace('/workspace/', ''),
          getToolPresentation: (toolName) =>
            toolName === 'edit' ? { pathArguments: ['filePath'] } : undefined,
        },
      ),
    ).toEqual({
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'edit',
      args: {
        filePath: '/workspace/src/app.ts',
        query: 'value',
      },
      displayArgs: {
        filePath: 'src/app.ts',
        query: 'value',
      },
    });
  });

  it('uses declared path argument keys for tool execution display args', () => {
    expect(
      mapAgentEventToScout(
        {
          type: 'tool_execution_start',
          toolCallId: 'tool-1',
          toolName: 'rename',
          args: {
            from: '/workspace/src/old.ts',
            to: '/workspace/src/new.ts',
            path: '/workspace/metadata.json',
          },
        },
        {
          formatDisplayPath: (path) => path.replace('/workspace/', ''),
          getToolPresentation: (toolName) =>
            toolName === 'rename' ? { pathArguments: ['from', 'to'] } : undefined,
        },
      ),
    ).toEqual({
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'rename',
      args: {
        from: '/workspace/src/old.ts',
        to: '/workspace/src/new.ts',
        path: '/workspace/metadata.json',
      },
      displayArgs: {
        from: 'src/old.ts',
        to: 'src/new.ts',
        path: '/workspace/metadata.json',
      },
    });
  });

  it('returns display arguments only when a declared path field changes', () => {
    expect(
      createDisplayArguments(
        {
          path: '/workspace/src/app.ts',
          nested: { path: '/workspace/src/inner.ts' },
          count: 1,
        },
        { formatDisplayPath: (path) => path.replace('/workspace/', '') },
      ),
    ).toBeUndefined();

    expect(
      createDisplayArguments(
        {
          path: '/workspace/src/app.ts',
          input: '/workspace/src/input.ts',
        },
        { formatDisplayPath: (path) => path.replace('/workspace/', '') },
        { pathArgumentKeys: ['input'] },
      ),
    ).toEqual({
      path: '/workspace/src/app.ts',
      input: 'src/input.ts',
    });

    expect(
      createDisplayArguments(
        { path: 'src/app.ts' },
        { formatDisplayPath: (path) => path },
        { pathArgumentKeys: ['path'] },
      ),
    ).toBeUndefined();
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
      correlator.map({ type: 'message_update', message: assistantMessage('hello') } as any, {
        sessionId: 'session-1',
      }),
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
