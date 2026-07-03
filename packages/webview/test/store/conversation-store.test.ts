import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useConversationItems, useConversationStore } from '@/store/conversation-store';
import type { ScoutBusyState, ScoutMessage, ScoutWebviewState } from '@scout-agent/shared';

function makeState(
  messages: ScoutMessage[],
  overrides: Partial<
    Pick<
      ScoutWebviewState,
      | 'isStreaming'
      | 'busyState'
      | 'queueState'
      | 'sessionId'
      | 'sessionFile'
      | 'activeChangesReview'
    >
  > = {},
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
    sessionId: overrides.sessionId ?? 'session-1',
    sessionFile: overrides.sessionFile,
    activeChangesReview: overrides.activeChangesReview,
    cwd: '/workspace',
  };
}

describe('conversation store', () => {
  afterEach(() => {
    useConversationStore.getState().actions.reset();
  });

  it('applies host runtime state separately from message events', () => {
    const actions = useConversationStore.getState().actions;

    actions.applyRuntimeState({
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
    });
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
    actions.applyRuntimeState({
      isStreaming: false,
      busyState: { kind: 'idle', cancellable: false },
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

  it('does not derive global runtime state from agent lifecycle events', () => {
    const actions = useConversationStore.getState().actions;

    actions.applyRuntimeEvent({ type: 'agent_start' });
    expect(useConversationStore.getState().isStreaming).toBe(false);
    expect(useConversationStore.getState().busyState).toEqual({ kind: 'idle', cancellable: false });

    actions.applyRuntimeEvent({
      type: 'auto_retry_start',
      attempt: 2,
      maxAttempts: 3,
      delayMs: 100,
      errorMessage: 'rate limit',
    });
    expect(useConversationStore.getState().isStreaming).toBe(false);
    expect(useConversationStore.getState().busyState).toEqual({ kind: 'idle', cancellable: false });

    actions.applyRuntimeState({
      isStreaming: true,
      busyState: {
        kind: 'retry',
        label: 'Retrying',
        cancellable: true,
        attempt: 2,
        maxAttempts: 3,
        reason: 'rate limit',
      },
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

  it('stores active changes review snapshots from host state', () => {
    useConversationStore.getState().actions.applyStateSnapshot(
      makeState([], {
        activeChangesReview: {
          turnId: 'turn-1',
          fileCount: 1,
          additions: 19,
          deletions: 19,
          files: [{ path: 'src/app.ts', additions: 19, deletions: 19 }],
        },
      }),
    );

    expect(useConversationStore.getState().activeChangesReview).toEqual({
      turnId: 'turn-1',
      fileCount: 1,
      additions: 19,
      deletions: 19,
      files: [{ path: 'src/app.ts', additions: 19, deletions: 19 }],
    });
  });

  it('applies active changes review events only for the current session', () => {
    const actions = useConversationStore.getState().actions;
    actions.applyStateSnapshot(
      makeState([], {
        sessionId: 'session-1',
        sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
      }),
    );

    actions.applyChangesReviewUpdate({
      type: 'changes_review_update',
      sessionId: 'session-other',
      sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
      changesReview: {
        turnId: 'turn-other',
        fileCount: 1,
        additions: 1,
        deletions: 1,
        files: [{ path: 'src/other.ts', additions: 1, deletions: 1 }],
      },
    });
    expect(useConversationStore.getState().activeChangesReview).toBeUndefined();

    actions.applyChangesReviewUpdate({
      type: 'changes_review_update',
      sessionId: 'session-1',
      sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
      changesReview: {
        turnId: 'turn-1',
        fileCount: 2,
        additions: 27,
        deletions: 23,
        files: [
          { path: 'src/app.ts', additions: 19, deletions: 19 },
          { path: 'src/other.ts', additions: 8, deletions: 4 },
        ],
      },
    });
    expect(useConversationStore.getState().activeChangesReview).toMatchObject({
      turnId: 'turn-1',
      fileCount: 2,
      additions: 27,
      deletions: 23,
    });

    actions.applyChangesReviewUpdate({
      type: 'changes_review_update',
      sessionId: 'session-1',
      sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
    });
    expect(useConversationStore.getState().activeChangesReview).toBeUndefined();
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

  it('stores tool call previews separately from runtime tool execution state', () => {
    const actions = useConversationStore.getState().actions;
    actions.applyStateSnapshot(
      makeState([], {
        sessionId: 'session-1',
        sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
      }),
    );

    actions.applyRuntimeEvent({
      type: 'tool_call_preview_update',
      sessionId: 'session-1',
      sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
      toolCallId: 'tool-1',
      toolName: 'edit',
      preview: {
        kind: 'file_edit',
        path: 'src/app.ts',
        diff: '-1 old\n+1 new',
        additions: 1,
        deletions: 1,
        firstChangedLine: 1,
      },
    });

    expect(useConversationStore.getState().toolPreviewsById['tool-1']).toEqual({
      toolCallId: 'tool-1',
      toolName: 'edit',
      preview: {
        kind: 'file_edit',
        path: 'src/app.ts',
        diff: '-1 old\n+1 new',
        additions: 1,
        deletions: 1,
        firstChangedLine: 1,
      },
    });
    expect(useConversationStore.getState().toolExecutionsById).toEqual({});

    actions.applyRuntimeEvent({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'edit',
      result: {
        content: [{ type: 'text', text: 'done' }],
        details: { diff: '-1 old\n+1 final', patch: '', firstChangedLine: 1 },
      },
      isError: false,
    });

    expect(useConversationStore.getState().toolExecutionsById['tool-1']?.result?.details).toEqual({
      diff: '-1 old\n+1 final',
      patch: '',
      firstChangedLine: 1,
    });
    expect(useConversationStore.getState().toolPreviewsById['tool-1']).toBeUndefined();
  });

  it('clears edit previews across snapshots because completed tool details are authoritative', () => {
    const actions = useConversationStore.getState().actions;
    actions.applyStateSnapshot(
      makeState([], {
        sessionId: 'session-1',
        sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
      }),
    );

    actions.applyRuntimeEvent({
      type: 'tool_call_preview_update',
      sessionId: 'session-1',
      sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
      toolCallId: 'tool-1',
      toolName: 'edit',
      preview: {
        kind: 'file_edit',
        path: 'src/app.ts',
        diff: '-1 old\n+1 new',
        additions: 1,
        deletions: 1,
      },
    });

    actions.applyStateSnapshot(
      makeState(
        [
          {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tool-1',
                name: 'edit',
                arguments: { path: 'src/app.ts' },
              },
            ],
            timestamp: 1,
          },
          {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'edit',
            content: [{ type: 'text', text: 'done' }],
            details: {
              kind: 'file_change',
              path: 'src/app.ts',
              additions: 1,
              deletions: 1,
              review: { turnId: 'turn-1', recordId: 'review-1' },
            },
            isError: false,
            timestamp: 2,
          },
        ],
        {
          sessionId: 'session-1',
          sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
        },
      ),
    );

    expect(useConversationStore.getState().toolPreviewsById).toEqual({});

    actions.applyStateSnapshot(
      makeState([], {
        sessionId: 'session-1',
        sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
      }),
    );

    expect(useConversationStore.getState().toolPreviewsById).toEqual({});
  });

  it('accepts same-session edit previews without a session file', () => {
    const actions = useConversationStore.getState().actions;
    actions.applyStateSnapshot(
      makeState([], {
        sessionId: 'session-1',
        sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
      }),
    );

    actions.applyRuntimeEvent({
      type: 'tool_call_preview_update',
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      toolName: 'edit',
      preview: {
        kind: 'file_edit',
        path: '/workspace/src/app.ts',
        diff: '-1 old\n+1 new',
        additions: 1,
        deletions: 1,
      },
    });

    expect(useConversationStore.getState().toolPreviewsById['tool-1']?.preview.diff).toBe(
      '-1 old\n+1 new',
    );

    actions.applyRuntimeEvent({
      type: 'tool_call_preview_update',
      sessionId: 'session-1',
      sessionFile: '/workspace/.scout/sessions/session-2.jsonl',
      toolCallId: 'tool-2',
      toolName: 'edit',
      preview: {
        kind: 'file_edit',
        path: '/workspace/src/other.ts',
        diff: '-1 old\n+1 other',
        additions: 1,
        deletions: 1,
      },
    });

    expect(useConversationStore.getState().toolPreviewsById['tool-2']).toBeUndefined();
  });

  it('rejects tool call previews that do not belong to the current session', () => {
    const actions = useConversationStore.getState().actions;
    actions.applyStateSnapshot(
      makeState([], {
        sessionId: 'session-2',
        sessionFile: '/workspace/.scout/sessions/session-2.jsonl',
      }),
    );

    actions.applyRuntimeEvent({
      type: 'tool_call_preview_update',
      sessionId: 'session-1',
      sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
      toolCallId: 'tool-1',
      toolName: 'edit',
      preview: {
        kind: 'file_edit',
        path: 'src/app.ts',
        diff: '-1 old\n+1 new',
        additions: 1,
        deletions: 1,
      },
    });

    expect(useConversationStore.getState().toolPreviewsById).toEqual({});
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
    expect(useConversationStore.getState().toolPreviewsById).toEqual({});

    actions.applyRuntimeEvent({
      type: 'tool_execution_end',
      toolCallId: 'tool-2',
      toolName: 'read',
      result: { content: [{ type: 'text', text: 'second output' }] },
      isError: false,
    });
    actions.applyRuntimeEvent({ type: 'agent_start' });
    expect(useConversationStore.getState().toolExecutionsById).toEqual({});
    expect(useConversationStore.getState().toolPreviewsById).toEqual({});
  });

  it('applies retry and compaction runtime state snapshots from the host', () => {
    const actions = useConversationStore.getState().actions;

    actions.applyRuntimeState({
      isStreaming: true,
      busyState: {
        kind: 'retry',
        label: 'Retrying',
        cancellable: true,
        attempt: 2,
        maxAttempts: 3,
        reason: 'rate limit',
      },
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

    actions.applyRuntimeState({
      isStreaming: true,
      busyState: { kind: 'agent', label: 'Working', cancellable: true },
    });
    expect(useConversationStore.getState().isStreaming).toBe(true);
    expect(useConversationStore.getState().busyState).toEqual({
      kind: 'agent',
      label: 'Working',
      cancellable: true,
    });

    actions.applyRuntimeState({
      isStreaming: true,
      busyState: {
        kind: 'compaction',
        label: 'Compacting',
        cancellable: true,
        reason: 'overflow',
      },
    });
    expect(useConversationStore.getState().isStreaming).toBe(true);
    expect(useConversationStore.getState().busyState).toEqual({
      kind: 'compaction',
      label: 'Compacting',
      cancellable: true,
      reason: 'overflow',
    });

    actions.applyRuntimeState({
      isStreaming: false,
      busyState: { kind: 'idle', cancellable: false },
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

  it('preserves unchanged conversation item references across message updates', () => {
    const actions = useConversationStore.getState().actions;

    actions.applyRuntimeEvent({
      type: 'message_start',
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

    const previousItems = useConversationStore.getState().conversationItems;

    actions.applyRuntimeEvent({
      type: 'message_update',
      messageId: 'message-2',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
        timestamp: 2,
      },
    });

    const nextItems = useConversationStore.getState().conversationItems;
    expect(nextItems[0]).toBe(previousItems[0]);
    expect(nextItems[1]).not.toBe(previousItems[1]);
    expect(nextItems[1]?.key).toBe('message-2');
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
