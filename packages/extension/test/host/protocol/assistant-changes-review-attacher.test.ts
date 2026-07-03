// ============================================================
// AssistantChangesReviewAttacher — assistant review 摘要装饰器测试
// ============================================================

import { describe, expect, it } from 'vitest';
import type { ScoutChangesReviewSummary, ScoutMessage } from '@scout-agent/shared';
import { attachAssistantChangesReviews } from '../../../src/host/protocol/assistant-changes-review-attacher.ts';

function makeSummary(turnId: string, additions: number): ScoutChangesReviewSummary {
  return {
    turnId,
    fileCount: 1,
    additions,
    deletions: 0,
    files: [
      {
        path: `/workspace/${turnId}.ts`,
        displayPath: `${turnId}.ts`,
        additions,
        deletions: 0,
      },
    ],
  };
}

describe('attachAssistantChangesReviews', () => {
  it('attaches resolved review summaries to the assistant message that owns the tool call', () => {
    const messages: ScoutMessage[] = [
      { role: 'user', content: 'edit app', timestamp: 1 },
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'tool-1',
            name: 'edit',
            arguments: { path: '/workspace/src/app.ts' },
          },
          {
            type: 'toolCall',
            id: 'tool-2',
            name: 'edit',
            arguments: { path: '/workspace/src/other.ts' },
          },
        ],
        timestamp: 2,
      },
      {
        role: 'toolResult',
        toolCallId: 'tool-1',
        toolName: 'edit',
        content: [],
        details: {
          kind: 'file_change',
          path: '/workspace/src/app.ts',
          additions: 1,
          deletions: 0,
          review: { turnId: 'turn-1', recordId: 'record-1' },
        },
        isError: false,
        timestamp: 3,
      },
      {
        role: 'toolResult',
        toolCallId: 'tool-2',
        toolName: 'edit',
        content: [],
        details: {
          kind: 'file_change',
          path: '/workspace/src/other.ts',
          additions: 2,
          deletions: 0,
          review: { turnId: 'turn-1', recordId: 'record-2' },
        },
        isError: false,
        timestamp: 4,
      },
    ];

    const projected = attachAssistantChangesReviews(messages, {
      resolveChangesReviewSummary: (turnId) =>
        turnId === 'turn-1' ? makeSummary('turn-1', 3) : undefined,
    });

    expect(projected[1]).toMatchObject({
      role: 'assistant',
      changesReviews: [makeSummary('turn-1', 3)],
    });
  });

  it('keeps messages unchanged when no review summary can be resolved', () => {
    const messages: ScoutMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'tool-1', name: 'edit', arguments: { path: 'src/app.ts' } },
        ],
        timestamp: 1,
      },
      {
        role: 'toolResult',
        toolCallId: 'tool-1',
        toolName: 'edit',
        content: [],
        details: {
          kind: 'file_change',
          path: '/workspace/src/app.ts',
          additions: 1,
          deletions: 0,
          review: { turnId: 'turn-1', recordId: 'record-1' },
        },
        isError: false,
        timestamp: 2,
      },
    ];

    expect(
      attachAssistantChangesReviews(messages, {
        resolveChangesReviewSummary: () => undefined,
      }),
    ).toBe(messages);
  });
});
