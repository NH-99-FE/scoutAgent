import { describe, expect, it, vi } from 'vitest';
import type { ScoutAgentEvent } from '@scout-agent/shared';
import { ToolCallPreviewProjector } from '../../../src/host/protocol/tool-call-preview-projector.ts';
import type {
  ComputeEditPreview,
  ToolCallPreviewContext,
} from '../../../src/host/protocol/tool-call-preview-projector.ts';

function makeAssistantToolEvent(
  args: Record<string, unknown>,
  overrides: Partial<{ id: string; name: string }> = {},
): ScoutAgentEvent {
  return {
    type: 'message_update',
    messageId: 'assistant-1',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: overrides.id ?? 'tool-1',
          name: overrides.name ?? 'edit',
          arguments: args,
        },
      ],
      timestamp: 1,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function makeBuiltinEditContext(
  overrides: Partial<ToolCallPreviewContext> = {},
): ToolCallPreviewContext {
  return {
    generation: 1,
    sessionId: 'session-1',
    sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
    cwd: '/workspace',
    editTool: {
      active: true,
      source: 'builtin',
      path: '<builtin:edit>',
    },
    ...overrides,
  };
}

describe('ToolCallPreviewProjector', () => {
  it('publishes a file edit preview for complete edit tool arguments', async () => {
    const publishEvent = vi.fn();
    const computeEditPreview: ComputeEditPreview = vi.fn(async () => ({
      diff: ' 1 const value = 1;\n-2 old\n+2 new',
      firstChangedLine: 2,
    }));
    const projector = new ToolCallPreviewProjector({
      getPreviewContext: () => makeBuiltinEditContext(),
      publishEvent,
      computeEditPreview,
    });

    projector.handleAgentEvent(
      makeAssistantToolEvent({
        path: 'src/app.ts',
        edits: [{ oldText: 'old', newText: 'new' }],
      }),
    );
    await flushPromises();

    expect(computeEditPreview).toHaveBeenCalledWith(
      'src/app.ts',
      [{ oldText: 'old', newText: 'new' }],
      '/workspace',
    );
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'tool_call_preview_update',
      sessionId: 'session-1',
      sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
      toolCallId: 'tool-1',
      toolName: 'edit',
      preview: {
        kind: 'file_edit',
        path: 'src/app.ts',
        diff: ' 1 const value = 1;\n-2 old\n+2 new',
        additions: 1,
        deletions: 1,
        firstChangedLine: 2,
      },
    });
  });

  it('does not compute a preview until edit arguments are complete', async () => {
    const publishEvent = vi.fn();
    const computeEditPreview: ComputeEditPreview = vi.fn(async () => ({
      diff: '',
      firstChangedLine: undefined,
    }));
    const projector = new ToolCallPreviewProjector({
      getPreviewContext: () => makeBuiltinEditContext(),
      publishEvent,
      computeEditPreview,
    });

    projector.handleAgentEvent(makeAssistantToolEvent({ path: 'src/app.ts' }));
    projector.handleAgentEvent(
      makeAssistantToolEvent(
        { path: 'src/app.ts', edits: [{ oldText: 'old', newText: 'new' }] },
        { name: 'read' },
      ),
    );
    await flushPromises();

    expect(computeEditPreview).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('deduplicates repeated updates for the same tool call arguments', async () => {
    const publishEvent = vi.fn();
    const computeEditPreview: ComputeEditPreview = vi.fn(async () => ({
      diff: '-1 old\n+1 new',
      firstChangedLine: 1,
    }));
    const projector = new ToolCallPreviewProjector({
      getPreviewContext: () => makeBuiltinEditContext(),
      publishEvent,
      computeEditPreview,
    });
    const event = makeAssistantToolEvent({
      path: 'src/app.ts',
      edits: [{ oldText: 'old', newText: 'new' }],
    });

    projector.handleAgentEvent(event);
    projector.handleAgentEvent(event);
    await flushPromises();

    expect(computeEditPreview).toHaveBeenCalledTimes(1);
    expect(publishEvent).toHaveBeenCalledTimes(1);
  });

  it('does not publish stale preview results after newer arguments arrive', async () => {
    const publishEvent = vi.fn();
    const first = deferred<{ diff: string; firstChangedLine: number | undefined }>();
    const second = deferred<{ diff: string; firstChangedLine: number | undefined }>();
    const computeEditPreview: ComputeEditPreview = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const projector = new ToolCallPreviewProjector({
      getPreviewContext: () => makeBuiltinEditContext(),
      publishEvent,
      computeEditPreview,
    });

    projector.handleAgentEvent(
      makeAssistantToolEvent({
        path: 'src/app.ts',
        edits: [{ oldText: 'old', newText: 'first' }],
      }),
    );
    projector.handleAgentEvent(
      makeAssistantToolEvent({
        path: 'src/app.ts',
        edits: [{ oldText: 'old', newText: 'second' }],
      }),
    );

    first.resolve({ diff: '-1 old\n+1 first', firstChangedLine: 1 });
    await flushPromises();
    expect(publishEvent).not.toHaveBeenCalled();

    second.resolve({ diff: '-1 old\n+1 second', firstChangedLine: 1 });
    await flushPromises();

    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        preview: expect.objectContaining({ diff: '-1 old\n+1 second' }),
      }),
    );
  });

  it('does not publish stale preview results after the session context changes', async () => {
    const publishEvent = vi.fn();
    const pending = deferred<{ diff: string; firstChangedLine: number | undefined }>();
    const computeEditPreview: ComputeEditPreview = vi.fn(() => pending.promise);
    let context = makeBuiltinEditContext();
    const projector = new ToolCallPreviewProjector({
      getPreviewContext: () => context,
      publishEvent,
      computeEditPreview,
    });

    projector.handleAgentEvent(
      makeAssistantToolEvent({
        path: 'src/app.ts',
        edits: [{ oldText: 'old', newText: 'new' }],
      }),
    );
    context = makeBuiltinEditContext({
      sessionId: 'session-2',
      sessionFile: '/workspace/.scout/sessions/session-2.jsonl',
    });

    pending.resolve({ diff: '-1 old\n+1 new', firstChangedLine: 1 });
    await flushPromises();

    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('does not publish stale preview results after the preview generation changes', async () => {
    const publishEvent = vi.fn();
    const pending = deferred<{ diff: string; firstChangedLine: number | undefined }>();
    const computeEditPreview: ComputeEditPreview = vi.fn(() => pending.promise);
    let context = makeBuiltinEditContext({ generation: 1 });
    const projector = new ToolCallPreviewProjector({
      getPreviewContext: () => context,
      publishEvent,
      computeEditPreview,
    });

    projector.handleAgentEvent(
      makeAssistantToolEvent({
        path: 'src/app.ts',
        edits: [{ oldText: 'old', newText: 'new' }],
      }),
    );
    context = makeBuiltinEditContext({ generation: 2 });

    pending.resolve({ diff: '-1 old\n+1 new', firstChangedLine: 1 });
    await flushPromises();

    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('does not publish pending previews after the edit tool identity changes', async () => {
    const publishEvent = vi.fn();
    const pending = deferred<{ diff: string; firstChangedLine: number | undefined }>();
    const computeEditPreview: ComputeEditPreview = vi.fn(() => pending.promise);
    let context = makeBuiltinEditContext();
    const projector = new ToolCallPreviewProjector({
      getPreviewContext: () => context,
      publishEvent,
      computeEditPreview,
    });

    projector.handleAgentEvent(
      makeAssistantToolEvent({
        path: 'src/app.ts',
        edits: [{ oldText: 'old', newText: 'new' }],
      }),
    );
    context = makeBuiltinEditContext({
      editTool: {
        active: true,
        source: 'project-extension',
        path: '/workspace/.scout/extensions/custom-edit.ts',
      },
    });

    pending.resolve({ diff: '-1 old\n+1 new', firstChangedLine: 1 });
    await flushPromises();

    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('does not preview extension tools that override the edit name', async () => {
    const publishEvent = vi.fn();
    const computeEditPreview: ComputeEditPreview = vi.fn(async () => ({
      diff: '-1 old\n+1 new',
      firstChangedLine: 1,
    }));
    const projector = new ToolCallPreviewProjector({
      getPreviewContext: () =>
        makeBuiltinEditContext({
          editTool: {
            active: true,
            source: 'project-extension',
            path: '/workspace/.scout/extensions/custom-edit.ts',
          },
        }),
      publishEvent,
      computeEditPreview,
    });

    projector.handleAgentEvent(
      makeAssistantToolEvent({
        path: 'src/app.ts',
        edits: [{ oldText: 'old', newText: 'new' }],
      }),
    );
    await flushPromises();

    expect(computeEditPreview).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('does not preview inactive built-in edit tools', async () => {
    const publishEvent = vi.fn();
    const computeEditPreview: ComputeEditPreview = vi.fn(async () => ({
      diff: '-1 old\n+1 new',
      firstChangedLine: 1,
    }));
    const projector = new ToolCallPreviewProjector({
      getPreviewContext: () =>
        makeBuiltinEditContext({
          editTool: {
            active: false,
            source: 'builtin',
            path: '<builtin:edit>',
          },
        }),
      publishEvent,
      computeEditPreview,
    });

    projector.handleAgentEvent(
      makeAssistantToolEvent({
        path: 'src/app.ts',
        edits: [{ oldText: 'old', newText: 'new' }],
      }),
    );
    await flushPromises();

    expect(computeEditPreview).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('publishes preview errors without throwing through the agent event flow', async () => {
    const publishEvent = vi.fn();
    const computeEditPreview: ComputeEditPreview = vi.fn(async () => ({
      error: 'Could not find the exact text',
    }));
    const projector = new ToolCallPreviewProjector({
      getPreviewContext: () => makeBuiltinEditContext(),
      publishEvent,
      computeEditPreview,
    });

    projector.handleAgentEvent(
      makeAssistantToolEvent({
        path: 'src/app.ts',
        edits: '[{"oldText":"missing","newText":"new"}]',
      }),
    );
    await flushPromises();

    expect(computeEditPreview).toHaveBeenCalledWith(
      'src/app.ts',
      [{ oldText: 'missing', newText: 'new' }],
      '/workspace',
    );
    expect(publishEvent).toHaveBeenCalledWith({
      type: 'tool_call_preview_update',
      sessionId: 'session-1',
      sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
      toolCallId: 'tool-1',
      toolName: 'edit',
      preview: {
        kind: 'file_edit',
        path: 'src/app.ts',
        additions: 0,
        deletions: 0,
        error: 'Could not find the exact text',
      },
    });
  });
});
