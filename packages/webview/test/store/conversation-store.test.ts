import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useConversationForkCandidateVersion,
  useConversationItems,
  useConversationStore,
  useConversationTitle,
} from '@/store/conversation-store';
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

  it('keeps conversation read models stable across assistant stream updates', () => {
    const actions = useConversationStore.getState().actions;
    let titleRenderCount = 0;
    let forkVersionRenderCount = 0;
    const titleHook = renderHook(() => {
      titleRenderCount += 1;
      return useConversationTitle();
    });
    const forkVersionHook = renderHook(() => {
      forkVersionRenderCount += 1;
      return useConversationForkCandidateVersion();
    });

    act(() => {
      actions.applyStateSnapshot(
        makeState([
          { role: 'user', content: 'first prompt', timestamp: 1, entryId: 'user-1' },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'hel' }],
            timestamp: 2,
            entryId: 'assistant-1',
          },
        ]),
      );
    });

    expect(titleHook.result.current).toBe('first prompt');
    expect(forkVersionHook.result.current).toBe('user-1');
    expect(titleRenderCount).toBe(2);
    expect(forkVersionRenderCount).toBe(2);

    act(() => {
      actions.applyRuntimeEvent({
        type: 'message_update',
        messageId: 'assistant-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello' }],
          timestamp: 2,
          entryId: 'assistant-1',
        },
      });
    });

    expect(titleHook.result.current).toBe('first prompt');
    expect(forkVersionHook.result.current).toBe('user-1');
    expect(titleRenderCount).toBe(2);
    expect(forkVersionRenderCount).toBe(2);

    act(() => {
      actions.applyRuntimeEvent({
        type: 'message_start',
        messageId: 'user-2-runtime',
        message: { role: 'user', content: 'second prompt', timestamp: 3 },
      });
    });

    expect(titleHook.result.current).toBe('first prompt');
    expect(forkVersionHook.result.current).toBe('user-1\nuser:1:3');
    expect(titleRenderCount).toBe(2);
    expect(forkVersionRenderCount).toBe(3);
  });

  it('updates conversation read models when a runtime user message is replaced', () => {
    const actions = useConversationStore.getState().actions;

    actions.applyRuntimeEvent({
      type: 'message_start',
      messageId: 'runtime-user-1',
      message: { role: 'user', content: 'draft prompt', timestamp: 1 },
    });
    actions.applyRuntimeEvent({
      type: 'message_start',
      messageId: 'assistant-1',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'working' }],
        timestamp: 2,
      },
    });

    expect(useConversationStore.getState().conversationTitle).toBe('draft prompt');
    expect(useConversationStore.getState().forkCandidateVersion).toBe('user:0:1');

    actions.applyRuntimeEvent({
      type: 'message_update',
      messageId: 'runtime-user-1',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'persisted prompt' }],
        timestamp: 1,
        entryId: 'entry-user-1',
      },
    });

    const state = useConversationStore.getState();
    expect(state.conversationTitle).toBe('persisted prompt');
    expect(state.forkCandidateVersion).toBe('entry-user-1');
    expect(state.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'persisted prompt' }],
      timestamp: 1,
      entryId: 'entry-user-1',
    });
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

  it('rebuilds conversation read models when a snapshot replaces transient messages', () => {
    const actions = useConversationStore.getState().actions;

    actions.applyRuntimeEvent({
      type: 'message_start',
      messageId: 'runtime-user-1',
      message: { role: 'user', content: 'transient prompt', timestamp: 1 },
    });
    actions.applyRuntimeEvent({
      type: 'message_start',
      messageId: 'runtime-assistant-1',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'streaming' }],
        timestamp: 2,
      },
    });

    expect(useConversationStore.getState().conversationTitle).toBe('transient prompt');
    expect(useConversationStore.getState().forkCandidateVersion).toBe('user:0:1');

    actions.applyStateSnapshot(
      makeState([
        {
          role: 'user',
          content: 'persisted prompt',
          timestamp: 1,
          entryId: 'entry-user-1',
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'persisted answer' }],
          timestamp: 2,
          entryId: 'entry-assistant-1',
        },
      ]),
    );

    const state = useConversationStore.getState();
    expect(state.messageKeys).toEqual(['entry-user-1', 'entry-assistant-1']);
    expect(state.conversationTitle).toBe('persisted prompt');
    expect(state.forkCandidateVersion).toBe('entry-user-1');
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

  it('clears file edit previews after tool completion and agent end', () => {
    const actions = useConversationStore.getState().actions;
    actions.applyStateSnapshot(
      makeState([], {
        sessionId: 'session-1',
        sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
      }),
    );

    actions.applyRuntimeEvent({
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'edit',
      args: { path: 'src/app.ts' },
    });
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
    actions.applyRuntimeEvent({
      type: 'tool_execution_start',
      toolCallId: 'tool-running',
      toolName: 'edit',
      args: { path: 'src/other.ts' },
    });
    actions.applyRuntimeEvent({
      type: 'tool_call_preview_update',
      sessionId: 'session-1',
      sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
      toolCallId: 'tool-running',
      toolName: 'edit',
      preview: {
        kind: 'file_edit',
        path: 'src/other.ts',
        diff: '-1 old\n+1 other',
        additions: 1,
        deletions: 1,
      },
    });
    actions.applyRuntimeEvent({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'edit',
      result: {
        content: [{ type: 'text', text: 'done' }],
        details: {
          kind: 'file_change',
          path: 'src/app.ts',
          additions: 1,
          deletions: 1,
          review: { turnId: 'turn-1', recordId: 'review-1' },
        },
      },
      isError: false,
    });
    actions.applyRuntimeEvent({ type: 'agent_end', willRetry: false });

    expect(useConversationStore.getState().toolExecutionsById['tool-1']).toMatchObject({
      status: 'done',
    });
    expect(useConversationStore.getState().toolExecutionsById['tool-running']).toBeUndefined();
    expect(useConversationStore.getState().toolPreviewsById['tool-1']).toBeUndefined();
    expect(useConversationStore.getState().toolPreviewsById['tool-running']).toBeUndefined();
  });

  it('clears edit previews across snapshots because snapshots are authoritative', () => {
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

  it('updates snapshot entry ids without replacing unrelated conversation items', () => {
    const actions = useConversationStore.getState().actions;
    const userMessage: ScoutMessage = {
      role: 'user',
      content: 'hello',
      timestamp: 1,
      entryId: 'entry-user',
    };
    const assistantMessage: ScoutMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'hel' }],
      timestamp: 2,
      entryId: 'entry-assistant',
    };
    const updatedAssistantMessage: ScoutMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'hello' }],
      timestamp: 2,
      entryId: 'entry-assistant',
    };

    actions.applyStateSnapshot(makeState([userMessage, assistantMessage]));
    const previousItems = useConversationStore.getState().conversationItems;

    actions.applyRuntimeEvent({
      type: 'message_update',
      messageId: 'entry-assistant',
      message: updatedAssistantMessage,
    });

    const state = useConversationStore.getState();
    expect(state.messages).toEqual([userMessage, updatedAssistantMessage]);
    expect(state.messageKeys).toEqual(['entry-user', 'entry-assistant']);
    expect(state.conversationItems[0]).toBe(previousItems[0]);
    expect(state.conversationItems[1]).not.toBe(previousItems[1]);
    expect(state.conversationItems[1]).toEqual({
      key: 'entry-assistant',
      message: updatedAssistantMessage,
    });
  });

  it('indexes protocol message ids without object prototype collisions', () => {
    const actions = useConversationStore.getState().actions;
    const firstMessage: ScoutMessage = { role: 'user', content: 'hello', timestamp: 1 };
    const secondMessage: ScoutMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'hel' }],
      timestamp: 2,
    };
    const updatedSecondMessage: ScoutMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'hello' }],
      timestamp: 2,
    };

    actions.applyRuntimeEvent({
      type: 'message_start',
      messageId: 'constructor',
      message: firstMessage,
    });
    actions.applyRuntimeEvent({
      type: 'message_start',
      messageId: '__proto__',
      message: secondMessage,
    });
    actions.applyRuntimeEvent({
      type: 'message_update',
      messageId: '__proto__',
      message: updatedSecondMessage,
    });

    const state = useConversationStore.getState();
    expect(state.messages).toEqual([firstMessage, updatedSecondMessage]);
    expect(state.messageKeys).toEqual(['constructor', '__proto__']);
    expect(state.conversationItems).toEqual([
      { key: 'constructor', message: firstMessage },
      { key: '__proto__', message: updatedSecondMessage },
    ]);
  });

  it('skips repeated runtime updates that keep the same message reference', () => {
    const actions = useConversationStore.getState().actions;
    const message: ScoutMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'hello' }],
      timestamp: 1,
    };

    actions.applyRuntimeEvent({
      type: 'message_start',
      messageId: 'message-1',
      message,
    });

    let notificationCount = 0;
    const unsubscribe = useConversationStore.subscribe(() => {
      notificationCount += 1;
    });

    actions.applyRuntimeEvent({
      type: 'message_update',
      messageId: 'message-1',
      message,
    });
    unsubscribe();

    expect(notificationCount).toBe(0);
    expect(useConversationStore.getState().messages[0]).toBe(message);
    expect(useConversationStore.getState().conversationItems[0]?.message).toBe(message);
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
