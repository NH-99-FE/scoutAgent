import { describe, expect, it, vi } from 'vitest';
import type { JsonlSessionMetadata } from '../../../../src/core/session/index.ts';
import { SessionIndex } from '../../../../src/host/session-index.ts';
import { TaskProtocolService } from '../../../../src/host/protocol/services/task-service.ts';

function makeSession(overrides: Partial<JsonlSessionMetadata> = {}): JsonlSessionMetadata {
  return {
    id: 'session-1',
    path: '/workspace/.scout/sessions/session-1.jsonl',
    cwd: '/workspace',
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-02T00:00:00.000Z',
    name: 'Visible task title',
    firstMessage: 'first message',
    messageCount: 2,
    ...overrides,
  };
}

describe('TaskProtocolService', () => {
  it('returns paged task history and marks the active session', async () => {
    const listWorkspace = vi.fn(async () => [
      makeSession({ id: 'session-1', path: '/sessions/one.jsonl', name: 'Alpha task' }),
      makeSession({ id: 'session-2', path: '/sessions/two.jsonl', name: 'Beta task' }),
    ]);
    const service = new TaskProtocolService({
      sessionIndex: new SessionIndex({ listWorkspace, listAll: vi.fn(async () => []) }),
      getActiveSessionFile: () => '/sessions/two.jsonl',
      logError: vi.fn(),
    });
    const respond = vi.fn();

    await service.requestTaskHistory(
      {
        type: 'request_task_history',
        query: '',
        purpose: 'panel',
        offset: 1,
        limit: 1,
      },
      respond,
    );

    expect(respond).toHaveBeenCalledWith({
      type: 'task_history_data',
      query: '',
      purpose: 'panel',
      tasks: [
        expect.objectContaining({
          sessionId: 'session-2',
          sessionPath: '/sessions/two.jsonl',
          title: 'Beta task',
          isCurrent: true,
        }),
      ],
      offset: 1,
      hasMore: false,
      nextOffset: 2,
    });
  });

  it('reuses indexed session data for repeated searches', async () => {
    const listWorkspace = vi.fn(async () => [
      makeSession({ id: 'session-1', path: '/sessions/one.jsonl', name: 'Alpha task' }),
      makeSession({ id: 'session-2', path: '/sessions/two.jsonl', name: 'Beta task' }),
    ]);
    const service = new TaskProtocolService({
      sessionIndex: new SessionIndex({ listWorkspace, listAll: vi.fn(async () => []) }),
      getActiveSessionFile: () => undefined,
      logError: vi.fn(),
    });

    await service.requestTaskHistory(
      { type: 'request_task_history', query: 'alpha', offset: 0 },
      vi.fn(),
    );
    await service.requestTaskHistory(
      { type: 'request_task_history', query: 'alpha', offset: 0 },
      vi.fn(),
    );

    expect(listWorkspace).toHaveBeenCalledTimes(1);
  });

  it('responds with an empty result and logs when session loading fails', async () => {
    const logError = vi.fn();
    const service = new TaskProtocolService({
      sessionIndex: new SessionIndex({
        listWorkspace: vi.fn(async () => {
          throw new Error('boom');
        }),
        listAll: vi.fn(async () => []),
      }),
      getActiveSessionFile: () => undefined,
      logError,
    });
    const respond = vi.fn();

    await service.requestTaskHistory(
      {
        type: 'request_task_history',
        query: 'alpha',
        purpose: 'recent',
        offset: 4,
        limit: 2,
      },
      respond,
    );

    expect(respond).toHaveBeenCalledWith({
      type: 'task_history_data',
      query: 'alpha',
      purpose: 'recent',
      tasks: [],
      offset: 4,
      hasMore: false,
      nextOffset: 4,
    });
    expect(logError).toHaveBeenCalledWith('[scout] List task history failed: boom');
  });
});
