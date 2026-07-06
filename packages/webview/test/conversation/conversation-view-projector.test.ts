import { describe, expect, it } from 'vitest';
import type { ScoutBusyState } from '@scout-agent/shared';
import { createConversationViewProjector } from '@/features/conversation/render-model/conversation-view-projector';
import type { ConversationItem } from '@/store/conversation-store';

const AGENT_BUSY_STATE: ScoutBusyState = { kind: 'agent', label: 'Working', cancellable: true };

describe('createConversationViewProjector', () => {
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
    const projector = createConversationViewProjector();

    const firstRows = projector.project({
      isStreaming: true,
      busyState: AGENT_BUSY_STATE,
      toolExecutionsById: {},
      toolPreviewsById: {},
      transcriptAddons: [],
      items: [
        { key: 'user-1', message: firstUserMessage },
        { key: 'assistant-1', message: settledAssistantMessage },
        { key: 'user-2', message: streamingUserMessage },
        { key: 'assistant-2', message: streamingAssistantStart },
      ],
    });
    const nextRows = projector.project({
      isStreaming: true,
      busyState: AGENT_BUSY_STATE,
      toolExecutionsById: {},
      toolPreviewsById: {},
      transcriptAddons: [],
      items: [
        { key: 'user-1', message: firstUserMessage },
        { key: 'assistant-1', message: settledAssistantMessage },
        { key: 'user-2', message: streamingUserMessage },
        { key: 'assistant-2', message: streamingAssistantUpdate },
      ],
    });

    expect(nextRows[0]).toBe(firstRows[0]);
    expect(nextRows[1]).toBe(firstRows[1]);
    expect(nextRows[2]).toBe(firstRows[2]);
    expect(nextRows[3]).not.toBe(firstRows[3]);
  });
});
