import { describe, expect, it } from 'vitest';
import type { ScoutBusyState, ScoutExtensionUIRequest } from '@scout-agent/shared';
import {
  createConversationTranscriptProjector,
  type ConversationTranscriptProjectorOptions,
} from '@/features/conversation/render-model/conversation-transcript-projector';
import { createExtensionRequestsTranscriptAddon } from '@/features/conversation/render-model/conversation-transcript-rows';
import type { ConversationItem } from '@/store/conversation-store';

const AGENT_BUSY_STATE: ScoutBusyState = { kind: 'agent', label: 'Working', cancellable: true };
const IDLE_BUSY_STATE: ScoutBusyState = { kind: 'idle', cancellable: false };

function makeProjectorOptions(
  overrides: Partial<ConversationTranscriptProjectorOptions>,
): ConversationTranscriptProjectorOptions {
  return {
    busyState: IDLE_BUSY_STATE,
    items: [],
    isStreaming: false,
    toolExecutionsById: {},
    toolPreviewsById: {},
    transcriptAddons: [],
    ...overrides,
  };
}

describe('createConversationTranscriptProjector', () => {
  it('reuses stable transcript rows while a later streaming assistant updates', () => {
    const firstUserMessage: ConversationItem['message'] = {
      role: 'user',
      content: 'first',
      timestamp: 1,
    };
    const settledAssistantMessage: ConversationItem['message'] = {
      role: 'assistant',
      content: [{ type: 'text', text: 'settled answer' }],
      timestamp: 2,
    };
    const streamingUserMessage: ConversationItem['message'] = {
      role: 'user',
      content: 'second',
      timestamp: 3,
    };
    const streamingAssistantStart: ConversationItem['message'] = {
      role: 'assistant',
      content: [{ type: 'text', text: 'hel' }],
      timestamp: 4,
    };
    const streamingAssistantUpdate: ConversationItem['message'] = {
      role: 'assistant',
      content: [{ type: 'text', text: 'hello' }],
      timestamp: 4,
    };
    const projector = createConversationTranscriptProjector();

    const firstRows = projector.project(
      makeProjectorOptions({
        isStreaming: true,
        busyState: AGENT_BUSY_STATE,
        items: [
          { key: 'user-1', message: firstUserMessage },
          { key: 'assistant-1', message: settledAssistantMessage },
          { key: 'user-2', message: streamingUserMessage },
          { key: 'assistant-2', message: streamingAssistantStart },
        ],
      }),
    );
    const nextRows = projector.project(
      makeProjectorOptions({
        isStreaming: true,
        busyState: AGENT_BUSY_STATE,
        items: [
          { key: 'user-1', message: firstUserMessage },
          { key: 'assistant-1', message: settledAssistantMessage },
          { key: 'user-2', message: streamingUserMessage },
          { key: 'assistant-2', message: streamingAssistantUpdate },
        ],
      }),
    );

    expect(nextRows[0]).toBe(firstRows[0]);
    expect(nextRows[1]).toBe(firstRows[1]);
    expect(nextRows[2]).toBe(firstRows[2]);
    expect(nextRows[3]).not.toBe(firstRows[3]);
  });

  it('keeps extension addons before runtime status rows', () => {
    const request: ScoutExtensionUIRequest = {
      type: 'extension_ui_request',
      id: 'approval-1',
      method: 'confirm',
      title: 'Approve command',
      message: 'Proceed?',
    };
    const addon = createExtensionRequestsTranscriptAddon([request]);
    const projector = createConversationTranscriptProjector();

    const rows = projector.project(
      makeProjectorOptions({
        busyState: {
          kind: 'retry',
          label: 'Retrying',
          cancellable: true,
          attempt: 2,
          maxAttempts: 3,
          reason: 'rate limit',
        },
        items: [
          {
            key: 'system-1',
            message: {
              role: 'custom',
              customType: 'System',
              content: 'hello',
              timestamp: 1,
            },
          },
        ],
        transcriptAddons: addon ? [addon] : [],
      }),
    );

    expect(rows.map((row) => row.type)).toEqual(['system', 'extension_requests', 'runtime_status']);
    expect(rows[1]).toMatchObject({ requests: [request] });
    expect(rows[2]).toMatchObject({ label: '正在重试 2/3', detail: 'rate limit' });
  });

  it('reuses stable runtime status rows and invalidates them when display fields change', () => {
    const projector = createConversationTranscriptProjector();
    const busyState: ScoutBusyState = {
      kind: 'retry',
      label: 'Retrying',
      cancellable: true,
      attempt: 2,
      maxAttempts: 3,
      reason: 'rate limit',
    };

    const firstRows = projector.project(makeProjectorOptions({ busyState }));
    const stableRows = projector.project(makeProjectorOptions({ busyState: { ...busyState } }));
    const nextRows = projector.project(
      makeProjectorOptions({
        busyState: {
          ...busyState,
          attempt: 3,
        },
      }),
    );

    expect(stableRows).toBe(firstRows);
    expect(stableRows[0]).toBe(firstRows[0]);
    expect(nextRows).not.toBe(stableRows);
    expect(nextRows[0]).not.toBe(stableRows[0]);
    expect(nextRows[0]).toMatchObject({ label: '正在重试 3/3' });
  });
});
