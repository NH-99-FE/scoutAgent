// ============================================================
// event-mapper.test.ts — mapAgentEventToScout 单元测试
// ============================================================

import { describe, expect, it } from 'vitest';
import { mapAgentEventToScout } from '../../protocol/agent-event-mapper.ts';
import type { AgentEvent } from '@scout-agent/agent';
import type { ScoutAssistantMessage } from '@scout-agent/shared';

// ---------- 夹具：AgentMessage ----------

function makeUserMessage(text: string) {
  return {
    role: 'user' as const,
    content: text,
    timestamp: Date.now(),
  };
}

function makeAssistantMessage(
  overrides?: Partial<{
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'thinking'; thinking: string; redacted?: boolean }
      | { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> }
    >;
  }>,
) {
  return {
    role: 'assistant' as const,
    content: overrides?.content ?? [{ type: 'text' as const, text: 'response' }],
    api: 'openai-responses' as const,
    provider: 'openai',
    model: 'gpt-4o-mini',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop' as const,
    timestamp: Date.now(),
  };
}

function makeToolResultMessage(
  overrides?: Partial<{
    toolCallId: string;
    toolName: string;
    content: Array<{ type: 'text'; text: string }>;
    isError: boolean;
  }>,
) {
  return {
    role: 'toolResult' as const,
    toolCallId: overrides?.toolCallId ?? 'tc-1',
    toolName: overrides?.toolName ?? 'echo',
    content: overrides?.content ?? [{ type: 'text' as const, text: 'result text' }],
    details: {},
    isError: overrides?.isError ?? false,
    timestamp: Date.now(),
  };
}

function makeAgentToolResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    details: {},
  };
}

// ---------- 测试 ----------

describe('mapAgentEventToScout', () => {
  it("maps agent_start to { type: 'agent_start' }", () => {
    const event: AgentEvent = { type: 'agent_start' };
    expect(mapAgentEventToScout(event)).toEqual({ type: 'agent_start' });
  });

  it("maps agent_end to { type: 'agent_end' }", () => {
    const event: AgentEvent = { type: 'agent_end', messages: [] };
    expect(mapAgentEventToScout(event)).toEqual({ type: 'agent_end' });
  });

  it("maps turn_start to { type: 'turn_start' }", () => {
    const event: AgentEvent = { type: 'turn_start' };
    expect(mapAgentEventToScout(event)).toEqual({ type: 'turn_start' });
  });

  it("maps turn_end to { type: 'turn_end' }", () => {
    const event: AgentEvent = {
      type: 'turn_end',
      message: makeAssistantMessage(),
      toolResults: [],
    };
    expect(mapAgentEventToScout(event)).toEqual({ type: 'turn_end' });
  });

  it('maps message_start with UserMessage (text string) to ScoutUserMessage', () => {
    const message = makeUserMessage('hello');
    const event: AgentEvent = { type: 'message_start', message };
    const result = mapAgentEventToScout(event);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('message_start');
    if (result?.type === 'message_start') {
      expect(result.message.role).toBe('user');
      expect((result.message as ScoutAssistantMessage).content).toBe('hello');
      expect(typeof (result.message as any).timestamp).toBe('number');
    }
  });

  it('maps message_start with AssistantMessage (text block) to ScoutAssistantMessage', () => {
    const message = makeAssistantMessage({ content: [{ type: 'text', text: 'some response' }] });
    const event: AgentEvent = { type: 'message_start', message };
    const result = mapAgentEventToScout(event);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('message_start');
    if (result?.type === 'message_start') {
      expect(result.message.role).toBe('assistant');
      expect((result.message as ScoutAssistantMessage).content).toEqual([
        { type: 'text', text: 'some response' },
      ]);
    }
  });

  it('maps message_update with AssistantMessage (text + thinking blocks) to content with both block types', () => {
    const message = makeAssistantMessage({
      content: [
        { type: 'text', text: 'visible text' },
        { type: 'thinking', thinking: 'internal thought', redacted: false },
      ],
    });
    const event: AgentEvent = {
      type: 'message_update',
      message,
      assistantMessageEvent: { type: 'start', partial: message },
    };
    const result = mapAgentEventToScout(event);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('message_update');
    if (result?.type === 'message_update') {
      expect(result.message.role).toBe('assistant');
      const content = (result.message as ScoutAssistantMessage).content as Array<{ type: string }>;
      expect(content.some((c) => c.type === 'text')).toBe(true);
      expect(content.some((c) => c.type === 'thinking')).toBe(true);
    }
  });

  it('maps message_end with ToolResultMessage to ScoutToolResultMessage', () => {
    const message = makeToolResultMessage({ toolCallId: 'tc-1', toolName: 'echo', isError: false });
    const event: AgentEvent = { type: 'message_end', message };
    const result = mapAgentEventToScout(event);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('message_end');
    if (result?.type === 'message_end') {
      expect(result.message.role).toBe('toolResult');
      expect((result.message as any).toolCallId).toBe('tc-1');
      expect((result.message as any).toolName).toBe('echo');
    }
  });

  it('returns null for message_start with custom role', () => {
    const customMessage = {
      role: 'custom' as any,
      content: 'custom content',
      timestamp: Date.now(),
    };
    const event: AgentEvent = { type: 'message_start', message: customMessage };
    expect(mapAgentEventToScout(event)).toBeNull();
  });

  it('maps tool_execution_start with toolCallId, toolName, args', () => {
    const event: AgentEvent = {
      type: 'tool_execution_start',
      toolCallId: 'tc-42',
      toolName: 'my_tool',
      args: { key: 'value' },
    };
    const result = mapAgentEventToScout(event);
    expect(result).toEqual({
      type: 'tool_execution_start',
      toolCallId: 'tc-42',
      toolName: 'my_tool',
      args: { key: 'value' },
    });
  });

  it('maps tool_execution_update with AgentToolResult partialResult converted to string', () => {
    const event: AgentEvent = {
      type: 'tool_execution_update',
      toolCallId: 'tc-1',
      toolName: 'echo',
      args: {},
      partialResult: makeAgentToolResult('partial output'),
    };
    const result = mapAgentEventToScout(event);
    expect(result).toEqual({
      type: 'tool_execution_update',
      toolCallId: 'tc-1',
      toolName: 'echo',
      partialResult: 'partial output',
    });
  });

  it('maps tool_execution_end with AgentToolResult result converted to string and isError forwarded', () => {
    const event: AgentEvent = {
      type: 'tool_execution_end',
      toolCallId: 'tc-1',
      toolName: 'echo',
      result: makeAgentToolResult('final result'),
      isError: false,
    };
    const result = mapAgentEventToScout(event);
    expect(result).toEqual({
      type: 'tool_execution_end',
      toolCallId: 'tc-1',
      toolName: 'echo',
      result: 'final result',
      isError: false,
    });
  });

  it('maps tool_execution_end with empty content to empty result string', () => {
    const event: AgentEvent = {
      type: 'tool_execution_end',
      toolCallId: 'tc-2',
      toolName: 'noop',
      result: { content: [], details: {} },
      isError: true,
    };
    const result = mapAgentEventToScout(event);
    expect(result).toEqual({
      type: 'tool_execution_end',
      toolCallId: 'tc-2',
      toolName: 'noop',
      result: '',
      isError: true,
    });
  });
});
