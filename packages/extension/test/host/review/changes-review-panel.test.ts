import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  createReviewContentFingerprint,
  MAX_REVIEW_TEXT_BYTES,
  type FileReviewTurnSnapshot,
} from '../../../src/core/review/file-review.ts';
import type { FileReviewArtifact } from '../../../src/host/review/file-review-artifact.ts';
import { ScoutChangesReviewPanelManager } from '../../../src/host/review/changes-review-panel.ts';
import { getScoutWebviewHtml } from '../../../src/webview-content.ts';

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
    stat: vi.fn(actual.stat),
  };
});

vi.mock('../../../src/webview-content.ts', () => ({
  configureScoutWebview: vi.fn(),
  getScoutWebviewHtml: vi.fn(async () => '<html></html>'),
}));

function makeWebview() {
  let html = '';
  return {
    options: {},
    get html() {
      return html;
    },
    set html(value: string) {
      html = value;
    },
    onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
    postMessage: vi.fn(),
  };
}

function makePanel() {
  let disposeListener: (() => void) | undefined;
  const panel = {
    title: '',
    webview: makeWebview(),
    reveal: vi.fn(),
    dispose: vi.fn(() => disposeListener?.()),
    onDidDispose: vi.fn((listener: () => void) => {
      disposeListener = listener;
      return { dispose: vi.fn() };
    }),
  };
  return panel;
}

function makeGlobalState(): vscode.Memento {
  const values = new Map<string, unknown>();
  return {
    get: vi.fn((key: string) => values.get(key)),
    update: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
  } as unknown as vscode.Memento;
}

describe('ScoutChangesReviewPanelManager', () => {
  beforeEach(() => {
    vi.mocked(vscode.window.createWebviewPanel).mockReset();
    vi.mocked(fsPromises.readFile).mockClear();
    vi.mocked(fsPromises.stat).mockClear();
    vi.mocked(getScoutWebviewHtml).mockClear();
  });

  it('reuses the same panel content and posts scroll messages for the same review', async () => {
    const panel = makePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
    const manager = new ScoutChangesReviewPanelManager(
      vscode.Uri.file('/extension'),
      makeGlobalState(),
      false,
    );
    const review = makeReviewSnapshot();

    await manager.open({ cwd: '/workspace', recordId: 'review-1', review });
    await manager.open({ cwd: '/workspace', recordId: 'review-2', review });

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      'scout-agent.changesReview',
      'Scout Diff',
      expect.any(Number),
      expect.any(Object),
    );
    expect(panel.title).toBe('Scout Diff');
    expect(getScoutWebviewHtml).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'scroll_to_record',
      recordId: 'review-2',
    });
  });

  it('hydrates syntax and intraline diff tokens for persisted rows without tokens', async () => {
    const panel = makePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
    const manager = new ScoutChangesReviewPanelManager(
      vscode.Uri.file('/extension'),
      makeGlobalState(),
      false,
    );

    await manager.open({ cwd: '/workspace', review: makeReviewArtifact() });

    const bootstrapData = vi.mocked(getScoutWebviewHtml).mock.calls[0]?.[5];
    const rows = bootstrapData?.changesReview?.files[0]?.rows;
    expect(rows?.[0]?.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'const',
          syntaxScopes: expect.arrayContaining(['hljs-keyword']),
        }),
        expect.objectContaining({
          text: '1',
          diff: 'removed',
          syntaxScopes: expect.arrayContaining(['hljs-number']),
        }),
      ]),
    );
    expect(rows?.[1]?.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: '2',
          diff: 'added',
          syntaxScopes: expect.arrayContaining(['hljs-number']),
        }),
      ]),
    );
  });

  it('renders released runtime snapshots as unavailable without recomputing an empty diff', async () => {
    const panel = makePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
    const manager = new ScoutChangesReviewPanelManager(
      vscode.Uri.file('/extension'),
      makeGlobalState(),
      false,
    );
    const review = makeReviewSnapshot();
    const releasedReview: FileReviewTurnSnapshot = {
      ...review,
      contentReleased: true,
      files: review.files.map((file) => ({
        ...file,
        originalContent: null,
        modifiedContent: null,
      })),
    };

    await manager.open({ cwd: '/workspace', review: releasedReview });

    const bootstrapData = vi.mocked(getScoutWebviewHtml).mock.calls[0]?.[5];
    expect(bootstrapData?.changesReview?.files[0]).toMatchObject({
      additions: 1,
      deletions: 1,
      unavailableReason: 'Changes are no longer available',
      rows: [],
    });
  });

  it('does not hydrate folded context for historical persisted reviews', async () => {
    const panel = makePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
    const manager = new ScoutChangesReviewPanelManager(
      vscode.Uri.file('/extension'),
      makeGlobalState(),
      false,
    );
    const { artifact, tempDir } = makeFoldedReviewArtifact();

    try {
      await manager.open({
        allowCurrentFileContextExpansion: false,
        cwd: '/workspace',
        review: artifact,
      });

      const bootstrapData = vi.mocked(getScoutWebviewHtml).mock.calls[0]?.[5];
      const fold = bootstrapData?.changesReview?.files[0]?.rows.find((row) => row.type === 'fold');
      expect(fold?.hiddenRows).toBeUndefined();
      expect(bootstrapData?.changesReview?.files[0]?.statusNote).toBeUndefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('hydrates folded context for the latest persisted review when fingerprints match', async () => {
    const panel = makePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
    const manager = new ScoutChangesReviewPanelManager(
      vscode.Uri.file('/extension'),
      makeGlobalState(),
      false,
    );
    const { artifact, tempDir } = makeFoldedReviewArtifact();

    try {
      await manager.open({
        allowCurrentFileContextExpansion: true,
        cwd: '/workspace',
        review: artifact,
      });

      const bootstrapData = vi.mocked(getScoutWebviewHtml).mock.calls[0]?.[5];
      const fold = bootstrapData?.changesReview?.files[0]?.rows.find((row) => row.type === 'fold');
      expect(fold?.hiddenRows).toEqual([
        expect.objectContaining({ newLineNumber: 2, text: 'line-2' }),
        expect.objectContaining({ newLineNumber: 3, text: 'line-3' }),
      ]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('checks current file size before reading latest persisted review context', async () => {
    const panel = makePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
    const manager = new ScoutChangesReviewPanelManager(
      vscode.Uri.file('/extension'),
      makeGlobalState(),
      false,
    );
    const { artifact, filePath, modifiedContent, tempDir } = makeFoldedReviewArtifact();
    artifact.files[0] = {
      ...artifact.files[0]!,
      modifiedFingerprint: createReviewContentFingerprint(`${modifiedContent}x`),
    };

    try {
      await manager.open({
        allowCurrentFileContextExpansion: true,
        cwd: '/workspace',
        review: artifact,
      });

      const bootstrapData = vi.mocked(getScoutWebviewHtml).mock.calls[0]?.[5];
      const fold = bootstrapData?.changesReview?.files[0]?.rows.find((row) => row.type === 'fold');
      expect(vi.mocked(fsPromises.stat)).toHaveBeenCalledWith(filePath);
      expect(vi.mocked(fsPromises.readFile)).not.toHaveBeenCalled();
      expect(fold?.hiddenRows).toBeUndefined();
      expect(bootstrapData?.changesReview?.files[0]?.statusNote).toContain('File changed');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('does not read oversized current files for latest persisted review expansion', async () => {
    const panel = makePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
    const manager = new ScoutChangesReviewPanelManager(
      vscode.Uri.file('/extension'),
      makeGlobalState(),
      false,
    );
    const { artifact, filePath, tempDir } = makeFoldedReviewArtifact();
    const oversizedContent = 'x'.repeat(MAX_REVIEW_TEXT_BYTES + 1);
    fs.writeFileSync(filePath, oversizedContent, 'utf-8');
    artifact.files[0] = {
      ...artifact.files[0]!,
      modifiedFingerprint: createReviewContentFingerprint(oversizedContent),
    };

    try {
      await manager.open({
        allowCurrentFileContextExpansion: true,
        cwd: '/workspace',
        review: artifact,
      });

      const bootstrapData = vi.mocked(getScoutWebviewHtml).mock.calls[0]?.[5];
      expect(vi.mocked(fsPromises.stat)).toHaveBeenCalledWith(filePath);
      expect(vi.mocked(fsPromises.readFile)).not.toHaveBeenCalled();
      expect(bootstrapData?.changesReview?.files[0]?.statusNote).toContain('too large');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('bounds hydrated hidden rows for large folded context blocks', async () => {
    const panel = makePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
    const manager = new ScoutChangesReviewPanelManager(
      vscode.Uri.file('/extension'),
      makeGlobalState(),
      false,
    );
    const { artifact, tempDir } = makeFoldedReviewArtifact({
      hiddenLineCount: 1_000,
    });

    try {
      await manager.open({
        allowCurrentFileContextExpansion: true,
        cwd: '/workspace',
        review: artifact,
      });

      const bootstrapData = vi.mocked(getScoutWebviewHtml).mock.calls[0]?.[5];
      const fold = bootstrapData?.changesReview?.files[0]?.rows.find((row) => row.type === 'fold');
      expect(fold?.hiddenRows).toBeUndefined();
      expect(bootstrapData?.changesReview?.files[0]?.statusNote).toContain(
        'Large collapsed context',
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function makeReviewSnapshot(): FileReviewTurnSnapshot {
  return {
    turnId: 'turn-1',
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
      {
        recordId: 'review-2',
        turnId: 'turn-1',
        toolCallId: 'tool-2',
        operation: 'edit',
        path: 'src/app.ts',
        absolutePath: '/workspace/src/app.ts',
        sequence: 2,
      },
    ],
    files: [
      {
        absolutePath: '/workspace/src/app.ts',
        path: 'src/app.ts',
        originalContent: 'old\n',
        modifiedContent: 'new\n',
        recordIds: ['review-1', 'review-2'],
        latestRecordId: 'review-2',
        latestSequence: 2,
        additions: 1,
        deletions: 1,
      },
    ],
  };
}

function makeReviewArtifact(): FileReviewArtifact {
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
        rows: [
          { type: 'removed', oldLineNumber: 1, text: 'const value = 1;' },
          { type: 'added', newLineNumber: 1, text: 'const value = 2;' },
        ],
      },
    ],
  };
}

function makeFoldedReviewArtifact(options: { hiddenLineCount?: number } = {}): {
  artifact: FileReviewArtifact;
  filePath: string;
  modifiedContent: string;
  tempDir: string;
} {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-review-panel-'));
  const filePath = path.join(tempDir, 'app.ts');
  const hiddenLineCount = options.hiddenLineCount ?? 2;
  const hiddenLines = Array.from({ length: hiddenLineCount }, (_, index) => `line-${index + 2}`);
  const changedLineNumber = hiddenLineCount + 2;
  const modifiedContent = ['line-1', ...hiddenLines, 'new'].join('\n');
  fs.writeFileSync(filePath, modifiedContent, 'utf-8');
  return {
    filePath,
    modifiedContent,
    tempDir,
    artifact: {
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
          path: 'app.ts',
          absolutePath: filePath,
          sequence: 1,
        },
      ],
      files: [
        {
          absolutePath: filePath,
          path: 'app.ts',
          recordIds: ['review-1'],
          latestRecordId: 'review-1',
          latestSequence: 1,
          additions: 1,
          deletions: 1,
          modifiedFingerprint: createReviewContentFingerprint(modifiedContent),
          rows: [
            { type: 'context', oldLineNumber: 1, newLineNumber: 1, text: 'line-1' },
            { type: 'fold', count: hiddenLineCount, oldStartLine: 2, newStartLine: 2 },
            { type: 'removed', oldLineNumber: changedLineNumber, text: 'old' },
            { type: 'added', newLineNumber: changedLineNumber, text: 'new' },
          ],
        },
      ],
    },
  };
}
