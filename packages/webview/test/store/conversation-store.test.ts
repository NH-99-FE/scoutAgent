import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useConversationItems, useConversationStore } from '@/store/conversation-store';
import type { ScoutBusyState, ScoutMessage, ScoutWebviewState } from '@scout-agent/shared';

function makeState(
  messages: ScoutMessage[],
  overrides: Partial<Pick<ScoutWebviewState, 'isStreaming' | 'busyState' | 'queueState'>> = {},
): ScoutWebviewState {
  return {
    messages,
    isStreaming: overrides.isStreaming ?? false,
    busyState: overrides.busyState ?? ({ kind: 'idle', cancellable: false } as ScoutBusyState),
    queueState: overrides.queueState,
    modelProvider: 'openai',
    modelId: 'gpt-test',
    thinkingLevel: 'off',
    tools: [],
    activeToolNames: [],
    commands: [],
    sessionId: 'session-1',
    cwd: '/workspace',
  };
}

describe('conversation store', () => {
  afterEach(() => {
    useConversationStore.getState().actions.reset();
  });

  it('projects agent lifecycle and message events through the runtime reducer', () => {
    const actions = useConversationStore.getState().actions;

    actions.applyRuntimeEvent({ type: 'agent_start' });
    expect(useConversationStore.getState().isStreaming).toBe(true);
    expect(useConversationStore.getState().busyState).toEqual({
      kind: 'agent',
      label: 'Working',
      cancellable: true,
    });

    actions.applyRuntimeEvent({
      type: 'message_start',
      messageId: 'assistant-1',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hel' }],
        timestamp: 2,
      },
    });
    actions.applyRuntimeEvent({
      type: 'message_update',
      messageId: 'assistant-1',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
        timestamp: 2,
      },
    });
    actions.applyRuntimeEvent({
      type: 'message_end',
      messageId: 'assistant-1',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hello!' }],
        timestamp: 2,
      },
    });
    actions.applyRuntimeEvent({ type: 'agent_end', willRetry: false });

    expect(useConversationStore.getState().isStreaming).toBe(false);
    expect(useConversationStore.getState().busyState).toEqual({ kind: 'idle', cancellable: false });
    expect(useConversationStore.getState().messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'hello!' }],
        timestamp: 2,
      },
    ]);
  });

  it('updates transient message events by protocol messageId', () => {
    const actions = useConversationStore.getState().actions;

    actions.applyRuntimeEvent({
      type: 'message_start',
      messageId: 'message-1',
      message: { role: 'user', content: 'hello', timestamp: 1 },
    });
    actions.applyRuntimeEvent({
      type: 'message_end',
      messageId: 'message-1',
      message: { role: 'user', content: 'hello', timestamp: 1 },
    });
    actions.applyRuntimeEvent({
      type: 'message_start',
      messageId: 'message-2',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hel' }],
        timestamp: 2,
      },
    });
    actions.applyRuntimeEvent({
      type: 'message_update',
      messageId: 'message-2',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
        timestamp: 2,
      },
    });
    actions.applyRuntimeEvent({
      type: 'message_end',
      messageId: 'message-2',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hello!' }],
        timestamp: 2,
      },
    });

    expect(useConversationStore.getState().messages).toEqual([
      { role: 'user', content: 'hello', timestamp: 1 },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'hello!' }],
        timestamp: 2,
      },
    ]);
  });

  it('replaces transient messages with the persisted state snapshot', () => {
    const actions = useConversationStore.getState().actions;

    actions.applyRuntimeEvent({
      type: 'message_start',
      messageId: 'message-1',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'streaming' }],
        timestamp: 2,
      },
    });

    actions.applyStateSnapshot(
      makeState([
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'persisted' }],
          timestamp: 2,
          entryId: 'entry-1',
        },
      ]),
    );

    expect(useConversationStore.getState().messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'persisted' }],
        timestamp: 2,
        entryId: 'entry-1',
      },
    ]);
  });

  it('stores the follow-up queue snapshot from state updates', () => {
    useConversationStore.getState().actions.applyStateSnapshot({
      ...makeState([]),
      queueState: {
        paused: true,
        pauseReason: 'aborted',
        messages: [{ id: 'follow-1', delivery: 'followUp', text: '继续处理', timestamp: 1 }],
        followUps: [{ id: 'follow-1', text: '继续处理', timestamp: 1 }],
      },
    });

    expect(useConversationStore.getState().queueState).toEqual({
      paused: true,
      pauseReason: 'aborted',
      messages: [{ id: 'follow-1', delivery: 'followUp', text: '继续处理', timestamp: 1 }],
      followUps: [{ id: 'follow-1', text: '继续处理', timestamp: 1 }],
    });
  });

  it('applies lightweight queue updates without replacing messages', () => {
    useConversationStore.getState().actions.applyStateSnapshot({
      ...makeState([{ role: 'user', content: 'hello', timestamp: 1 }]),
      queueState: { messages: [], followUps: [], paused: false },
    });

    useConversationStore.getState().actions.applyQueueState({
      paused: true,
      pauseReason: 'aborted',
      messages: [{ id: 'follow-1', delivery: 'followUp', text: '继续处理', timestamp: 2 }],
      followUps: [{ id: 'follow-1', text: '继续处理', timestamp: 2 }],
    });

    expect(useConversationStore.getState().messages).toEqual([
      { role: 'user', content: 'hello', timestamp: 1 },
    ]);
    expect(useConversationStore.getState().queueState.paused).toBe(true);
  });

  it('tracks runtime tool execution events', () => {
    const actions = useConversationStore.getState().actions;

    actions.applyRuntimeEvent({
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'read',
      args: { path: 'README.md' },
    });
    expect(useConversationStore.getState().toolExecutionsById['tool-1']).toMatchObject({
      toolCallId: 'tool-1',
      toolName: 'read',
      args: { path: 'README.md' },
      status: 'running',
      isError: false,
    });

    actions.applyRuntimeEvent({
      type: 'tool_execution_update',
      toolCallId: 'tool-1',
      toolName: 'read',
      partialResult: {
        content: [{ type: 'text', text: 'partial output' }],
      },
    });
    expect(useConversationStore.getState().toolExecutionsById['tool-1']).toMatchObject({
      status: 'running',
      partialResult: {
        content: [{ type: 'text', text: 'partial output' }],
      },
    });

    actions.applyRuntimeEvent({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'read',
      result: {
        content: [{ type: 'text', text: 'final output' }],
      },
      isError: false,
    });
    expect(useConversationStore.getState().toolExecutionsById['tool-1']).toMatchObject({
      status: 'done',
      result: {
        content: [{ type: 'text', text: 'final output' }],
      },
      isError: false,
    });
  });

  it('does not invent empty args when tool updates arrive without a start event', () => {
    const actions = useConversationStore.getState().actions;

    actions.applyRuntimeEvent({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'bash',
      result: {
        content: [{ type: 'text', text: 'final output' }],
      },
      isError: false,
    });

    expect(useConversationStore.getState().toolExecutionsById['tool-1']).toEqual({
      toolCallId: 'tool-1',
      toolName: 'bash',
      status: 'done',
      result: {
        content: [{ type: 'text', text: 'final output' }],
      },
      isError: false,
    });
  });

  it('keeps completed runtime tool results until a snapshot or new agent starts', () => {
    const actions = useConversationStore.getState().actions;

    actions.applyRuntimeEvent({
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'read',
      args: {},
    });
    actions.applyRuntimeEvent({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'read',
      result: { content: [{ type: 'text', text: 'final output' }] },
      isError: false,
    });
    actions.applyRuntimeEvent({
      type: 'tool_execution_start',
      toolCallId: 'tool-running',
      toolName: 'grep',
      args: {},
    });
    actions.applyRuntimeEvent({ type: 'agent_end', willRetry: false });

    expect(useConversationStore.getState().toolExecutionsById['tool-1']).toMatchObject({
      status: 'done',
      result: { content: [{ type: 'text', text: 'final output' }] },
    });
    expect(useConversationStore.getState().toolExecutionsById['tool-running']).toBeUndefined();

    actions.applyStateSnapshot(makeState([]));
    expect(useConversationStore.getState().toolExecutionsById).toEqual({});

    actions.applyRuntimeEvent({
      type: 'tool_execution_end',
      toolCallId: 'tool-2',
      toolName: 'read',
      result: { content: [{ type: 'text', text: 'second output' }] },
      isError: false,
    });
    actions.applyRuntimeEvent({ type: 'agent_start' });
    expect(useConversationStore.getState().toolExecutionsById).toEqual({});
  });

  it('keeps agent busy when retry completion arrives after the next agent start', () => {
    const actions = useConversationStore.getState().actions;

    actions.applyRuntimeEvent({
      type: 'auto_retry_start',
      attempt: 2,
      maxAttempts: 3,
      delayMs: 100,
      errorMessage: 'rate limit',
    });
    expect(useConversationStore.getState().isStreaming).toBe(true);
    expect(useConversationStore.getState().busyState).toEqual({
      kind: 'retry',
      label: 'Retrying',
      cancellable: true,
      attempt: 2,
      maxAttempts: 3,
      reason: 'rate limit',
    });

    actions.applyRuntimeEvent({ type: 'agent_start' });
    actions.applyRuntimeEvent({ type: 'auto_retry_end', success: true, attempt: 2 });

    expect(useConversationStore.getState().isStreaming).toBe(true);
    expect(useConversationStore.getState().busyState).toEqual({
      kind: 'agent',
      label: 'Working',
      cancellable: true,
    });
  });

  it('projects compaction busy state and retry handoff', () => {
    const actions = useConversationStore.getState().actions;

    actions.applyRuntimeEvent({ type: 'compaction_start', reason: 'overflow' });
    expect(useConversationStore.getState().isStreaming).toBe(true);
    expect(useConversationStore.getState().busyState).toEqual({
      kind: 'compaction',
      label: 'Compacting',
      cancellable: true,
      reason: 'overflow',
    });

    actions.applyRuntimeEvent({
      type: 'compaction_end',
      reason: 'overflow',
      aborted: false,
      willRetry: true,
    });
    expect(useConversationStore.getState().isStreaming).toBe(true);
    expect(useConversationStore.getState().busyState).toEqual({
      kind: 'retry',
      label: 'Retrying',
      cancellable: true,
      reason: 'overflow',
    });

    actions.applyRuntimeEvent({ type: 'compaction_start', reason: 'manual' });
    actions.applyRuntimeEvent({
      type: 'compaction_end',
      reason: 'manual',
      aborted: true,
      willRetry: false,
      errorMessage: 'cancelled',
    });
    expect(useConversationStore.getState().isStreaming).toBe(false);
    expect(useConversationStore.getState().busyState).toEqual({ kind: 'idle', cancellable: false });
  });

  it('lets a state snapshot replace streamed runtime state', () => {
    const actions = useConversationStore.getState().actions;

    actions.applyRuntimeEvent({ type: 'agent_start' });
    actions.applyRuntimeEvent({
      type: 'message_start',
      messageId: 'assistant-1',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'streaming' }],
        timestamp: 1,
      },
    });
    actions.applyRuntimeEvent({
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'read',
      args: {},
    });

    actions.applyStateSnapshot(
      makeState(
        [
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'persisted' }],
            timestamp: 2,
            entryId: 'entry-1',
          },
        ],
        {
          isStreaming: false,
          busyState: { kind: 'idle', cancellable: false },
        },
      ),
    );

    expect(useConversationStore.getState().messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'persisted' }],
        timestamp: 2,
        entryId: 'entry-1',
      },
    ]);
    expect(useConversationStore.getState().messageKeys).toEqual(['entry-1']);
    expect(useConversationStore.getState().isStreaming).toBe(false);
    expect(useConversationStore.getState().busyState).toEqual({ kind: 'idle', cancellable: false });
    expect(useConversationStore.getState().toolExecutionsById).toEqual({});
  });

  it('exposes stable conversation item keys across message updates', () => {
    const actions = useConversationStore.getState().actions;
    const { result } = renderHook(() => useConversationItems());

    act(() => {
      actions.applyRuntimeEvent({
        type: 'message_start',
        messageId: 'message-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hel' }],
          timestamp: 1,
        },
      });
    });
    expect(result.current).toEqual([
      {
        key: 'message-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hel' }],
          timestamp: 1,
        },
      },
    ]);

    act(() => {
      actions.applyRuntimeEvent({
        type: 'message_update',
        messageId: 'message-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello' }],
          timestamp: 1,
        },
      });
    });
    expect(result.current[0]?.key).toBe('message-1');
    expect(result.current[0]?.message).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'hello' }],
      timestamp: 1,
    });
  });
});
