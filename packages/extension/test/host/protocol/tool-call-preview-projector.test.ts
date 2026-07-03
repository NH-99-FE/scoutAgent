import { describe, expect, it, vi } from 'vitest';
import type { ScoutAgentEvent } from '@scout-agent/shared';
import {
  ToolCallPreviewProjector,
  type ComputeEditPreview,
  type ToolCallPreviewContext,
} from '../../../src/host/protocol/tool-call-preview-projector.ts';

function makeBuiltinContext(
  overrides: Partial<ToolCallPreviewContext> = {},
): ToolCallPreviewContext {
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

function makeAssistantEvent(): ScoutAgentEvent {
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
            path: '/workspace/src/app.ts',
            edits: [{ oldText: 'old', newText: 'new' }],
          },
        },
      ],
      timestamp: 1,
    },
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ToolCallPreviewProjector', () => {
  it('forwards core preview updates as shared protocol events', async () => {
    const publishEvent = vi.fn();
    const computeEditPreview: ComputeEditPreview = vi.fn(async () => ({
      diff: '-1 old\n+1 new',
      firstChangedLine: 1,
    }));
    const projector = new ToolCallPreviewProjector({
      getPreviewContext: () => makeBuiltinContext(),
      publishEvent,
      computeEditPreview,
    });

    projector.handleAgentEvent(makeAssistantEvent());
    await flushPromises();

    expect(publishEvent).toHaveBeenCalledWith({
      type: 'tool_call_preview_update',
      sessionId: 'session-1',
      sessionFile: '/workspace/.scout/sessions/session-1.jsonl',
      toolCallId: 'tool-1',
      toolName: 'edit',
      preview: {
        kind: 'file_edit',
        path: '/workspace/src/app.ts',
        displayPath: 'src/app.ts',
        diff: '-1 old\n+1 new',
        additions: 1,
        deletions: 1,
        firstChangedLine: 1,
      },
    });
  });

  it('ignores non-assistant message events at the protocol boundary', async () => {
    const publishEvent = vi.fn();
    const computeEditPreview: ComputeEditPreview = vi.fn(async () => ({
      diff: '-1 old\n+1 new',
      firstChangedLine: 1,
    }));
    const projector = new ToolCallPreviewProjector({
      getPreviewContext: () => makeBuiltinContext(),
      publishEvent,
      computeEditPreview,
    });

    projector.handleAgentEvent({
      type: 'message_update',
      messageId: 'user-1',
      message: { role: 'user', content: 'hello', timestamp: 1 },
    });
    await flushPromises();

    expect(computeEditPreview).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  });
});
