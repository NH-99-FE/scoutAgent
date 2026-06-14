import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TASK_SEARCH_LIMIT,
  getTaskSearchText,
  matchesTaskSearch,
  normalizeTaskSearchLimit,
  normalizeTaskSearchOffset,
} from '../../src/host/protocol/task-search.ts';
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
  it('matches the displayed task title', () => {
    const session = makeSession({ name: 'Fix history search panel' });

    expect(matchesTaskSearch(session, 'history panel')).toBe(true);
  });

  it('uses the same fallback title fields as task rendering', () => {
    const searchText = getTaskSearchText(
      makeSession({
        id: 'session-alpha',
        name: undefined,
        firstMessage: 'Initial prompt title',
        allMessagesText: 'later conversation content',
      }),
    );

    expect(searchText).toBe('initial prompt title');
  });

  it('does not match body, cwd, path, or id when a title is available', () => {
    const session = makeSession({
      id: 'session-alpha',
      name: 'Saved task',
      firstMessage: 'initial prompt',
      allMessagesText: 'later conversation content hidden token',
      cwd: '/workspace/hidden-cwd',
      path: '/workspace/hidden-path/session.jsonl',
    });

    expect(matchesTaskSearch(session, 'hidden token')).toBe(false);
    expect(matchesTaskSearch(session, 'hidden-cwd')).toBe(false);
    expect(matchesTaskSearch(session, 'hidden-path')).toBe(false);
    expect(matchesTaskSearch(session, 'session-alpha')).toBe(false);
  });

  it('normalizes pagination values for task history fetches', () => {
    expect(normalizeTaskSearchLimit(undefined)).toBe(DEFAULT_TASK_SEARCH_LIMIT);
    expect(normalizeTaskSearchLimit(0)).toBe(1);
    expect(normalizeTaskSearchLimit(150)).toBe(100);
    expect(normalizeTaskSearchOffset(-10)).toBe(0);
    expect(normalizeTaskSearchOffset(3.8)).toBe(3);
  });
});
