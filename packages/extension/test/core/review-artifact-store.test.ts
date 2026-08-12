import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { access, mkdir, utimes, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  REVIEW_ARTIFACT_CUSTOM_TYPE,
  loadReviewArtifact,
  loadStoredSnapshot,
  persistReviewArtifact,
  runReviewArtifactGarbageCollection,
  type ReviewArtifactRef,
} from '../../src/core/review/review-artifact.ts';
import { ReviewArtifactStore } from '../../src/core/review/review-artifact-store.ts';
import { createDiffDocument } from '../../src/core/review/diff-document.ts';
import type { FileReviewTurnSnapshot } from '../../src/core/review/file-review.ts';

let agentDir: string;
let store: ReviewArtifactStore;

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), 'scout-review-store-'));
  store = new ReviewArtifactStore({ agentDir });
});

afterEach(() => rmSync(agentDir, { recursive: true, force: true }));

describe('ReviewArtifactStore', () => {
  it('uses normalized review text hashes and validates typed envelopes', async () => {
    const plainHash = await store.putText('hello\n');
    const bomHash = await store.putText('\uFEFFhello\n');
    expect(bomHash).toBe(plainHash);
    await expect(store.getText(plainHash)).resolves.toBe('hello\n');

    await writeFile(store.getBlobPath(plainHash), Buffer.from('not-gzip'));
    await expect(store.getText(plainHash)).rejects.toThrow();
  });

  it('hashes manifests from stable field ordering', async () => {
    const first = await store.putManifest({ z: 1, nested: { b: 2, a: 1 } });
    const second = await store.putManifest({ nested: { a: 1, b: 2 }, z: 1 });
    expect(second).toBe(first);
    await expect(store.getManifest(first)).resolves.toEqual({ nested: { a: 1, b: 2 }, z: 1 });
  });

  it('persists A→B and B→C records while the file manifest keeps A→C', async () => {
    const review = makeTwoRevisionReview();
    const persisted = await persistReviewArtifact(store, 'session-1', review, {
      turnId: 'turn-1',
      fileCount: 1,
      additions: 1,
      deletions: 1,
      files: [{ path: '/workspace/app.ts', additions: 1, deletions: 1 }],
    });
    expect(persisted.ref).not.toHaveProperty('records');
    expect(persisted.ref).not.toHaveProperty('files');

    const loaded = await loadReviewArtifact(store, persisted.ref);
    await expect(loadStoredSnapshot(store, loaded.records[0].before)).resolves.toEqual({
      content: 'A\n',
    });
    await expect(loadStoredSnapshot(store, loaded.records[0].after)).resolves.toEqual({
      content: 'B\n',
    });
    await expect(loadStoredSnapshot(store, loaded.records[1].before)).resolves.toEqual({
      content: 'B\n',
    });
    await expect(loadStoredSnapshot(store, loaded.files[0].final)).resolves.toEqual({
      content: 'C\n',
    });
  });

  it('rejects a snapshot whose manifest-declared length is wrong', async () => {
    const hash = await store.putText('content');
    await expect(
      loadStoredSnapshot(store, { kind: 'blob', hash, byteLength: 999 }),
    ).rejects.toThrow(/length mismatch/);
  });

  it('keeps formal CAS objects during automatic GC while reporting old orphans', async () => {
    const referencedBlob = await store.putText('referenced');
    const orphanBlob = await store.putText('orphan');
    const manifest = {
      version: 1 as const,
      sessionId: 'session-1',
      turnId: 'turn-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      records: [],
      files: [
        {
          fileId: 'file-1',
          path: 'app.ts',
          absolutePath: '/workspace/app.ts',
          recordIds: [],
          latestRevision: 1,
          additions: 0,
          deletions: 0,
          baseline: { kind: 'blob' as const, hash: referencedBlob, byteLength: 10 },
          final: { kind: 'blob' as const, hash: referencedBlob, byteLength: 10 },
        },
      ],
    };
    const manifestHash = await store.putManifest(manifest);
    const orphanManifestHash = await store.putManifest({ version: 1, orphan: true });
    const sessionDir = join(agentDir, 'sessions', 'workspace');
    await mkdir(sessionDir, { recursive: true });
    const ref: ReviewArtifactRef = {
      version: 1,
      sessionId: 'session-1',
      turnId: 'turn-1',
      createdAt: manifest.createdAt,
      complete: true,
      manifestHash,
      summary: { turnId: 'turn-1', fileCount: 1, additions: 0, deletions: 0, files: [] },
    };
    await writeFile(
      join(sessionDir, 'session.jsonl'),
      `${JSON.stringify({ type: 'custom', id: 'branch-a', parentId: 'other-branch', customType: REVIEW_ARTIFACT_CUSTOM_TYPE, data: ref })}\n`,
    );
    const old = new Date(Date.now() - 25 * 60 * 60 * 1_000);
    await utimes(store.getBlobPath(orphanBlob), old, old);
    await utimes(store.getManifestPath(orphanManifestHash), old, old);
    const temporaryPath = join(dirname(store.getBlobPath(orphanBlob)), '.expired.tmp');
    await writeFile(temporaryPath, 'temporary');
    await utimes(temporaryPath, old, old);

    const report = await runReviewArtifactGarbageCollection({
      agentDir,
      sessionsRoot: join(agentDir, 'sessions'),
    });
    expect(report.skipped).toBe(false);
    expect(report.reclaimableFiles).toBe(2);
    expect(report.reclaimableBytes).toBeGreaterThan(0);
    expect(report.deletedFiles).toBe(1);
    await expect(access(store.getBlobPath(referencedBlob))).resolves.toBeUndefined();
    await expect(access(store.getManifestPath(manifestHash))).resolves.toBeUndefined();
    await expect(access(store.getBlobPath(orphanBlob))).resolves.toBeUndefined();
    await expect(access(store.getManifestPath(orphanManifestHash))).resolves.toBeUndefined();
    await expect(access(temporaryPath)).rejects.toThrow();
  });
});

function makeTwoRevisionReview(): FileReviewTurnSnapshot {
  const document = createDiffDocument('A\n', 'C\n');
  return {
    turnId: 'turn-1',
    phase: 'finalized',
    records: [
      {
        recordId: 'record-1',
        turnId: 'turn-1',
        toolCallId: 'tool-1',
        operation: 'edit',
        path: 'app.ts',
        absolutePath: '/workspace/app.ts',
        sequence: 1,
        fileId: 'file-1',
        revision: 1,
        before: { content: 'A\n', byteLength: 2 },
        after: { content: 'B\n', byteLength: 2 },
      },
      {
        recordId: 'record-2',
        turnId: 'turn-1',
        toolCallId: 'tool-2',
        operation: 'edit',
        path: 'app.ts',
        absolutePath: '/workspace/app.ts',
        sequence: 2,
        fileId: 'file-1',
        revision: 2,
        before: { content: 'B\n', byteLength: 2 },
        after: { content: 'C\n', byteLength: 2 },
      },
    ],
    files: [
      {
        fileId: 'file-1',
        revision: 2,
        path: 'app.ts',
        absolutePath: '/workspace/app.ts',
        originalContent: 'A\n',
        modifiedContent: 'C\n',
        document,
        projectionStatus: 'ready',
        recordIds: ['record-1', 'record-2'],
        latestRecordId: 'record-2',
        latestSequence: 2,
        additions: document.additions,
        deletions: document.deletions,
      },
    ],
  };
}
