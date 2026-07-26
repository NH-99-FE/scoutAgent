import { describe, expect, it, vi } from 'vitest';
import type { RequestFileDiffMessage } from '@scout-agent/shared';
import { createDiffDocument } from '../../../src/core/review/diff-document.ts';
import type { FileReviewTurnSnapshot } from '../../../src/core/review/file-review.ts';
import { FileDiffRequestHandler } from '../../../src/host/protocol/file-diff-request-handler.ts';
import { DiffDocumentProjector } from '../../../src/host/review/diff-document-projector.ts';
import type { FileReviewArtifact } from '../../../src/host/review/file-review-artifact.ts';

const REQUEST: RequestFileDiffMessage = {
  type: 'request_file_diff',
  sessionId: 'session-1',
  turnId: 'turn-1',
  fileId: 'file-1',
  revision: 1,
  view: 'inline',
  mode: 'unified',
  includeTokens: false,
};

describe('FileDiffRequestHandler', () => {
  it('projects a bounded runtime DiffDocument and caches repeated requests', async () => {
    const projector = new DiffDocumentProjector();
    const projectSpy = vi.spyOn(projector, 'project');
    const handler = new FileDiffRequestHandler({
      getCurrentSessionId: () => 'session-1',
      getRuntimeReview: () => makeRuntimeReview('ready'),
      getArtifact: vi.fn(async () => undefined),
      projector,
    });

    const first = await handler.handle(REQUEST);
    const second = await handler.handle(REQUEST);

    expect(first).toMatchObject({
      status: 'ready',
      turnId: 'turn-1',
      fileId: 'file-1',
      revision: 1,
      diff: { additions: 1, deletions: 1 },
    });
    expect(second).toEqual(first);
    expect(projectSpy).toHaveBeenCalledTimes(1);
  });

  it('returns pending without reading artifact while the runtime projection is running', async () => {
    const getArtifact = vi.fn(async () => makeArtifact());
    const handler = new FileDiffRequestHandler({
      getCurrentSessionId: () => 'session-1',
      getRuntimeReview: () => makeRuntimeReview('pending'),
      getArtifact,
    });

    await expect(handler.handle(REQUEST)).resolves.toMatchObject({ status: 'pending' });
    expect(getArtifact).not.toHaveBeenCalled();
  });

  it('rejects stale session and revision identities before projection', async () => {
    const getArtifact = vi.fn(async () => makeArtifact());
    const handler = new FileDiffRequestHandler({
      getCurrentSessionId: () => 'session-2',
      getRuntimeReview: () => makeRuntimeReview('ready'),
      getArtifact,
    });

    await expect(handler.handle(REQUEST)).resolves.toMatchObject({
      status: 'error',
      message: expect.stringContaining('stale'),
    });
    expect(getArtifact).not.toHaveBeenCalled();

    const currentHandler = new FileDiffRequestHandler({
      getCurrentSessionId: () => 'session-1',
      getRuntimeReview: () => makeRuntimeReview('ready'),
      getArtifact,
    });
    await expect(currentHandler.handle({ ...REQUEST, revision: 2 })).resolves.toMatchObject({
      status: 'unavailable',
      message: expect.stringContaining('stale'),
    });
  });

  it('restores the canonical document from artifact v2 when runtime state is absent', async () => {
    const handler = new FileDiffRequestHandler({
      getCurrentSessionId: () => 'session-1',
      getRuntimeReview: () => undefined,
      getArtifact: vi.fn(async () => makeArtifact()),
    });

    await expect(handler.handle(REQUEST)).resolves.toMatchObject({
      status: 'ready',
      diff: {
        additions: 1,
        deletions: 1,
        rows: expect.arrayContaining([
          expect.objectContaining({ type: 'removed', text: 'const value = 1;' }),
          expect.objectContaining({ type: 'added', text: 'const value = 2;' }),
        ]),
      },
    });
  });

  it('tokenizes only when requested and respects inline row bounds', async () => {
    const handler = new FileDiffRequestHandler({
      getCurrentSessionId: () => 'session-1',
      getRuntimeReview: () => makeRuntimeReview('ready'),
      getArtifact: vi.fn(async () => undefined),
    });

    const result = await handler.handle({ ...REQUEST, includeTokens: true });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.diff.rows.length).toBeLessThanOrEqual(40);
    expect(result.diff.rows.find((row) => row.type === 'added')?.tokens).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: expect.any(String) })]),
    );
  });
});

function makeRuntimeReview(status: 'pending' | 'ready' | 'unavailable'): FileReviewTurnSnapshot {
  const document = createDiffDocument('const value = 1;\n', 'const value = 2;\n');
  return {
    turnId: 'turn-1',
    records: [],
    files: [
      {
        absolutePath: '/workspace/src/app.ts',
        path: 'src/app.ts',
        originalContent: 'const value = 1;\n',
        modifiedContent: 'const value = 2;\n',
        document: status === 'ready' ? document : undefined,
        fileId: 'file-1',
        revision: 1,
        projectionStatus: status,
        recordIds: ['record-1'],
        latestRecordId: 'record-1',
        latestSequence: 1,
        additions: status === 'ready' ? document.additions : 0,
        deletions: status === 'ready' ? document.deletions : 0,
        unavailableReason: status === 'unavailable' ? 'original_unavailable' : undefined,
      },
    ],
  };
}

function makeArtifact(): FileReviewArtifact {
  return {
    version: 2,
    sessionId: 'session-1',
    turnId: 'turn-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    records: [
      {
        recordId: 'record-1',
        toolCallId: 'tool-1',
        operation: 'edit',
        fileId: 'file-1',
        sequence: 1,
        toolOutcome: 'success',
      },
    ],
    files: [
      {
        fileId: 'file-1',
        path: 'src/app.ts',
        absolutePath: '/workspace/src/app.ts',
        recordIds: ['record-1'],
        latestRevision: 1,
        document: createDiffDocument('const value = 1;\n', 'const value = 2;\n'),
      },
    ],
  };
}
