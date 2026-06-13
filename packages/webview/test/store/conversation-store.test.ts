import { afterEach, describe, expect, it } from 'vitest';
import { useConversationStore } from '@/store/conversation-store';
import type { ScoutMessage, ScoutWebviewState } from '@scout-agent/shared';

function makeState(messages: ScoutMessage[]): ScoutWebviewState {
  return {
    messages,
    isStreaming: false,
    busyState: { kind: 'idle', cancellable: false },
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

  it('updates transient message events by protocol messageId', () => {
    const actions = useConversationStore.getState().actions;

    actions.applyAgentEvent({
      type: 'message_start',
      messageId: 'message-1',
      message: { role: 'user', content: 'hello', timestamp: 1 },
    });
    actions.applyAgentEvent({
      type: 'message_end',
      messageId: 'message-1',
      message: { role: 'user', content: 'hello', timestamp: 1 },
    });
    actions.applyAgentEvent({
      type: 'message_start',
      messageId: 'message-2',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hel' }],
        timestamp: 2,
      },
    });
    actions.applyAgentEvent({
      type: 'message_update',
      messageId: 'message-2',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
        timestamp: 2,
      },
    });
    actions.applyAgentEvent({
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

    actions.applyAgentEvent({
      type: 'message_start',
      messageId: 'message-1',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'streaming' }],
        timestamp: 2,
      },
    });

    actions.applyState(
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
    useConversationStore.getState().actions.applyState({
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
    useConversationStore.getState().actions.applyState({
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
});
