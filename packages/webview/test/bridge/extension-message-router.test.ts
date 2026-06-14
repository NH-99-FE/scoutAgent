import { afterEach, describe, expect, it } from 'vitest';
import { routeExtensionMessage } from '@/bridge/extension-message-router';
import { beginProtocolRequest, resetProtocolRequests } from '@/bridge/request-tracker';
import { useConfigStore } from '@/store/config-store';
import { HOME_COMPOSER_SESSION_ID, useComposerStore } from '@/store/composer-store';
import { useConversationStore } from '@/store/conversation-store';
import { useSessionStore } from '@/store/session-store';
import { useTaskStore } from '@/store/task-store';
import { useTreeStore } from '@/store/tree-store';
import { useUiStore } from '@/store/ui-store';
import type { ScoutImageContent } from '@scout-agent/shared';

const TEST_IMAGE: ScoutImageContent = {
  type: 'image',
  data: 'aW1hZ2U=',
  mimeType: 'image/png',
};

describe('routeExtensionMessage', () => {
  afterEach(() => {
    useConfigStore.getState().actions.reset();
    useComposerStore.getState().actions.reset();
    useConversationStore.getState().actions.reset();
    useSessionStore.getState().actions.reset();
    useTaskStore.getState().actions.reset();
    useTreeStore.getState().actions.reset();
    useUiStore.getState().actions.reset();
    resetProtocolRequests();
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
      type: 'task_history_data',
      query: '',
      requestId: 'recent-1',
      purpose: 'recent',
      tasks: [
        {
          id: 'task-1',
          sessionId: 'session-1',
          sessionPath: '/session.jsonl',
          title: 'hello',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      offset: 0,
      hasMore: false,
      nextOffset: 1,
    });
    useTaskStore.getState().actions.beginHistorySearch({
      query: '',
      requestId: 'history-1',
      offset: 0,
    });
    routeExtensionMessage({
      type: 'task_history_data',
      query: '',
      requestId: 'history-1',
      purpose: 'panel',
      tasks: [
        {
          id: 'task-2',
          sessionId: 'session-2',
          sessionPath: '/session-2.jsonl',
          title: 'history',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      offset: 0,
      hasMore: false,
      nextOffset: 1,
    });

    expect(useTreeStore.getState().leafId).toBe('leaf-1');
    expect(useTaskStore.getState().recentTasks).toHaveLength(1);
    expect(useTaskStore.getState().historyTasks).toHaveLength(1);
    expect(useTaskStore.getState().historyTasks[0]?.title).toBe('history');
  });

  it('routes queue updates without replacing conversation messages', () => {
    routeExtensionMessage({
      type: 'state_update',
      state: {
        messages: [{ role: 'user', content: 'hello', timestamp: 1 }],
        isStreaming: false,
        busyState: { kind: 'idle', cancellable: false },
        queueState: { messages: [], followUps: [], paused: false },
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
    routeExtensionMessage({
      type: 'queue_update',
      queueState: {
        paused: true,
        pauseReason: 'aborted',
        messages: [{ id: 'follow-1', delivery: 'followUp', text: '继续处理', timestamp: 2 }],
        followUps: [{ id: 'follow-1', text: '继续处理', timestamp: 2 }],
      },
    });

    expect(useConversationStore.getState().messages).toEqual([
      { role: 'user', content: 'hello', timestamp: 1 },
    ]);
    expect(useConversationStore.getState().queueState.paused).toBe(true);
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

  it('routes new session results into chat navigation and home draft state', () => {
    useComposerStore.getState().actions.addImages(HOME_COMPOSER_SESSION_ID, [TEST_IMAGE]);
    useComposerStore.getState().actions.setText(HOME_COMPOSER_SESSION_ID, 'draft');
    const requestId = beginProtocolRequest('new_session_message');
    useUiStore.getState().actions.beginNewSessionRequest();

    routeExtensionMessage({ type: 'new_session_result', requestId, success: true });

    expect(useUiStore.getState().chatView).toBe('detail');
    expect(useUiStore.getState().newSessionPending).toBe(false);
    expect(useComposerStore.getState().imagesBySessionId[HOME_COMPOSER_SESSION_ID]).toBeUndefined();
    expect(useComposerStore.getState().textBySessionId[HOME_COMPOSER_SESSION_ID]).toBeUndefined();
  });

  it('keeps the home draft when new session creation fails', () => {
    useComposerStore.getState().actions.addImages(HOME_COMPOSER_SESSION_ID, [TEST_IMAGE]);
    useComposerStore.getState().actions.setText(HOME_COMPOSER_SESSION_ID, 'draft');
    const requestId = beginProtocolRequest('new_session_message');
    useUiStore.getState().actions.beginNewSessionRequest();

    routeExtensionMessage({
      type: 'new_session_result',
      requestId,
      success: false,
      error: 'failed',
    });

    expect(useUiStore.getState().chatView).toBe('home');
    expect(useUiStore.getState().newSessionPending).toBe(false);
    expect(useComposerStore.getState().imagesBySessionId[HOME_COMPOSER_SESSION_ID]).toEqual([
      TEST_IMAGE,
    ]);
    expect(useComposerStore.getState().textBySessionId[HOME_COMPOSER_SESSION_ID]).toBe('draft');
  });

  it('ignores stale new session results', () => {
    useComposerStore.getState().actions.setText(HOME_COMPOSER_SESSION_ID, 'draft');
    beginProtocolRequest('new_session_message');
    useUiStore.getState().actions.beginNewSessionRequest();

    routeExtensionMessage({ type: 'new_session_result', requestId: 'request-1', success: true });

    expect(useUiStore.getState().chatView).toBe('auto');
    expect(useUiStore.getState().newSessionPending).toBe(true);
    expect(useComposerStore.getState().textBySessionId[HOME_COMPOSER_SESSION_ID]).toBe('draft');
  });

  it('keeps task navigation pending until the matching state update arrives', () => {
    const staleRequestId = beginProtocolRequest('open_task');
    useUiStore.getState().actions.beginOpenTask('/sessions/one.jsonl');
    const currentRequestId = beginProtocolRequest('open_task');
    useUiStore.getState().actions.beginOpenTask('/sessions/two.jsonl');

    routeExtensionMessage({
      type: 'open_task_result',
      requestId: staleRequestId,
      sessionPath: '/sessions/one.jsonl',
      success: true,
    });
    routeExtensionMessage({
      type: 'open_task_result',
      requestId: currentRequestId,
      sessionPath: '/sessions/two.jsonl',
      success: true,
    });

    expect(useUiStore.getState().chatView).toBe('home');
    expect(useUiStore.getState().openingTaskSessionPath).toBe('/sessions/two.jsonl');

    routeExtensionMessage({
      type: 'state_update',
      state: {
        messages: [{ role: 'user', content: 'two', timestamp: 1 }],
        isStreaming: false,
        busyState: { kind: 'idle', cancellable: false },
        modelProvider: 'openai',
        modelId: 'gpt-test',
        thinkingLevel: 'off',
        tools: [],
        activeToolNames: [],
        commands: [],
        sessionId: 'session-2',
        sessionFile: '/sessions/two.jsonl',
        cwd: '/workspace',
      },
    });

    expect(useUiStore.getState().chatView).toBe('detail');
    expect(useUiStore.getState().openingTaskSessionPath).toBeUndefined();
  });
});
