import { afterEach, describe, expect, it } from 'vitest';
import { projectTaskHistoryUpdate } from '@/bridge/extension-event-projector';
import { routeExtensionMessage } from '@/bridge/extension-message-router';
import { projectProtocolResponsePayload } from '@/bridge/protocol-response-projector';
import { resetProtocolTransport } from '@/bridge/transport-client';
import { useConfigStore } from '@/store/config-store';
import { registerComposerImageFile } from '@/store/composer-image-registry';
import { HOME_COMPOSER_SESSION_ID, useComposerStore } from '@/store/composer-store';
import type { ComposerImageDescriptor } from '@/store/composer-store';
import { EMPTY_COMPOSER_DOCUMENT, getComposerPlainText } from '@/store/composer-document';
import { useConversationStore } from '@/store/conversation-store';
import { useRuntimeOverlayStore } from '@/store/runtime-overlay-store';
import { useSessionStore } from '@/store/session-store';
import { useTaskStore } from '@/store/task-store';
import { useTreeStore } from '@/store/tree-store';
import { useUiStore } from '@/store/ui-store';

function makeComposerImageDescriptor(name = 'test-image.png'): ComposerImageDescriptor {
  const file = new File(['image'], name, { type: 'image/png' });
  return registerComposerImageFile(file, file.type);
}

function getHomeComposerText(): string {
  const document =
    useComposerStore.getState().documentBySessionId[HOME_COMPOSER_SESSION_ID] ??
    EMPTY_COMPOSER_DOCUMENT;
  return getComposerPlainText(document);
}

describe('routeExtensionMessage', () => {
  afterEach(() => {
    useConfigStore.getState().actions.reset();
    useComposerStore.getState().actions.reset();
    useConversationStore.getState().actions.reset();
    useRuntimeOverlayStore.getState().actions.reset();
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
            supportedThinkingLevels: ['off', 'low', 'medium', 'high'],
            input: ['text'],
            contextWindow: 1000,
          },
        ],
        defaultModelProvider: 'openai',
        defaultModelId: 'gpt-test',
        defaultToolProfileId: 'develop',
        toolProfiles: [],
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

  it('routes active changes review updates into the conversation store', () => {
    routeExtensionMessage({
      type: 'state_update',
      state: {
        messages: [{ role: 'user', content: 'hello', timestamp: 1 }],
        isStreaming: true,
        busyState: { kind: 'agent', label: 'Working', cancellable: true },
        modelProvider: 'openai',
        modelId: 'gpt-test',
        thinkingLevel: 'off',
        tools: [],
        activeToolNames: [],
        commands: [],
        sessionId: 'session-1',
        sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
        cwd: '/workspace',
      },
    });
    routeExtensionMessage({
      type: 'changes_review_update',
      sessionId: 'session-1',
      sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
      changesReview: {
        turnId: 'turn-1',
        fileCount: 1,
        additions: 19,
        deletions: 19,
        files: [{ path: 'src/app.ts', additions: 19, deletions: 19 }],
      },
    });

    expect(useConversationStore.getState().activeChangesReview).toEqual({
      turnId: 'turn-1',
      fileCount: 1,
      additions: 19,
      deletions: 19,
      files: [{ path: 'src/app.ts', additions: 19, deletions: 19 }],
    });
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

  it('ignores late message updates after message_end', () => {
    routeExtensionMessage({
      type: 'agent_event',
      event: {
        type: 'message_start',
        messageId: 'assistant-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hel' }],
          timestamp: 1,
        },
      },
    });
    routeExtensionMessage({
      type: 'agent_event',
      event: {
        type: 'message_end',
        messageId: 'assistant-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'final aborted text' }],
          stopReason: 'aborted',
          timestamp: 1,
        },
      },
    });

    routeExtensionMessage({
      type: 'agent_event',
      event: {
        type: 'message_update',
        messageId: 'assistant-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'late stale update' }],
          timestamp: 1,
        },
      },
    });

    expect(useConversationStore.getState().messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'final aborted text' }],
        stopReason: 'aborted',
        timestamp: 1,
      },
    ]);
  });

  it('hides the next assistant runtime message and matching snapshot after local abort', () => {
    const previousMessages = [
      { role: 'user' as const, content: 'previous prompt', timestamp: 1 },
      {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'previous answer' }],
        timestamp: 2,
        entryId: 'assistant-old',
      },
    ];

    routeExtensionMessage({
      type: 'state_update',
      state: {
        messages: previousMessages,
        isStreaming: true,
        busyState: { kind: 'agent', label: 'Working', cancellable: true },
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
    useRuntimeOverlayStore.getState().actions.beginLocalAbort();

    routeExtensionMessage({
      type: 'agent_event',
      event: {
        type: 'message_start',
        messageId: 'assistant-new',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'new partial' }],
          timestamp: 3,
        },
      },
    });
    routeExtensionMessage({
      type: 'agent_event',
      event: {
        type: 'message_end',
        messageId: 'assistant-new',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'new final' }],
          stopReason: 'aborted',
          timestamp: 3,
        },
      },
    });
    routeExtensionMessage({
      type: 'state_update',
      state: {
        messages: [
          ...previousMessages,
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'new final' }],
            stopReason: 'aborted',
            timestamp: 3,
            entryId: 'assistant-new-entry',
          },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'unrelated same-timestamp answer' }],
            stopReason: 'aborted',
            timestamp: 3,
            entryId: 'assistant-other-entry',
          },
        ],
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

    expect(useConversationStore.getState().messages).toEqual([
      ...previousMessages,
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'unrelated same-timestamp answer' }],
        stopReason: 'aborted',
        timestamp: 3,
        entryId: 'assistant-other-entry',
      },
    ]);
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

  it('routes tool call preview updates into the conversation store', () => {
    routeExtensionMessage({
      type: 'state_update',
      state: {
        messages: [],
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
    routeExtensionMessage({
      type: 'tool_call_preview_update',
      sessionId: 'session-1',
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

    expect(useConversationStore.getState().toolPreviewsById['tool-1']).toMatchObject({
      toolCallId: 'tool-1',
      toolName: 'edit',
      preview: {
        kind: 'file_edit',
        path: 'src/app.ts',
        additions: 1,
        deletions: 1,
      },
    });
  });

  it('routes new session results into chat navigation and home draft state', () => {
    useComposerStore
      .getState()
      .actions.addImages(HOME_COMPOSER_SESSION_ID, [makeComposerImageDescriptor()]);
    useComposerStore.getState().actions.setText(HOME_COMPOSER_SESSION_ID, 'draft');
    useUiStore.getState().actions.beginNewSessionRequest();

    projectProtocolResponsePayload({ type: 'new_session_result', success: true });

    expect(useUiStore.getState().chatView).toBe('detail');
    expect(useUiStore.getState().newSessionPending).toBe(false);
    expect(useComposerStore.getState().imagesBySessionId[HOME_COMPOSER_SESSION_ID]).toBeUndefined();
    expect(
      useComposerStore.getState().documentBySessionId[HOME_COMPOSER_SESSION_ID],
    ).toBeUndefined();
  });

  it('keeps the home draft when new session creation fails', () => {
    const image = makeComposerImageDescriptor();
    useComposerStore.getState().actions.addImages(HOME_COMPOSER_SESSION_ID, [image]);
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
      image,
    ]);
    expect(getHomeComposerText()).toBe('draft');
  });

  it('restores an optimistically cleared home draft when new session creation fails', () => {
    const image = makeComposerImageDescriptor();
    useComposerStore.getState().actions.stagePendingDraft(HOME_COMPOSER_SESSION_ID, {
      document: {
        segments: [
          {
            reference: {
              commandName: 'skill:request-refactor-plan',
              id: 'skill:request-refactor-plan',
              kind: 'skill',
              path: '/skills/request-refactor-plan/SKILL.md',
            },
            type: 'reference',
          },
          { text: 'pending draft', type: 'text' },
        ],
      },
      images: [image],
    });
    useComposerStore.getState().actions.clearDraft(HOME_COMPOSER_SESSION_ID);
    useUiStore.getState().actions.beginNewSessionRequest();

    projectProtocolResponsePayload({
      type: 'new_session_result',
      success: false,
      error: 'failed',
    });

    expect(useComposerStore.getState().imagesBySessionId[HOME_COMPOSER_SESSION_ID]).toMatchObject([
      {
        id: image.id,
        mimeType: image.mimeType,
        name: image.name,
        size: image.size,
        type: 'image',
      },
    ]);
    expect(getHomeComposerText()).toBe('pending draft');
    expect(
      useComposerStore.getState().documentBySessionId[HOME_COMPOSER_SESSION_ID]?.segments[0],
    ).toEqual({
      reference: {
        commandName: 'skill:request-refactor-plan',
        id: 'skill:request-refactor-plan',
        kind: 'skill',
        path: '/skills/request-refactor-plan/SKILL.md',
      },
      type: 'reference',
    });
  });

  it('does not overwrite a newer home draft when a pending new session fails', () => {
    useComposerStore.getState().actions.stagePendingDraft(HOME_COMPOSER_SESSION_ID, {
      document: { segments: [{ text: 'old draft', type: 'text' }] },
    });
    useComposerStore.getState().actions.setText(HOME_COMPOSER_SESSION_ID, 'new draft');
    useUiStore.getState().actions.beginNewSessionRequest();

    projectProtocolResponsePayload({
      type: 'new_session_result',
      success: false,
      error: 'failed',
    });

    expect(getHomeComposerText()).toBe('new draft');
  });

  it('stores fork composer command effect with the target session identity', () => {
    projectProtocolResponsePayload({
      type: 'fork_result',
      success: true,
      targetSessionId: 'fork-session-id',
      targetSessionPath: '/sessions/fork-session.jsonl',
      selectedText: 'edit this prompt',
    });

    expect(useComposerStore.getState().pendingCommandEffect).toEqual({
      kind: 'replace_text',
      source: 'fork',
      targetSession: {
        sessionId: 'fork-session-id',
        sessionPath: '/sessions/fork-session.jsonl',
      },
      text: 'edit this prompt',
    });
  });

  it('does not create fork composer command effect without a target session identity', () => {
    projectProtocolResponsePayload({
      type: 'fork_result',
      success: true,
      selectedText: 'edit this prompt',
    });

    expect(useComposerStore.getState().pendingCommandEffect).toBeNull();
  });

  it('explains that a blocked post-commit tree navigation requires recovery', () => {
    projectProtocolResponsePayload({
      type: 'navigate_tree_result',
      navigationId: 'navigation-1',
      status: 'blocked_after_commit',
      error: 'runtime reconciliation failed',
    });

    expect(useUiStore.getState().notification).toEqual({
      type: 'notification',
      level: 'error',
      message:
        'Tree navigation was committed, but runtime reconciliation failed. Reload or recover the session before continuing. Details: runtime reconciliation failed',
    });
  });

  it('shows a fallback error when a blocked user message has no detail', () => {
    projectProtocolResponsePayload({ type: 'user_message_result', status: 'blocked' });

    expect(useUiStore.getState().notification).toEqual({
      type: 'notification',
      level: 'error',
      message: 'Message was not sent: blocked',
    });
  });

  it('shows the concrete error returned for a blocked user message', () => {
    projectProtocolResponsePayload({
      type: 'user_message_result',
      status: 'blocked',
      error: 'Extension command failed',
    });

    expect(useUiStore.getState().notification).toEqual({
      type: 'notification',
      level: 'error',
      message: 'Extension command failed',
    });
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
    expect(getHomeComposerText()).toBe('draft');
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
