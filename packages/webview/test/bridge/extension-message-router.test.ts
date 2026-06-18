import { afterEach, describe, expect, it } from 'vitest';
import { projectTaskHistoryUpdate } from '@/bridge/extension-event-projector';
import { routeExtensionMessage } from '@/bridge/extension-message-router';
import { projectProtocolResponsePayload } from '@/bridge/protocol-response-projector';
import { resetProtocolTransport } from '@/bridge/transport-client';
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
    resetProtocolTransport();
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
      type: 'tree_update',
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
      type: 'task_history_update',
      query: '',
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
      queryToken: 'history-1',
      offset: 0,
    });
    projectTaskHistoryUpdate(
      {
        type: 'task_history_update',
        query: '',
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
      },
      'history-1',
    );

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

  it('routes runtime state updates into the conversation store', () => {
    routeExtensionMessage({
      type: 'runtime_state_update',
      isStreaming: true,
      busyState: {
        kind: 'retry',
        label: 'Retrying',
        cancellable: true,
        attempt: 1,
        maxAttempts: 3,
        reason: 'temporary failure',
      },
    });
    expect(useConversationStore.getState().busyState).toEqual({
      kind: 'retry',
      label: 'Retrying',
      cancellable: true,
      attempt: 1,
      maxAttempts: 3,
      reason: 'temporary failure',
    });
    expect(useConversationStore.getState().isStreaming).toBe(true);

    routeExtensionMessage({
      type: 'runtime_state_update',
      isStreaming: false,
      busyState: {
        kind: 'idle',
        cancellable: false,
      },
    });

    expect(useConversationStore.getState().busyState).toEqual({
      kind: 'idle',
      cancellable: false,
    });
    expect(useConversationStore.getState().isStreaming).toBe(false);
  });

  it('keeps retry and compaction events from deriving busy state in the webview', () => {
    routeExtensionMessage({ type: 'compaction_start', reason: 'overflow' });
    routeExtensionMessage({
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 100,
      errorMessage: 'retry',
    });

    expect(useConversationStore.getState().busyState).toEqual({
      kind: 'idle',
      cancellable: false,
    });
    expect(useConversationStore.getState().isStreaming).toBe(false);
  });

  it('routes new session results into chat navigation and home draft state', () => {
    useComposerStore.getState().actions.addImages(HOME_COMPOSER_SESSION_ID, [TEST_IMAGE]);
    useComposerStore.getState().actions.setText(HOME_COMPOSER_SESSION_ID, 'draft');
    useUiStore.getState().actions.beginNewSessionRequest();

    projectProtocolResponsePayload({ type: 'new_session_result', success: true });

    expect(useUiStore.getState().chatView).toBe('detail');
    expect(useUiStore.getState().newSessionPending).toBe(false);
    expect(useComposerStore.getState().imagesBySessionId[HOME_COMPOSER_SESSION_ID]).toBeUndefined();
    expect(useComposerStore.getState().textBySessionId[HOME_COMPOSER_SESSION_ID]).toBeUndefined();
  });

  it('keeps the home draft when new session creation fails', () => {
    useComposerStore.getState().actions.addImages(HOME_COMPOSER_SESSION_ID, [TEST_IMAGE]);
    useComposerStore.getState().actions.setText(HOME_COMPOSER_SESSION_ID, 'draft');
    useUiStore.getState().actions.beginNewSessionRequest();

    projectProtocolResponsePayload({
      type: 'new_session_result',
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

  it('restores an optimistically cleared home draft when new session creation fails', () => {
    useComposerStore.getState().actions.stagePendingDraft(HOME_COMPOSER_SESSION_ID, {
      text: 'pending draft',
      images: [TEST_IMAGE],
    });
    useComposerStore.getState().actions.clearDraft(HOME_COMPOSER_SESSION_ID);
    useUiStore.getState().actions.beginNewSessionRequest();

    projectProtocolResponsePayload({
      type: 'new_session_result',
      success: false,
      error: 'failed',
    });

    expect(useComposerStore.getState().imagesBySessionId[HOME_COMPOSER_SESSION_ID]).toEqual([
      TEST_IMAGE,
    ]);
    expect(useComposerStore.getState().textBySessionId[HOME_COMPOSER_SESSION_ID]).toBe(
      'pending draft',
    );
  });

  it('does not overwrite a newer home draft when a pending new session fails', () => {
    useComposerStore
      .getState()
      .actions.stagePendingDraft(HOME_COMPOSER_SESSION_ID, { text: 'old draft' });
    useComposerStore.getState().actions.setText(HOME_COMPOSER_SESSION_ID, 'new draft');
    useUiStore.getState().actions.beginNewSessionRequest();

    projectProtocolResponsePayload({
      type: 'new_session_result',
      success: false,
      error: 'failed',
    });

    expect(useComposerStore.getState().textBySessionId[HOME_COMPOSER_SESSION_ID]).toBe('new draft');
  });

  it('ignores stale new session results', () => {
    useComposerStore.getState().actions.setText(HOME_COMPOSER_SESSION_ID, 'draft');
    useUiStore.getState().actions.beginNewSessionRequest();

    routeExtensionMessage({
      type: 'protocol_response',
      requestId: 'stale-request',
      payload: { type: 'new_session_result', success: true },
    });

    expect(useUiStore.getState().chatView).toBe('auto');
    expect(useUiStore.getState().newSessionPending).toBe(true);
    expect(useComposerStore.getState().textBySessionId[HOME_COMPOSER_SESSION_ID]).toBe('draft');
  });

  it('keeps task navigation pending until the matching state update arrives', () => {
    useUiStore.getState().actions.beginOpenTask('/sessions/one.jsonl');
    useUiStore.getState().actions.beginOpenTask('/sessions/two.jsonl');

    projectProtocolResponsePayload({
      type: 'open_task_result',
      sessionPath: '/sessions/one.jsonl',
      success: true,
    });
    projectProtocolResponsePayload({
      type: 'open_task_result',
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
