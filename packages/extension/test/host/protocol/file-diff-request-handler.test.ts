import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestFileDiffMessage } from '@scout-agent/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDiffDocument,
  createUnavailableDiffDocument,
} from '../../../src/core/review/diff-document.ts';
import type { FileReviewTurnSnapshot } from '../../../src/core/review/file-review.ts';
import type { ExactMutationDiffInput } from '../../../src/core/review/mutation-journal.ts';
import type { DiffDocument } from '../../../src/core/review/diff-document.ts';
import type { ReviewArtifactManifest } from '../../../src/core/review/review-artifact.ts';
import { ReviewArtifactStore } from '../../../src/core/review/review-artifact-store.ts';
import { FileDiffRequestHandler } from '../../../src/host/protocol/file-diff-request-handler.ts';
import { DiffDocumentProjector } from '../../../src/host/review/diff-document-projector.ts';

const REQUEST: RequestFileDiffMessage = {
  type: 'request_file_diff',
  sessionId: 'session-1',
  turnId: 'turn-1',
  fileId: 'file-1',
  revision: 1,
  recordId: 'record-1',
  view: 'inline',
  mode: 'unified',
  includeTokens: false,
};

let agentDir: string;
let store: ReviewArtifactStore;

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), 'scout-review-handler-'));
  store = new ReviewArtifactStore({ agentDir });
});

afterEach(() => rmSync(agentDir, { recursive: true, force: true }));

describe('FileDiffRequestHandler', () => {
  it('projects an exact runtime operation and caches repeated requests', async () => {
    const projector = new DiffDocumentProjector();
    const projectSpy = vi.spyOn(projector, 'project');
    const computeDiff = vi.fn(async (input) =>
      createDiffDocument(input.originalContent, input.modifiedContent),
    );
    const handler = createHandler({ runtime: makeRuntimeReview(), projector, computeDiff });

    const first = await handler.handle(REQUEST);
    const second = await handler.handle(REQUEST);

    expect(first).toMatchObject({
      status: 'ready',
      diff: { additions: 1, deletions: 1 },
    });
    expect(second).toEqual(first);
    expect(projectSpy).toHaveBeenCalledTimes(1);
    expect(computeDiff).toHaveBeenCalledTimes(1);
  });

  it('deduplicates an in-flight generation failure but retries it after settlement', async () => {
    let settleFirst: ((document: DiffDocument) => void) | undefined;
    const computeDiff = vi
      .fn<(input: ExactMutationDiffInput) => Promise<DiffDocument>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            settleFirst = resolve;
          }),
      )
      .mockImplementationOnce(async (input) =>
        createDiffDocument(input.originalContent, input.modifiedContent),
      );
    const handler = createHandler({ runtime: makeRuntimeReview(), computeDiff });

    const first = handler.handle(REQUEST);
    const concurrent = handler.handle(REQUEST);
    await vi.waitFor(() => expect(computeDiff).toHaveBeenCalledTimes(1));

    settleFirst?.(createUnavailableDiffDocument('generation_failed'));
    await expect(first).resolves.toMatchObject({ status: 'unavailable' });
    await expect(concurrent).resolves.toMatchObject({ status: 'unavailable' });

    await expect(handler.handle(REQUEST)).resolves.toMatchObject({ status: 'ready' });
    expect(computeDiff).toHaveBeenCalledTimes(2);
  });

  it('keeps deterministic unavailable documents cached', async () => {
    const computeDiff = vi.fn(async () => createUnavailableDiffDocument('content_too_large'));
    const handler = createHandler({ runtime: makeRuntimeReview(), computeDiff });

    await expect(handler.handle(REQUEST)).resolves.toMatchObject({ status: 'unavailable' });
    await expect(handler.handle(REQUEST)).resolves.toMatchObject({ status: 'unavailable' });
    expect(computeDiff).toHaveBeenCalledTimes(1);
  });

  it('uses the operation record for inline and turn baseline/final for panel', async () => {
    const review = makeRuntimeReview();
    review.records.push({
      ...review.records[0],
      recordId: 'record-2',
      toolCallId: 'tool-2',
      revision: 2,
      sequence: 2,
      before: { content: 'const value = 2;\n', byteLength: 17 },
      after: { content: 'const value = 3;\n', byteLength: 17 },
    });
    review.files[0].revision = 2;
    review.files[0].modifiedContent = 'const value = 3;\n';
    const handler = createHandler({ runtime: review });

    const inline = await handler.handle({ ...REQUEST, revision: 2, recordId: 'record-2' });
    const panel = await handler.handle({
      ...REQUEST,
      revision: 2,
      recordId: undefined,
      view: 'panel',
    });
    expect(getAddedText(inline)).toBe('const value = 3;');
    expect(getRemovedText(inline)).toBe('const value = 2;');
    expect(getRemovedText(panel)).toBe('const value = 1;');
  });

  it('rejects stale session and missing inline record identity', async () => {
    const stale = createHandler({ runtime: makeRuntimeReview(), sessionId: 'session-2' });
    await expect(stale.handle(REQUEST)).resolves.toMatchObject({ status: 'error' });

    const current = createHandler({ runtime: makeRuntimeReview() });
    await expect(current.handle({ ...REQUEST, recordId: undefined })).resolves.toMatchObject({
      status: 'error',
      message: expect.stringContaining('recordId'),
    });
  });

  it('loads complete historical content from the external artifact store', async () => {
    const manifest = await makeArtifact();
    const handler = createHandler({ artifact: manifest });
    const result = await handler.handle(REQUEST);
    expect(getRemovedText(result)).toBe('const value = 1;');
    expect(getAddedText(result)).toBe('const value = 2;');
  });

  it('revalidates a stable fold and returns non-overlapping lazy context', async () => {
    const before = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`);
    const after = [...before];
    after[39] = 'changed';
    const review = makeRuntimeReview(`${before.join('\n')}\n`, `${after.join('\n')}\n`);
    const handler = createHandler({ runtime: review });
    const panel = await handler.handle({ ...REQUEST, recordId: undefined, view: 'panel' });
    expect(panel.status).toBe('ready');
    if (panel.status !== 'ready') return;
    const fold = panel.diff.rows.find((row) => row.type === 'fold' && row.foldId);
    expect(fold?.foldId).toBeTruthy();
    const context = await handler.handleContext({
      type: 'request_file_diff_context',
      sessionId: 'session-1',
      turnId: 'turn-1',
      fileId: 'file-1',
      revision: 1,
      foldId: fold!.foldId!,
      revealHead: 10,
      revealTail: 10,
      includeTokens: false,
    });
    expect(context).toMatchObject({ status: 'ready', headRows: { length: 10 } });
    if (context.status === 'ready') {
      expect(context.headRows.length + context.tailRows.length).toBeLessThanOrEqual(context.total);
    }
  });

  it('keeps fold identity stable when the source switches from runtime to artifact', async () => {
    const before = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`);
    const after = [...before];
    after[39] = 'changed';
    const originalContent = `${before.join('\n')}\n`;
    const modifiedContent = `${after.join('\n')}\n`;
    let runtime: FileReviewTurnSnapshot | undefined = makeRuntimeReview(
      originalContent,
      modifiedContent,
    );
    const artifact = await makeArtifact(originalContent, modifiedContent);
    const computeDiff = vi.fn(async (input) =>
      createDiffDocument(input.originalContent, input.modifiedContent),
    );
    const handler = createHandler({
      getRuntimeReview: () => runtime,
      artifact,
      computeDiff,
    });

    const panel = await handler.handle({ ...REQUEST, recordId: undefined, view: 'panel' });
    expect(panel.status).toBe('ready');
    if (panel.status !== 'ready') return;
    const fold = panel.diff.rows.find((row) => row.type === 'fold' && row.foldId);
    expect(fold?.foldId).toBeTruthy();

    runtime = undefined;
    const context = await handler.handleContext({
      type: 'request_file_diff_context',
      sessionId: 'session-1',
      turnId: 'turn-1',
      fileId: 'file-1',
      revision: 1,
      foldId: fold!.foldId!,
      revealHead: 10,
      revealTail: 10,
      includeTokens: false,
    });

    expect(context).toMatchObject({ status: 'ready', headRows: { length: 10 } });
    expect(computeDiff).toHaveBeenCalledTimes(1);
  });
});

function createHandler(options: {
  runtime?: FileReviewTurnSnapshot;
  getRuntimeReview?: () => FileReviewTurnSnapshot | undefined;
  artifact?: ReviewArtifactManifest;
  sessionId?: string;
  projector?: DiffDocumentProjector;
  computeDiff?: (input: ExactMutationDiffInput) => Promise<DiffDocument>;
}): FileDiffRequestHandler {
  return new FileDiffRequestHandler({
    getCurrentSessionId: () => options.sessionId ?? 'session-1',
    getRuntimeReview: options.getRuntimeReview ?? (() => options.runtime),
    getArtifact: vi.fn(async () => options.artifact),
    artifactStore: store,
    computeDiff:
      options.computeDiff ??
      (async (input) => createDiffDocument(input.originalContent, input.modifiedContent, input)),
    projector: options.projector,
  });
}

function makeRuntimeReview(
  originalContent = 'const value = 1;\n',
  modifiedContent = 'const value = 2;\n',
): FileReviewTurnSnapshot {
  const document = createDiffDocument(originalContent, modifiedContent);
  return {
    turnId: 'turn-1',
    phase: 'active',
    records: [
      {
        recordId: 'record-1',
        turnId: 'turn-1',
        toolCallId: 'tool-1',
        operation: 'edit',
        path: 'src/app.ts',
        absolutePath: '/workspace/src/app.ts',
        sequence: 1,
        fileId: 'file-1',
        revision: 1,
        before: { content: originalContent, byteLength: Buffer.byteLength(originalContent) },
        after: { content: modifiedContent, byteLength: Buffer.byteLength(modifiedContent) },
      },
    ],
    files: [
      {
        absolutePath: '/workspace/src/app.ts',
        path: 'src/app.ts',
        originalContent,
        modifiedContent,
        document,
        fileId: 'file-1',
        revision: 1,
        projectionStatus: 'ready',
        recordIds: ['record-1'],
        latestRecordId: 'record-1',
        latestSequence: 1,
        additions: document.additions,
        deletions: document.deletions,
      },
    ],
  };
}

async function makeArtifact(
  before = 'const value = 1;\n',
  after = 'const value = 2;\n',
): Promise<ReviewArtifactManifest> {
  const beforeHash = await store.putText(before);
  const afterHash = await store.putText(after);
  return {
    version: 1,
    sessionId: 'session-1',
    turnId: 'turn-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    records: [
      {
        recordId: 'record-1',
        toolCallId: 'tool-1',
        operation: 'edit',
        fileId: 'file-1',
        revision: 1,
        sequence: 1,
        toolOutcome: 'success',
        before: { kind: 'blob', hash: beforeHash, byteLength: Buffer.byteLength(before) },
        after: { kind: 'blob', hash: afterHash, byteLength: Buffer.byteLength(after) },
      },
    ],
    files: [
      {
        fileId: 'file-1',
        path: 'src/app.ts',
        absolutePath: '/workspace/src/app.ts',
        recordIds: ['record-1'],
        latestRevision: 1,
        additions: 1,
        deletions: 1,
        baseline: { kind: 'blob', hash: beforeHash, byteLength: Buffer.byteLength(before) },
        final: { kind: 'blob', hash: afterHash, byteLength: Buffer.byteLength(after) },
      },
    ],
  };
}

function getAddedText(result: Awaited<ReturnType<FileDiffRequestHandler['handle']>>) {
  return result.status === 'ready'
    ? result.diff.rows.find((row) => row.type === 'added')?.text
    : undefined;
}

function getRemovedText(result: Awaited<ReturnType<FileDiffRequestHandler['handle']>>) {
  return result.status === 'ready'
    ? result.diff.rows.find((row) => row.type === 'removed')?.text
    : undefined;
}
