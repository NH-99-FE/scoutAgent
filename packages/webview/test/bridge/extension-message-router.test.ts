import { afterEach, describe, expect, it } from 'vitest';
import { routeExtensionMessage } from '@/bridge/extension-message-router';
import { useConfigStore } from '@/store/config-store';
import { useConversationStore } from '@/store/conversation-store';
import { useSessionStore } from '@/store/session-store';
import { useTaskStore } from '@/store/task-store';
import { useTreeStore } from '@/store/tree-store';
import { useUiStore } from '@/store/ui-store';

describe('routeExtensionMessage', () => {
  afterEach(() => {
    useConfigStore.getState().actions.reset();
    useConversationStore.getState().actions.reset();
    useSessionStore.getState().actions.reset();
    useTaskStore.getState().actions.reset();
    useTreeStore.getState().actions.reset();
    useUiStore.getState().actions.reset();
  });

  it('routes state and config updates into domain stores', () => {
    routeExtensionMessage({
      type: 'config_update',
      config: {
        models: [
          {
            provider: 'openai',
            id: 'gpt-test',
            name: 'GPT Test',
            reasoning: true,
            input: ['text'],
            contextWindow: 1000,
          },
        ],
        defaultModelProvider: 'openai',
        defaultModelId: 'gpt-test',
        branchSummary: { reserveTokens: 100, skipPrompt: false },
      },
    });
    routeExtensionMessage({
      type: 'state_update',
      state: {
        messages: [{ role: 'user', content: 'hello', timestamp: 1 }],
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
      },
    });

    expect(useConfigStore.getState().config?.defaultModelId).toBe('gpt-test');
    expect(useConversationStore.getState().messages).toHaveLength(1);
    expect(useSessionStore.getState().modelId).toBe('gpt-test');
  });

  it('routes tree and task data into their stores', () => {
    routeExtensionMessage({
      type: 'tree_data',
      leafId: 'leaf-1',
      tree: [
        {
          id: 'leaf-1',
          parentId: null,
          timestamp: '2026-01-01T00:00:00.000Z',
          type: 'message',
          children: [],
        },
      ],
    });
    routeExtensionMessage({
      type: 'tasks_data',
      query: 'hello',
      requestId: 'request-1',
      tasks: [
        {
          id: 'task-1',
          sessionId: 'session-1',
          sessionPath: '/session.jsonl',
          title: 'hello',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(useTreeStore.getState().leafId).toBe('leaf-1');
    expect(useTaskStore.getState().tasks).toHaveLength(1);
    expect(useTaskStore.getState().query).toBe('hello');
  });

  it('clears retry busy state when auto retry ends', () => {
    routeExtensionMessage({
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 100,
      errorMessage: 'temporary failure',
    });
    routeExtensionMessage({
      type: 'auto_retry_end',
      success: false,
      attempt: 1,
      finalError: 'cancelled',
    });

    expect(useConversationStore.getState().busyState).toEqual({
      kind: 'idle',
      cancellable: false,
    });
    expect(useConversationStore.getState().isStreaming).toBe(false);
  });

  it('clears compaction busy state when compaction ends without retry', () => {
    routeExtensionMessage({ type: 'compaction_start', reason: 'manual' });
    routeExtensionMessage({
      type: 'compaction_end',
      reason: 'manual',
      aborted: true,
      willRetry: false,
    });

    expect(useConversationStore.getState().busyState).toEqual({
      kind: 'idle',
      cancellable: false,
    });
    expect(useConversationStore.getState().isStreaming).toBe(false);
  });

  it('switches compaction busy state to retry when compaction will retry', () => {
    routeExtensionMessage({ type: 'compaction_start', reason: 'overflow' });
    routeExtensionMessage({
      type: 'compaction_end',
      reason: 'overflow',
      aborted: false,
      willRetry: true,
    });

    expect(useConversationStore.getState().busyState).toEqual({
      kind: 'retry',
      label: 'Retrying',
      cancellable: true,
      reason: 'overflow',
    });
    expect(useConversationStore.getState().isStreaming).toBe(true);
  });
});
