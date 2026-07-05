import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import type { ScoutAgentEvent } from '@scout-agent/shared';
import type { ScoutSessionEvent } from '../../../src/host/session-coordinator.ts';
import { SessionEventForwarder } from '../../../src/host/protocol/session-event-forwarder.ts';
import type {
  CaptureWritePreviewBase,
  ComputeEditPreview,
  ComputeWritePreview,
  ToolCallPreviewContext,
} from '../../../src/host/protocol/tool-call-preview-projector.ts';

function makeForwarder(
  options: {
    isStreaming?: () => boolean;
    getPreviewContext?: () => ToolCallPreviewContext;
    computeEditPreview?: ComputeEditPreview;
    computeWritePreview?: ComputeWritePreview;
    captureWritePreviewBase?: CaptureWritePreviewBase;
    agentEventFlushDelayMs?: number;
  } = {},
) {
  const publishEvent = vi.fn();
  const pushState = vi.fn(async () => undefined);
  const pushQueueState = vi.fn();
  const pushTreeData = vi.fn(async () => undefined);
  const forwarder = new SessionEventForwarder({
    isStreaming: options.isStreaming ?? (() => false),
    publishEvent,
    pushState,
    pushQueueState,
    pushTreeData,
    getPreviewContext: options.getPreviewContext,
    computeEditPreview: options.computeEditPreview,
    computeWritePreview: options.computeWritePreview,
    captureWritePreviewBase: options.captureWritePreviewBase,
    agentEventFlushDelayMs: options.agentEventFlushDelayMs,
  });
  return { forwarder, publishEvent, pushState, pushQueueState, pushTreeData };
}

function assistantMessage(text: string) {
  return {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text }],
    timestamp: 1,
  };
}

function messageUpdate(messageId: string, text: string): ScoutSessionEvent {
  return {
    type: 'agent_event',
    event: {
      type: 'message_update',
      messageId,
      message: assistantMessage(text),
    },
  } as unknown as ScoutSessionEvent;
}

function editToolCallEvent(): ScoutAgentEvent {
  return {
    type: 'message_update',
    messageId: 'assistant-1',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: 'tool-1',
          name: 'edit',
          arguments: {
            path: 'src/app.ts',
            edits: [{ oldText: 'old', newText: 'new' }],
          },
        },
      ],
      timestamp: 1,
    },
  };
}

function editToolCallMessageUpdate(): ScoutSessionEvent {
  return {
    type: 'agent_event',
    event: editToolCallEvent(),
  } as unknown as ScoutSessionEvent;
}

function writeToolCallEvent(): ScoutAgentEvent {
  return {
    type: 'message_update',
    messageId: 'assistant-1',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: 'tool-1',
          name: 'write',
          arguments: {
            path: 'src/generated.ts',
            content: 'line 1\nline 2\n',
          },
        },
      ],
      timestamp: 1,
    },
  };
}

function writeToolCallMessageUpdate(): ScoutSessionEvent {
  return {
    type: 'agent_event',
    event: writeToolCallEvent(),
  } as unknown as ScoutSessionEvent;
}

function resolvedWorkspacePath(path: string): string {
  return resolve('/workspace', path);
}

describe('SessionEventForwarder', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks agent busy state and falls back to streaming state while idle', () => {
    let streaming = true;
    const { forwarder, publishEvent } = makeForwarder({
      isStreaming: () => streaming,
    });

    expect(forwarder.getBusyState()).toEqual({
      kind: 'agent',
      label: 'Working',
      cancellable: true,
    });

    forwarder.handle({
      type: 'agent_event',
      event: { type: 'agent_start' },
    } as unknown as ScoutSessionEvent);
    streaming = false;

    expect(forwarder.getBusyState()).toEqual({
      kind: 'agent',
      label: 'Working',
      cancellable: true,
    });
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'runtime_state_update',
      isStreaming: true,
      busyState: {
        kind: 'agent',
        label: 'Working',
        cancellable: true,
      },
    });
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'agent_event',
      event: { type: 'agent_start' },
    });

    forwarder.handle({
      type: 'agent_event',
      event: { type: 'agent_end', willRetry: false },
    } as unknown as ScoutSessionEvent);

    expect(forwarder.getBusyState()).toEqual({ kind: 'idle', cancellable: false });
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'runtime_state_update',
      isStreaming: false,
      busyState: { kind: 'idle', cancellable: false },
    });
  });

  it('keeps retry busy after an agent end that will retry', () => {
    const { forwarder, publishEvent } = makeForwarder();

    forwarder.handle({
      type: 'agent_event',
      event: { type: 'agent_start' },
    } as unknown as ScoutSessionEvent);
    forwarder.handle({
      type: 'agent_event',
      event: { type: 'agent_end', willRetry: true },
    } as unknown as ScoutSessionEvent);

    expect(forwarder.getBusyState()).toEqual({
      kind: 'retry',
      label: 'Retrying',
      cancellable: true,
    });
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'runtime_state_update',
      isStreaming: true,
      busyState: {
        kind: 'retry',
        label: 'Retrying',
        cancellable: true,
      },
    });
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'agent_event',
      event: { type: 'agent_end', willRetry: true },
    });
  });

  it('coalesces high-frequency message updates before publishing to the webview', () => {
    vi.useFakeTimers();
    const { forwarder, publishEvent } = makeForwarder({ agentEventFlushDelayMs: 16 });

    for (let i = 0; i < 100; i += 1) {
      forwarder.handle(messageUpdate('assistant-1', `chunk-${i}`));
    }

    expect(publishEvent).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);

    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'agent_event',
      event: {
        type: 'message_update',
        messageId: 'assistant-1',
        message: assistantMessage('chunk-99'),
      },
    });
  });

  it('projects edit previews from raw message updates before coalesced webview publishing', () => {
    vi.useFakeTimers();
    const computeEditPreview: ComputeEditPreview = vi.fn(() => new Promise<never>(() => undefined));
    const { forwarder, publishEvent } = makeForwarder({
      agentEventFlushDelayMs: 16,
      getPreviewContext: () => ({
        generation: 1,
        sessionId: 'session-1',
        sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
        cwd: '/workspace',
        tools: {
          edit: {
            active: true,
            source: 'builtin',
            path: '<builtin:edit>',
          },
        },
      }),
      computeEditPreview,
    });

    forwarder.handle(editToolCallMessageUpdate());

    expect(computeEditPreview).toHaveBeenCalledWith(
      'src/app.ts',
      [{ oldText: 'old', newText: 'new' }],
      '/workspace',
    );
    expect(publishEvent).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);

    expect(publishEvent).toHaveBeenCalledWith({
      type: 'agent_event',
      event: editToolCallEvent(),
    });
  });

  it('projects write progress from raw message updates before coalesced webview publishing', () => {
    vi.useFakeTimers();
    const computeWritePreview: ComputeWritePreview = vi.fn(
      () => new Promise<never>(() => undefined),
    );
    const { forwarder, publishEvent } = makeForwarder({
      agentEventFlushDelayMs: 16,
      getPreviewContext: () => ({
        generation: 1,
        sessionId: 'session-1',
        sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
        cwd: '/workspace',
        tools: {
          write: {
            active: true,
            source: 'builtin',
            path: '<builtin:write>',
          },
        },
      }),
      computeWritePreview,
    });

    forwarder.handle(writeToolCallMessageUpdate());

    expect(computeWritePreview).not.toHaveBeenCalled();
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'tool_call_preview_update',
      sessionId: 'session-1',
      sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
      toolCallId: 'tool-1',
      toolName: 'write',
      preview: {
        kind: 'file_edit',
        path: resolvedWorkspacePath('src/generated.ts'),
        displayPath: 'src/generated.ts',
        additions: 2,
        deletions: 0,
      },
    });

    vi.advanceTimersByTime(16);

    expect(publishEvent).toHaveBeenCalledWith({
      type: 'agent_event',
      event: writeToolCallEvent(),
    });
  });

  it('passes write baseline capture overrides to the preview projector', () => {
    const captureWritePreviewBase: CaptureWritePreviewBase = vi.fn(
      () => new Promise<never>(() => undefined),
    );
    const { forwarder } = makeForwarder({
      getPreviewContext: () => ({
        generation: 1,
        sessionId: 'session-1',
        sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
        cwd: '/workspace',
        tools: {
          write: {
            active: true,
            source: 'builtin',
            path: '<builtin:write>',
          },
        },
      }),
      captureWritePreviewBase,
    });

    forwarder.handle(writeToolCallMessageUpdate());

    expect(captureWritePreviewBase).toHaveBeenCalledWith('src/generated.ts', '/workspace');
  });

  it('publishes message_end immediately and drops any pending update for the same message', () => {
    vi.useFakeTimers();
    const { forwarder, publishEvent } = makeForwarder({ agentEventFlushDelayMs: 16 });

    forwarder.handle(messageUpdate('assistant-1', 'partial'));
    forwarder.handle({
      type: 'agent_event',
      event: {
        type: 'message_end',
        messageId: 'assistant-1',
        message: assistantMessage('final'),
      },
    } as unknown as ScoutSessionEvent);

    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'agent_event',
      event: {
        type: 'message_end',
        messageId: 'assistant-1',
        message: assistantMessage('final'),
      },
    });

    vi.advanceTimersByTime(16);

    expect(publishEvent).toHaveBeenCalledTimes(1);
  });

  it('drops pending message updates when a new agent run starts', () => {
    vi.useFakeTimers();
    const { forwarder, publishEvent } = makeForwarder({ agentEventFlushDelayMs: 16 });

    forwarder.handle(messageUpdate('assistant-old', 'old partial'));
    forwarder.handle({
      type: 'agent_event',
      event: { type: 'agent_start' },
    } as unknown as ScoutSessionEvent);

    expect(publishEvent).toHaveBeenCalledTimes(2);
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'runtime_state_update',
      isStreaming: true,
      busyState: {
        kind: 'agent',
        label: 'Working',
        cancellable: true,
      },
    });
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'agent_event',
      event: { type: 'agent_start' },
    });

    vi.advanceTimersByTime(16);

    expect(publishEvent).toHaveBeenCalledTimes(2);
  });

  it('drops pending message updates before pushing a state snapshot', () => {
    vi.useFakeTimers();
    const { forwarder, publishEvent, pushState } = makeForwarder({ agentEventFlushDelayMs: 16 });

    forwarder.handle(messageUpdate('assistant-old', 'old partial'));
    forwarder.handle({ type: 'state_change' } as ScoutSessionEvent);

    expect(pushState).toHaveBeenCalledTimes(1);
    expect(publishEvent).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);

    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('publishes the raw idle runtime state when agent_end arrives before streaming clears', () => {
    const { forwarder, publishEvent } = makeForwarder({
      isStreaming: () => true,
    });

    forwarder.handle({
      type: 'agent_event',
      event: { type: 'agent_start' },
    } as unknown as ScoutSessionEvent);
    publishEvent.mockClear();

    forwarder.handle({
      type: 'agent_event',
      event: { type: 'agent_end', willRetry: false },
    } as unknown as ScoutSessionEvent);

    expect(publishEvent).toHaveBeenCalledWith({
      type: 'runtime_state_update',
      isStreaming: false,
      busyState: { kind: 'idle', cancellable: false },
    });
  });

  it('resets stale cancellable busy state when core state reports idle', () => {
    let streaming = true;
    const { forwarder, publishEvent } = makeForwarder({
      isStreaming: () => streaming,
    });

    forwarder.handle({
      type: 'agent_event',
      event: { type: 'agent_start' },
    } as unknown as ScoutSessionEvent);
    publishEvent.mockClear();
    streaming = false;

    forwarder.handle({ type: 'state_change' } as ScoutSessionEvent);

    expect(forwarder.getBusyState()).toEqual({ kind: 'idle', cancellable: false });
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'runtime_state_update',
      isStreaming: false,
      busyState: { kind: 'idle', cancellable: false },
    });
  });

  it('does not clear active agent busy when retry end arrives after the next agent start', () => {
    const { forwarder } = makeForwarder();

    forwarder.handle({
      type: 'auto_retry_start',
      attempt: 2,
      maxAttempts: 3,
      delayMs: 100,
      errorMessage: 'rate limit',
    } as unknown as ScoutSessionEvent);
    forwarder.handle({
      type: 'agent_event',
      event: { type: 'agent_start' },
    } as unknown as ScoutSessionEvent);
    forwarder.handle({
      type: 'auto_retry_end',
      success: true,
      attempt: 2,
    } as unknown as ScoutSessionEvent);

    expect(forwarder.getBusyState()).toEqual({
      kind: 'agent',
      label: 'Working',
      cancellable: true,
    });
  });

  it('maps retry and compaction events to webview messages and busy state', () => {
    const { forwarder, publishEvent } = makeForwarder();

    forwarder.handle({
      type: 'auto_retry_start',
      attempt: 2,
      maxAttempts: 3,
      delayMs: 100,
      errorMessage: 'rate limit',
    } as unknown as ScoutSessionEvent);

    expect(forwarder.getBusyState()).toEqual({
      kind: 'retry',
      label: 'Retrying',
      cancellable: true,
      attempt: 2,
      maxAttempts: 3,
      reason: 'rate limit',
    });
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'runtime_state_update',
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
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'auto_retry_start',
      attempt: 2,
      maxAttempts: 3,
      delayMs: 100,
      errorMessage: 'rate limit',
    });

    forwarder.handle({
      type: 'compaction_end',
      reason: 'overflow',
      result: { type: 'skipped' },
      aborted: false,
      willRetry: true,
      errorMessage: undefined,
    } as unknown as ScoutSessionEvent);

    expect(forwarder.getBusyState()).toEqual({
      kind: 'retry',
      label: 'Retrying',
      cancellable: true,
      reason: 'overflow',
    });
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'compaction_end',
      reason: 'overflow',
      result: { type: 'skipped' },
      aborted: false,
      willRetry: true,
      errorMessage: undefined,
    });
  });

  it('refreshes derived state for state, queue, tree, and error events', () => {
    const { forwarder, publishEvent, pushState, pushQueueState, pushTreeData } = makeForwarder();

    forwarder.handle({ type: 'state_change' } as ScoutSessionEvent);
    forwarder.handle({ type: 'queue_change' } as ScoutSessionEvent);
    forwarder.handle({ type: 'tree_change' } as ScoutSessionEvent);
    forwarder.handle({ type: 'error', message: 'boom' } as ScoutSessionEvent);

    expect(pushState).toHaveBeenCalledTimes(2);
    expect(pushQueueState).toHaveBeenCalledTimes(1);
    expect(pushTreeData).toHaveBeenCalledTimes(1);
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'notification',
      level: 'error',
      message: 'boom',
    });
  });

  it('forwards non-error session notifications without refreshing state', () => {
    const { forwarder, publishEvent, pushState } = makeForwarder();

    forwarder.handle({
      type: 'notification',
      level: 'warning',
      message: '当前没有可压缩的上下文',
    } as ScoutSessionEvent);

    expect(pushState).not.toHaveBeenCalled();
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'notification',
      level: 'warning',
      message: '当前没有可压缩的上下文',
    });
  });

  it('forwards active changes review updates without refreshing state', () => {
    const { forwarder, publishEvent, pushState } = makeForwarder();

    forwarder.handle({
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
    } as ScoutSessionEvent);

    expect(pushState).not.toHaveBeenCalled();
    expect(publishEvent).toHaveBeenCalledWith({
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
  });
});
