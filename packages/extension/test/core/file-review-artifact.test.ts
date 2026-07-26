import { describe, expect, it } from 'vitest';
import {
  MutationJournal,
  captureStringSnapshot,
  projectDiffDocumentRows,
} from '../../src/core/review/index.ts';
import { runDiffWorkerRequest, type DiffWorkerClientPort } from '../../src/core/review/index.ts';
import {
  collectCurrentBranchFileReviewArtifacts,
  collectFileReviewArtifacts,
  createFileReviewArtifact,
  decodeFileReviewArtifact,
  FILE_REVIEW_ARTIFACT_CUSTOM_TYPE,
  isFileReviewArtifact,
  isFileReviewArtifactV1,
  prepareFileReviewArtifactForSession,
  type FileReviewArtifactV1,
} from '../../src/core/review/file-review-artifact.ts';
import type { SessionTreeEntry } from '../../src/core/session/index.ts';

/** 同步 fake worker：append 后 projection 立即 ready，无需等待异步 Worker。 */
function createSyncMutationJournal(): MutationJournal {
  const client: DiffWorkerClientPort = {
    request: (request, listener) => listener(runDiffWorkerRequest(request)),
    dispose: () => undefined,
  };
  return new MutationJournal({ diffWorkerClient: client });
}

describe('file review artifact v2', () => {
  it('persists canonical DiffDocument without snapshots, rows, or syntax tokens', () => {
    const artifact = makeArtifact();
    const serialized = JSON.stringify(artifact);

    expect(artifact).toMatchObject({
      version: 2,
      sessionId: 'session-1',
      turnId: 'turn-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      records: [
        {
          recordId: 'mutation-1',
          fileId: expect.any(String),
          toolOutcome: 'success',
        },
      ],
      files: [
        {
          fileId: expect.any(String),
          path: 'src/app.ts',
          latestRevision: 1,
          document: {
            additions: 1,
            deletions: 1,
            hunks: expect.any(Array),
          },
        },
      ],
    });
    expect(serialized).not.toContain('originalContent');
    expect(serialized).not.toContain('modifiedContent');
    expect(serialized).not.toContain('"rows"');
    expect(serialized).not.toContain('"tokens"');
  });

  it('persists no-op writes as an empty canonical document', () => {
    const journal = createSyncMutationJournal();
    journal.append({
      ownerId: 'session-1',
      turnId: 'turn-1',
      toolCallId: 'tool-1',
      operation: 'write',
      path: 'src/app.ts',
      absolutePath: '/workspace/src/app.ts',
      before: captureStringSnapshot('line-1\r\nline-2\r\nline-3\r\n'),
      after: captureStringSnapshot('line-1\nline-2\nline-3\n'),
      toolOutcome: 'success',
    });
    journal.sealTurn('turn-1');
    const review = journal.toReviewTurnSnapshot('turn-1');
    if (!review) throw new Error('Expected review turn');

    const artifact = createFileReviewArtifact('session-1', review);

    expect(artifact.files[0]?.document).toMatchObject({
      additions: 0,
      deletions: 0,
      hunks: [],
    });
    expect(JSON.stringify(artifact)).not.toContain('line-1');
  });

  it('rejects malformed v2 documents and inconsistent record references', () => {
    const artifact = makeArtifact();

    expect(isFileReviewArtifact(artifact)).toBe(true);
    expect(
      isFileReviewArtifact({
        ...artifact,
        files: [{ ...artifact.files[0], latestRevision: 0 }],
      }),
    ).toBe(false);
    expect(
      isFileReviewArtifact({
        ...artifact,
        files: [
          {
            ...artifact.files[0],
            document: { ...artifact.files[0]!.document, hunks: [{ broken: true }] },
          },
        ],
      }),
    ).toBe(false);
    expect(
      isFileReviewArtifact({
        ...artifact,
        records: [{ ...artifact.records[0], fileId: 'wrong-file' }],
      }),
    ).toBe(false);
    expect(decodeFileReviewArtifact({ ...artifact, version: 99 })).toBeUndefined();
  });

  it('rejects snapshots that are not finalized', () => {
    const journal = createSyncMutationJournal();
    journal.append({
      ownerId: 'session-1',
      turnId: 'turn-pending',
      toolCallId: 'tool-pending',
      operation: 'edit',
      path: 'src/app.ts',
      absolutePath: '/workspace/src/app.ts',
      before: captureStringSnapshot('old\n'),
      after: captureStringSnapshot('new\n'),
      toolOutcome: 'success',
    });
    const review = journal.toReviewTurnSnapshot('turn-pending');
    if (!review) throw new Error('Expected review turn');

    expect(() => createFileReviewArtifact('session-1', review)).toThrow(/尚未完成/);
  });

  it('reads v1 rows through a centralized adapter and drops persisted tokens', () => {
    const legacy = makeV1Artifact();

    expect(isFileReviewArtifactV1(legacy)).toBe(true);
    const decoded = decodeFileReviewArtifact(legacy);

    expect(decoded).toMatchObject({
      version: 2,
      sessionId: 'session-1',
      turnId: 'turn-1',
      files: [
        {
          latestRevision: 1,
          document: {
            additions: 1,
            deletions: 1,
            afterFingerprint: legacy.files[0]?.modifiedFingerprint,
          },
        },
      ],
    });
    expect(projectDiffDocumentRows(decoded!.files[0]!.document)).toEqual([
      { type: 'removed', oldLineNumber: 1, text: 'old' },
      { type: 'added', newLineNumber: 1, text: 'new' },
    ]);
    expect(JSON.stringify(decoded)).not.toContain('hljs-keyword');
  });

  it('marks oversized canonical diffs unavailable while retaining lightweight statistics', () => {
    const artifact = makeArtifact(
      Array.from({ length: 40 }, (_, index) => `old-${index}`).join('\n'),
      Array.from({ length: 40 }, (_, index) => `new-${index}`).join('\n'),
    );

    const {
      artifact: bounded,
      degraded,
      warnings,
    } = prepareFileReviewArtifactForSession(artifact, {
      maxRows: 1,
    });

    expect(degraded).toBe(true);
    expect(warnings).toEqual(expect.arrayContaining([expect.stringContaining('hunk lines')]));
    expect(isFileReviewArtifact(bounded)).toBe(true);
    expect(bounded.files[0]?.document).toMatchObject({
      additions: 40,
      deletions: 40,
      unavailableReason: 'diff_too_large',
      hunks: [],
    });
  });

  it('reports when an artifact remains fully faithful to the runtime review', () => {
    const artifact = makeArtifact();
    const result = prepareFileReviewArtifactForSession(artifact);

    expect(result.degraded).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.artifact).toEqual(artifact);
  });

  it('persists and restores canonical unavailable documents', () => {
    const journal = createSyncMutationJournal();
    journal.append({
      ownerId: 'session-1',
      turnId: 'turn-1',
      toolCallId: 'tool-1',
      operation: 'write',
      path: 'binary.bin',
      absolutePath: '/workspace/binary.bin',
      before: {
        content: null,
        byteLength: 2,
        unavailableReason: 'binary_or_unsupported',
      },
      after: captureStringSnapshot('replacement'),
      toolOutcome: 'success',
    });
    journal.sealTurn('turn-1');
    const review = journal.toReviewTurnSnapshot('turn-1');
    if (!review) throw new Error('Expected review turn');

    const artifact = createFileReviewArtifact('session-1', review);
    const restored = decodeFileReviewArtifact(JSON.parse(JSON.stringify(artifact)));

    expect(artifact.files).toHaveLength(1);
    expect(artifact.files[0]?.document).toMatchObject({
      additions: 0,
      deletions: 0,
      hunks: [],
      unavailableReason: 'binary_or_unsupported',
    });
    expect(restored).toEqual(artifact);
  });

  it('indexes v1 and v2 hidden entries by turn and keeps the latest branch artifact', () => {
    const first = makeV1Artifact();
    const second = {
      ...makeArtifact(),
      createdAt: '2026-01-01T00:00:01.000Z',
    };
    const otherTurn = {
      ...makeArtifact(),
      turnId: 'turn-2',
    };
    const entries: SessionTreeEntry[] = [
      makeCustomEntry('artifact-1', first),
      makeCustomEntry('artifact-2', second),
      makeCustomEntry('artifact-3', otherTurn),
    ];

    const index = collectFileReviewArtifacts(entries);

    expect(index.artifactsByTurnId.get('turn-1')).toMatchObject({
      version: 2,
      createdAt: '2026-01-01T00:00:01.000Z',
    });
    expect(index.latestTurnId).toBe('turn-2');
    expect(index.latestArtifact).toMatchObject({ turnId: 'turn-2' });
  });

  it('keeps hidden artifact children attached to the current visible branch', () => {
    const currentArtifact = makeArtifact();
    const siblingArtifact = {
      ...makeArtifact(),
      turnId: 'turn-sibling',
    };
    const branch: SessionTreeEntry[] = [makeMessageEntry('assistant', null)];
    const entries: SessionTreeEntry[] = [
      ...branch,
      makeCustomEntry('artifact-current', currentArtifact, 'assistant'),
      makeMessageEntry('sibling-user', 'assistant'),
      makeCustomEntry('artifact-sibling', siblingArtifact, 'sibling-user'),
    ];

    const index = collectCurrentBranchFileReviewArtifacts(entries, branch);

    expect(index.artifactsByTurnId.get('turn-1')).toMatchObject({ turnId: 'turn-1' });
    expect(index.artifactsByTurnId.has('turn-sibling')).toBe(false);
    expect(index.latestTurnId).toBe('turn-1');
  });
});

function makeArtifact(originalContent = 'old\n', modifiedContent = 'new\n') {
  const journal = createSyncMutationJournal();
  journal.append({
    ownerId: 'session-1',
    turnId: 'turn-1',
    toolCallId: 'tool-1',
    operation: 'edit',
    path: 'src/app.ts',
    absolutePath: '/workspace/src/app.ts',
    before: captureStringSnapshot(originalContent),
    after: captureStringSnapshot(modifiedContent),
    toolOutcome: 'success',
  });
  journal.sealTurn('turn-1');
  const review = journal.toReviewTurnSnapshot('turn-1');
  if (!review) throw new Error('Expected review turn');
  return createFileReviewArtifact('session-1', review, {
    createdAt: '2026-01-01T00:00:00.000Z',
  });
}

function makeV1Artifact(): FileReviewArtifactV1 {
  return {
    version: 1,
    sessionId: 'session-1',
    turnId: 'turn-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    records: [
      {
        recordId: 'review-1',
        turnId: 'turn-1',
        toolCallId: 'tool-1',
        operation: 'edit',
        path: 'src/app.ts',
        absolutePath: '/workspace/src/app.ts',
        sequence: 1,
      },
    ],
    files: [
      {
        absolutePath: '/workspace/src/app.ts',
        path: 'src/app.ts',
        recordIds: ['review-1'],
        latestRecordId: 'review-1',
        latestSequence: 1,
        additions: 1,
        deletions: 1,
        firstChangedLine: 1,
        modifiedFingerprint: {
          size: 4,
          sha256: '7aa7a5359173a81cf0d9b5f5f9c07ed8f26b782bf75a1ee5f5d5f6b0d6f4f65a',
        },
        rows: [
          {
            type: 'removed',
            oldLineNumber: 1,
            text: 'old',
            tokens: [{ text: 'old', syntaxScopes: ['hljs-keyword'] }],
          },
          { type: 'added', newLineNumber: 1, text: 'new' },
        ],
      },
    ],
  };
}

function makeMessageEntry(id: string, parentId: string | null): SessionTreeEntry {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: '2026-01-01T00:00:00.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'claude-test',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: 1,
    },
  };
}

function makeCustomEntry(
  id: string,
  data: unknown,
  parentId: string | null = null,
): SessionTreeEntry {
  return {
    type: 'custom',
    customType: FILE_REVIEW_ARTIFACT_CUSTOM_TYPE,
    data,
    id,
    parentId,
    timestamp: '2026-01-01T00:00:00.000Z',
  };
}
