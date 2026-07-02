import { describe, expect, it } from 'vitest';
import {
  createReviewContentFingerprint,
  FileReviewStore,
} from '../../../src/core/review/file-review.ts';
import {
  collectCurrentBranchFileReviewArtifacts,
  collectFileReviewArtifacts,
  createFileReviewArtifact,
  FILE_REVIEW_ARTIFACT_CUSTOM_TYPE,
  isFileReviewArtifact,
  prepareFileReviewArtifactForSession,
} from '../../../src/host/review/file-review-artifact.ts';
import type { SessionTreeEntry } from '../../../src/core/session/index.ts';

describe('file review artifact', () => {
  it('creates a persisted artifact without storing original or modified content', () => {
    const store = new FileReviewStore();
    store.addRecord('turn-1', 'tool-1', {
      kind: 'file_review_payload',
      operation: 'edit',
      path: 'src/app.ts',
      absolutePath: '/workspace/src/app.ts',
      originalContent: Array.from({ length: 8 }, (_, index) => `line-${index + 1}`).join('\n'),
      modifiedContent: [
        'line-1',
        'line-2',
        'changed',
        'line-4',
        'line-5',
        'line-6',
        'line-7',
        'line-8',
      ].join('\n'),
    });

    const review = store.getTurn('turn-1');
    if (!review) throw new Error('Expected review turn');

    const artifact = createFileReviewArtifact('session-1', review, {
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(JSON.stringify(artifact)).not.toContain('originalContent');
    expect(JSON.stringify(artifact)).not.toContain('modifiedContent');
    expect(JSON.stringify(artifact)).not.toContain('hiddenRows');
    expect(artifact).toMatchObject({
      version: 1,
      sessionId: 'session-1',
      turnId: 'turn-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      files: [
        {
          path: 'src/app.ts',
          additions: 1,
          deletions: 1,
          recordIds: ['review-1'],
          modifiedFingerprint: createReviewContentFingerprint(
            ['line-1', 'line-2', 'changed', 'line-4', 'line-5', 'line-6', 'line-7', 'line-8'].join(
              '\n',
            ),
          ),
        },
      ],
    });
    const fold = artifact.files[0]?.rows.find((row) => row.type === 'fold');
    expect(fold).toMatchObject({
      count: 2,
      oldStartLine: 7,
      newStartLine: 7,
    });
  });

  it('does not persist full-file context rows for no-op writes', () => {
    const store = new FileReviewStore();
    store.addRecord('turn-1', 'tool-1', {
      kind: 'file_review_payload',
      operation: 'write',
      path: 'src/app.ts',
      absolutePath: '/workspace/src/app.ts',
      originalContent: 'line-1\r\nline-2\r\nline-3\r\n',
      modifiedContent: 'line-1\nline-2\nline-3\n',
    });

    const review = store.getTurn('turn-1');
    if (!review) throw new Error('Expected review turn');

    const artifact = createFileReviewArtifact('session-1', review, {
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(artifact.files[0]).toMatchObject({
      path: 'src/app.ts',
      additions: 0,
      deletions: 0,
      rows: [],
    });
    expect(JSON.stringify(artifact)).not.toContain('line-1');
  });

  it('rejects artifacts with malformed nested files, records, or rows', () => {
    const artifact = makeArtifact();

    expect(isFileReviewArtifact(artifact)).toBe(true);
    expect(
      isFileReviewArtifact({
        ...artifact,
        records: [{ ...artifact.records[0], absolutePath: undefined }],
      }),
    ).toBe(false);
    expect(
      isFileReviewArtifact({
        ...artifact,
        files: [{ ...artifact.files[0], recordIds: [123] }],
      }),
    ).toBe(false);
    expect(
      isFileReviewArtifact({
        ...artifact,
        files: [{ ...artifact.files[0], rows: [{ type: 'added', newLineNumber: '1' }] }],
      }),
    ).toBe(false);
    expect(
      isFileReviewArtifact({
        ...artifact,
        files: [
          {
            ...artifact.files[0],
            rows: [
              {
                type: 'added',
                newLineNumber: 1,
                text: 'new',
                tokens: [{ text: 'new', diff: 'changed' }],
              },
            ],
          },
        ],
      }),
    ).toBe(false);
  });

  it('accepts artifacts with original-content-unavailable records and files', () => {
    const artifact = makeArtifact();
    const unavailable = {
      ...artifact,
      records: [
        {
          ...artifact.records[0],
          unavailableReason: 'Original content unavailable',
        },
      ],
      files: [
        {
          ...artifact.files[0],
          unavailableReason: 'Original content unavailable',
          rows: [],
        },
      ],
    };

    expect(isFileReviewArtifact(unavailable)).toBe(true);
  });

  it('keeps changes-no-longer-available as an open-time fallback, not an artifact reason', () => {
    const artifact = makeArtifact();

    expect(
      isFileReviewArtifact({
        ...artifact,
        files: [
          {
            ...artifact.files[0],
            unavailableReason: 'Changes are no longer available',
          },
        ],
      }),
    ).toBe(false);
  });

  it('bounds oversized artifacts into persisted unavailable file summaries', () => {
    const artifact = makeArtifact();
    artifact.files[0] = {
      ...artifact.files[0]!,
      modifiedFingerprint: createReviewContentFingerprint('new\n'),
      rows: Array.from({ length: 40 }, (_, index) => ({
        type: 'context' as const,
        oldLineNumber: index + 1,
        newLineNumber: index + 1,
        text: `large persisted context row ${index} ${'x'.repeat(80)}`,
        tokens: [{ text: 'token', syntaxScopes: ['hljs-keyword'] }],
      })),
    };

    const { artifact: bounded, warnings } = prepareFileReviewArtifactForSession(artifact, {
      maxRows: 1,
    });

    expect(warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('large file rows were collapsed')]),
    );
    expect(isFileReviewArtifact(bounded)).toBe(true);
    expect(JSON.stringify(bounded)).not.toContain('originalContent');
    expect(JSON.stringify(bounded)).not.toContain('modifiedContent');
    expect(bounded.files[0]).toMatchObject({
      path: 'src/app.ts',
      additions: 1,
      deletions: 1,
      unavailableReason: 'Diff too large to review',
      rows: [],
    });
    expect(bounded.files[0]?.modifiedFingerprint).toBeUndefined();
  });

  it('indexes hidden custom review artifact entries by turn and keeps the latest branch entry', () => {
    const first = makeArtifact();
    const second = {
      ...makeArtifact(),
      createdAt: '2026-01-01T00:00:01.000Z',
      files: [{ ...makeArtifact().files[0], additions: 2 }],
    };
    const otherTurn = {
      ...makeArtifact(),
      turnId: 'turn-2',
      records: [{ ...makeArtifact().records[0], turnId: 'turn-2' }],
    };
    const entries: SessionTreeEntry[] = [
      makeCustomEntry('artifact-1', first),
      makeCustomEntry('artifact-2', second),
      makeCustomEntry('artifact-3', otherTurn),
    ];

    const index = collectFileReviewArtifacts(entries);

    expect(index.artifactsByTurnId.get('turn-1')).toMatchObject({
      createdAt: '2026-01-01T00:00:01.000Z',
      files: [expect.objectContaining({ additions: 2 })],
    });
    expect(index.latestTurnId).toBe('turn-2');
    expect(index.latestArtifact).toMatchObject({ turnId: 'turn-2' });
  });

  it('keeps hidden artifact children attached to the current visible branch', () => {
    const currentArtifact = makeArtifact();
    const siblingArtifact = {
      ...makeArtifact(),
      turnId: 'turn-sibling',
      records: [{ ...makeArtifact().records[0], turnId: 'turn-sibling' }],
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

function makeArtifact(): ReturnType<typeof createFileReviewArtifact> {
  const store = new FileReviewStore();
  store.addRecord('turn-1', 'tool-1', {
    kind: 'file_review_payload',
    operation: 'edit',
    path: 'src/app.ts',
    absolutePath: '/workspace/src/app.ts',
    originalContent: 'old\n',
    modifiedContent: 'new\n',
  });
  const review = store.getTurn('turn-1');
  if (!review) throw new Error('Expected review turn');
  return createFileReviewArtifact('session-1', review);
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
