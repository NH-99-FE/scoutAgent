import { describe, expect, it } from 'vitest';
import { getTaskSearchText, matchesTaskSearch } from '../../src/host/protocol/task-search.ts';
import type { JsonlSessionMetadata } from '../../src/core/session/index.ts';

function makeSession(overrides: Partial<JsonlSessionMetadata> = {}): JsonlSessionMetadata {
  return {
    id: 'session-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    cwd: '/workspace/project',
    path: '/workspace/project/.scout/sessions/session-1.jsonl',
    firstMessage: 'initial prompt',
    allMessagesText: 'initial prompt later assistant answer hidden search token',
    ...overrides,
  };
}

describe('task search', () => {
  it('matches text that appears after the first session message', () => {
    const session = makeSession();

    expect(matchesTaskSearch(session, 'hidden search token')).toBe(true);
  });

  it('does not rely on firstMessage when building searchable text', () => {
    const searchText = getTaskSearchText(
      makeSession({
        firstMessage: 'initial prompt',
        allMessagesText: 'later conversation content',
      }),
    );

    expect(searchText).toContain('later conversation content');
    expect(searchText).not.toContain('initial prompt');
  });
});
