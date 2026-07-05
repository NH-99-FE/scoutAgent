import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import {
  ToolPreviewService,
  type CaptureWritePreviewBase,
  type ComputeEditPreview,
  type ComputeWritePreview,
  type ToolPreviewAgentEvent,
  type ToolPreviewContext,
  type ToolPreviewHandler,
} from '../../src/core/tool-preview/index.ts';

function makeAssistantToolEvent(
  args: Record<string, unknown>,
  overrides: Partial<{
    id: string;
    name: string;
    type: 'message_start' | 'message_update' | 'message_end';
  }> = {},
): ToolPreviewAgentEvent {
  return {
    type: overrides.type ?? 'message_update',
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

function makeBuiltinEditContext(overrides: Partial<ToolPreviewContext> = {}): ToolPreviewContext {
  return {
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
    ...overrides,
  };
}

function makeBuiltinWriteContext(overrides: Partial<ToolPreviewContext> = {}): ToolPreviewContext {
  return {
    ...makeBuiltinEditContext(),
    tools: {
      ...makeBuiltinEditContext().tools,
      write: {
        active: true,
        source: 'builtin',
        path: '<builtin:write>',
      },
    },
    ...overrides,
  };
}

function resolvedWorkspacePath(path: string): string {
  return resolve('/workspace', path);
}

describe('ToolPreviewService', () => {
  it('publishes a file edit preview for complete edit tool arguments', async () => {
    const publishUpdate = vi.fn();
    const computeEditPreview: ComputeEditPreview = vi.fn(async () => ({
      diff: ' 1 const value = 1;\n-2 old\n+2 new',
      firstChangedLine: 2,
    }));
    const service = new ToolPreviewService({
      getPreviewContext: () => makeBuiltinEditContext(),
      publishUpdate,
      computeEditPreview,
    });

    service.handleAgentEvent(
      makeAssistantToolEvent({
        path: '/workspace/src/app.ts',
        edits: [{ oldText: 'old', newText: 'new' }],
      }),
    );
    await flushPromises();

    expect(computeEditPreview).toHaveBeenCalledWith(
      '/workspace/src/app.ts',
      [{ oldText: 'old', newText: 'new' }],
      '/workspace',
    );
    expect(publishUpdate).toHaveBeenCalledWith({
      sessionId: 'session-1',
      sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
      toolCallId: 'tool-1',
      toolName: 'edit',
      phase: 'final',
      preview: {
        kind: 'file_edit',
        path: resolvedWorkspacePath('src/app.ts'),
        displayPath: 'src/app.ts',
        diff: ' 1 const value = 1;\n-2 old\n+2 new',
        additions: 1,
        deletions: 1,
        firstChangedLine: 2,
      },
    });
  });

  it('accepts JSON-string edit arrays and legacy oldText/newText arguments', async () => {
    const publishUpdate = vi.fn();
    const computeEditPreview: ComputeEditPreview = vi.fn(async () => ({
      diff: '-1 old\n+1 new',
      firstChangedLine: 1,
    }));
    const service = new ToolPreviewService({
      getPreviewContext: () => makeBuiltinEditContext(),
      publishUpdate,
      computeEditPreview,
    });

    service.handleAgentEvent(
      makeAssistantToolEvent({
        path: 'src/app.ts',
        edits: '[{"oldText":"old","newText":"mid"}]',
        oldText: 'mid',
        newText: 'new',
      }),
    );
    await flushPromises();

    expect(computeEditPreview).toHaveBeenCalledWith(
      'src/app.ts',
      [
        { oldText: 'old', newText: 'mid' },
        { oldText: 'mid', newText: 'new' },
      ],
      '/workspace',
    );
    expect(publishUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'final',
        preview: expect.objectContaining({
          path: resolvedWorkspacePath('src/app.ts'),
          displayPath: 'src/app.ts',
        }),
      }),
    );
  });

  it('does not publish stale preview results after newer arguments arrive', async () => {
    const publishUpdate = vi.fn();
    const first = deferred<{ diff: string; firstChangedLine: number | undefined }>();
    const second = deferred<{ diff: string; firstChangedLine: number | undefined }>();
    const computeEditPreview: ComputeEditPreview = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const service = new ToolPreviewService({
      getPreviewContext: () => makeBuiltinEditContext(),
      publishUpdate,
      computeEditPreview,
    });

    service.handleAgentEvent(
      makeAssistantToolEvent({
        path: 'src/app.ts',
        edits: [{ oldText: 'old', newText: 'first' }],
      }),
    );
    service.handleAgentEvent(
      makeAssistantToolEvent({
        path: 'src/app.ts',
        edits: [{ oldText: 'old', newText: 'second' }],
      }),
    );

    first.resolve({ diff: '-1 old\n+1 first', firstChangedLine: 1 });
    await flushPromises();
    expect(publishUpdate).not.toHaveBeenCalled();

    second.resolve({ diff: '-1 old\n+1 second', firstChangedLine: 1 });
    await flushPromises();

    expect(publishUpdate).toHaveBeenCalledTimes(1);
    expect(publishUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        preview: expect.objectContaining({ diff: '-1 old\n+1 second' }),
      }),
    );
  });

  it('does not publish stale preview results after the session context changes', async () => {
    const publishUpdate = vi.fn();
    const pending = deferred<{ diff: string; firstChangedLine: number | undefined }>();
    const computeEditPreview: ComputeEditPreview = vi.fn(() => pending.promise);
    let context = makeBuiltinEditContext();
    const service = new ToolPreviewService({
      getPreviewContext: () => context,
      publishUpdate,
      computeEditPreview,
    });

    service.handleAgentEvent(
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

    expect(publishUpdate).not.toHaveBeenCalled();
  });

  it('does not preview extension tools that override built-in names', async () => {
    const publishUpdate = vi.fn();
    const computeEditPreview: ComputeEditPreview = vi.fn(async () => ({
      diff: '-1 old\n+1 new',
      firstChangedLine: 1,
    }));
    const service = new ToolPreviewService({
      getPreviewContext: () =>
        makeBuiltinEditContext({
          tools: {
            edit: {
              active: true,
              source: 'project-extension',
              path: '/workspace/.scout/extensions/custom-edit.ts',
            },
          },
        }),
      publishUpdate,
      computeEditPreview,
    });

    service.handleAgentEvent(
      makeAssistantToolEvent({
        path: 'src/app.ts',
        edits: [{ oldText: 'old', newText: 'new' }],
      }),
    );
    await flushPromises();

    expect(computeEditPreview).not.toHaveBeenCalled();
    expect(publishUpdate).not.toHaveBeenCalled();
  });

  it('publishes lightweight write progress from streaming arguments without computing a diff', async () => {
    const publishUpdate = vi.fn();
    const computeWritePreview: ComputeWritePreview = vi.fn(async () => ({
      diff: '+1 final',
      firstChangedLine: 1,
    }));
    const service = new ToolPreviewService({
      getPreviewContext: () => makeBuiltinWriteContext(),
      publishUpdate,
      computeWritePreview,
    });

    service.handleAgentEvent(
      makeAssistantToolEvent({ path: 'src/generated.ts', content: 'line 1' }, { name: 'write' }),
    );
    service.handleAgentEvent(
      makeAssistantToolEvent(
        { path: 'src/generated.ts', content: 'line 1\nline 2\n' },
        { name: 'write' },
      ),
    );
    await flushPromises();

    expect(computeWritePreview).not.toHaveBeenCalled();
    expect(publishUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        phase: 'progress',
        preview: expect.objectContaining({
          path: resolvedWorkspacePath('src/generated.ts'),
          displayPath: 'src/generated.ts',
          additions: 1,
          deletions: 0,
        }),
      }),
    );
    expect(publishUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        phase: 'progress',
        preview: expect.objectContaining({
          path: resolvedWorkspacePath('src/generated.ts'),
          displayPath: 'src/generated.ts',
          additions: 2,
          deletions: 0,
        }),
      }),
    );
  });

  it('does not serialize write content while deduplicating final previews', async () => {
    const publishUpdate = vi.fn();
    const computeWritePreview: ComputeWritePreview = vi.fn(async () => ({
      diff: '+1 final',
      firstChangedLine: 1,
    }));
    const service = new ToolPreviewService({
      getPreviewContext: () => makeBuiltinWriteContext(),
      publishUpdate,
      computeWritePreview,
    });
    const content = `secret-${'generated\n'.repeat(64)}`;
    const stringify = vi.spyOn(JSON, 'stringify');

    service.handleAgentEvent(
      makeAssistantToolEvent({ path: 'src/generated.ts', content }, { name: 'write' }),
    );
    service.handleAgentEvent(
      makeAssistantToolEvent(
        { path: 'src/generated.ts', content },
        { name: 'write', type: 'message_end' },
      ),
    );
    const stringifyCalls = stringify.mock.calls.length;
    stringify.mockRestore();
    await flushPromises();

    expect(stringifyCalls).toBe(0);
    expect(computeWritePreview).toHaveBeenCalledTimes(1);
  });

  it('computes the final write diff from the base captured during streaming', async () => {
    const publishUpdate = vi.fn();
    const base = deferred<{ oldContent: string }>();
    const captureWritePreviewBase: CaptureWritePreviewBase = vi.fn(() => base.promise);
    const service = new ToolPreviewService({
      getPreviewContext: () => makeBuiltinWriteContext(),
      publishUpdate,
      captureWritePreviewBase,
    });

    service.handleAgentEvent(
      makeAssistantToolEvent({ path: 'generated.ts', content: 'new\n' }, { name: 'write' }),
    );

    expect(captureWritePreviewBase).toHaveBeenCalledWith('generated.ts', '/workspace');
    base.resolve({ oldContent: 'old\n' });
    await flushPromises();

    service.handleAgentEvent(
      makeAssistantToolEvent(
        { path: 'generated.ts', content: 'new\n' },
        { name: 'write', type: 'message_end' },
      ),
    );
    await flushPromises();

    expect(captureWritePreviewBase).toHaveBeenCalledTimes(1);
    expect(publishUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'write',
        phase: 'final',
        preview: expect.objectContaining({
          kind: 'file_edit',
          path: resolvedWorkspacePath('generated.ts'),
          displayPath: 'generated.ts',
          diff: '-1 old\n+1 new',
          additions: 1,
          deletions: 1,
        }),
      }),
    );
  });

  it('dispatches tool calls through the registered preview handler', () => {
    const publishUpdate = vi.fn();
    const customHandler: ToolPreviewHandler = {
      toolName: 'rename',
      handleToolCall({ controller }) {
        controller.publishProgress('rename:src/old.ts', {
          kind: 'file_edit',
          path: 'src/old.ts',
          displayPath: 'src/old.ts',
          additions: 0,
          deletions: 0,
        });
      },
    };
    const service = new ToolPreviewService({
      getPreviewContext: () => makeBuiltinEditContext(),
      publishUpdate,
      additionalHandlers: [customHandler],
    });

    service.handleAgentEvent(makeAssistantToolEvent({}, { name: 'rename' }));

    expect(publishUpdate).toHaveBeenCalledWith({
      sessionId: 'session-1',
      sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
      toolCallId: 'tool-1',
      toolName: 'rename',
      phase: 'progress',
      preview: {
        kind: 'file_edit',
        path: 'src/old.ts',
        displayPath: 'src/old.ts',
        additions: 0,
        deletions: 0,
      },
    });
  });

  it('keeps default handlers when additional preview handlers are registered', async () => {
    const publishUpdate = vi.fn();
    const computeEditPreview: ComputeEditPreview = vi.fn(async () => ({
      diff: '-1 old\n+1 new',
      firstChangedLine: 1,
    }));
    const service = new ToolPreviewService({
      getPreviewContext: () =>
        makeBuiltinEditContext({
          tools: {
            ...makeBuiltinEditContext().tools,
            rename: {
              active: true,
              source: 'builtin',
              path: '<builtin:rename>',
            },
          },
        }),
      publishUpdate,
      computeEditPreview,
      additionalHandlers: [
        {
          toolName: 'rename',
          handleToolCall({ controller }) {
            controller.publishProgress('rename:src/old.ts', {
              kind: 'file_edit',
              path: 'src/old.ts',
              displayPath: 'src/old.ts',
              additions: 0,
              deletions: 0,
            });
          },
        },
      ],
    });

    service.handleAgentEvent(
      makeAssistantToolEvent({
        path: 'src/app.ts',
        edits: [{ oldText: 'old', newText: 'new' }],
      }),
    );
    service.handleAgentEvent(makeAssistantToolEvent({}, { name: 'rename' }));
    await flushPromises();

    expect(computeEditPreview).toHaveBeenCalledTimes(1);
    expect(publishUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'edit', phase: 'final' }),
    );
    expect(publishUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'rename', phase: 'progress' }),
    );
  });

  it('rejects additional handlers that shadow default handlers', () => {
    expect(
      () =>
        new ToolPreviewService({
          getPreviewContext: () => makeBuiltinEditContext(),
          publishUpdate: vi.fn(),
          additionalHandlers: [
            {
              toolName: 'write',
              handleToolCall() {
                // 测试重复注册路径，不需要执行。
              },
            },
          ],
        }),
    ).toThrow(/handlerOverrides/);
  });

  it('allows explicit handler overrides without removing other default handlers', async () => {
    const publishUpdate = vi.fn();
    const computeEditPreview: ComputeEditPreview = vi.fn(async () => ({
      diff: '-1 old\n+1 new',
      firstChangedLine: 1,
    }));
    const service = new ToolPreviewService({
      getPreviewContext: () => makeBuiltinWriteContext(),
      publishUpdate,
      computeEditPreview,
      handlerOverrides: [
        {
          toolName: 'write',
          handleToolCall({ controller }) {
            controller.publishProgress('custom-write', {
              kind: 'file_edit',
              path: 'custom.txt',
              displayPath: 'custom.txt',
              additions: 0,
              deletions: 0,
            });
          },
        },
      ],
    });

    service.handleAgentEvent(
      makeAssistantToolEvent({
        path: 'src/app.ts',
        edits: [{ oldText: 'old', newText: 'new' }],
      }),
    );
    service.handleAgentEvent(
      makeAssistantToolEvent({ path: 'src/generated.ts', content: 'new' }, { name: 'write' }),
    );
    await flushPromises();

    expect(computeEditPreview).toHaveBeenCalledTimes(1);
    expect(publishUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'edit', phase: 'final' }),
    );
    expect(publishUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'write',
        phase: 'progress',
        preview: expect.objectContaining({ path: 'custom.txt' }),
      }),
    );
  });
});
