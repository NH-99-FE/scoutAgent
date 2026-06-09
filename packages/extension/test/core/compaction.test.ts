import { describe, expect, it } from 'vitest';
import {
  calculateContextTokens,
  estimateContextTokens,
  findCutPoint,
  getLastAssistantUsage,
  prepareCompaction,
  shouldCompact,
  type CompactionSettings,
} from '../../src/core/compaction/index.ts';
import type { SessionTreeEntry } from '../../src/core/session/index.ts';
import { assistantMessage, usage, userMessage } from './test-utils.ts';

let counter = 0;
let parentId: string | null = null;

function resetChain(): void {
  counter = 0;
  parentId = null;
}

function entry(message = userMessage('message')): SessionTreeEntry {
  const id = `entry-${counter++}`;
  const result: SessionTreeEntry = {
    type: 'message',
    id,
    parentId,
    timestamp: '2025-01-01T00:00:00.000Z',
    message,
  };
  parentId = id;
  return result;
}

function compaction(summary: string, firstKeptEntryId: string): SessionTreeEntry {
  const id = `entry-${counter++}`;
  const result: SessionTreeEntry = {
    type: 'compaction',
    id,
    parentId,
    timestamp: '2025-01-01T00:00:00.000Z',
    summary,
    firstKeptEntryId,
    tokensBefore: 1000,
  };
  parentId = id;
  return result;
}

describe('compaction token utilities', () => {
  it('calculates context tokens from provider usage', () => {
    expect(calculateContextTokens(usage(100, 50, 20, 10))).toBe(180);
  });

  it('uses the last successful assistant usage and skips error or aborted messages', () => {
    resetChain();
    const entries = [
      entry(userMessage('hello')),
      entry(assistantMessage('ok', { usage: usage(10, 5) })),
      entry(assistantMessage('failed', { usage: usage(500, 500), stopReason: 'error' })),
      entry(assistantMessage('aborted', { usage: usage(800, 800), stopReason: 'aborted' })),
    ];

    expect(getLastAssistantUsage(entries)).toMatchObject({ input: 10, output: 5 });
  });

  it('estimates trailing tokens after the last assistant usage', () => {
    const estimate = estimateContextTokens([
      userMessage('hello'),
      assistantMessage('ok', { usage: usage(100, 50) }),
      userMessage('x'.repeat(40)),
    ]);

    expect(estimate.usageTokens).toBe(150);
    expect(estimate.trailingTokens).toBe(10);
    expect(estimate.tokens).toBe(160);
  });

  it('respects the compaction threshold and enabled flag', () => {
    const settings: CompactionSettings = {
      enabled: true,
      reserveTokens: 1000,
      keepRecentTokens: 100,
    };

    expect(shouldCompact(9001, 10000, settings)).toBe(true);
    expect(shouldCompact(9000, 10000, settings)).toBe(false);
    expect(shouldCompact(9001, 10000, { ...settings, enabled: false })).toBe(false);
  });
});

describe('prepareCompaction', () => {
  it('selects a stable kept suffix and messages to summarize', () => {
    resetChain();
    const entries = [
      entry(userMessage('first user')),
      entry(assistantMessage('first assistant')),
      entry(userMessage('second user')),
      entry(assistantMessage('second assistant')),
      entry(userMessage('third user')),
    ];

    const preparation = prepareCompaction(entries, {
      enabled: true,
      reserveTokens: 1000,
      keepRecentTokens: 4,
    });

    expect(preparation).toBeDefined();
    expect(preparation?.firstKeptEntryId).toBe(entries[3].id);
    expect(preparation?.messagesToSummarize.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
  });

  it('uses the previous compaction summary as iterative input', () => {
    resetChain();
    const first = entry(userMessage('first'));
    entry(assistantMessage('first response'));
    compaction('previous summary', first.id);
    entry(userMessage('second'));
    entry(assistantMessage('second response'));
    entry(userMessage('third'));

    const entries = [
      first,
      {
        type: 'message',
        id: 'entry-1',
        parentId: first.id,
        timestamp: '2025-01-01T00:00:00.000Z',
        message: assistantMessage('first response'),
      },
      {
        type: 'compaction',
        id: 'entry-2',
        parentId: 'entry-1',
        timestamp: '2025-01-01T00:00:00.000Z',
        summary: 'previous summary',
        firstKeptEntryId: first.id,
        tokensBefore: 200,
      },
      {
        type: 'message',
        id: 'entry-3',
        parentId: 'entry-2',
        timestamp: '2025-01-01T00:00:00.000Z',
        message: userMessage('second'),
      },
      {
        type: 'message',
        id: 'entry-4',
        parentId: 'entry-3',
        timestamp: '2025-01-01T00:00:00.000Z',
        message: assistantMessage('second response'),
      },
    ] satisfies SessionTreeEntry[];

    const updated = prepareCompaction(entries, {
      enabled: true,
      reserveTokens: 1000,
      keepRecentTokens: 1,
    });

    expect(updated?.previousSummary).toBe('previous summary');
    expect(updated?.messagesToSummarize.map((message) => message.role)).toContain('user');
  });

  it('does not prepare compaction when the current leaf is already a compaction', () => {
    resetChain();
    const first = entry(userMessage('first'));
    const summary = compaction('summary', first.id);

    expect(
      prepareCompaction([first, summary], {
        enabled: true,
        reserveTokens: 1000,
        keepRecentTokens: 1,
      }),
    ).toBeUndefined();
  });

  it('finds a valid cut point that does not keep a trailing tool result alone', () => {
    resetChain();
    const entries = [
      entry(userMessage('first')),
      entry(
        assistantMessage('tool call', {
          content: [{ type: 'toolCall', id: 'tool-1', name: 'read', arguments: {} }],
          stopReason: 'toolUse',
        }),
      ),
      entry({
        role: 'toolResult',
        toolCallId: 'tool-1',
        toolName: 'read',
        content: [{ type: 'text', text: 'result' }],
        isError: false,
        timestamp: 3,
      }),
      entry(userMessage('next')),
    ];

    const cutPoint = findCutPoint(entries, 0, entries.length, 1);

    expect(entries[cutPoint.firstKeptEntryIndex].type).toBe('message');
    expect((entries[cutPoint.firstKeptEntryIndex] as any).message.role).not.toBe('toolResult');
  });
});
