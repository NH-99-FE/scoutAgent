import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { createDiffDocument } from '../../../src/core/review/diff-document.ts';
import type { FileReviewTurnSnapshot } from '../../../src/core/review/file-review.ts';
import type { ReviewArtifactManifest } from '../../../src/core/review/review-artifact.ts';
import { ScoutChangesReviewPanelManager } from '../../../src/host/review/changes-review-panel.ts';
import { getScoutWebviewHtml } from '../../../src/webview-content.ts';

vi.mock('../../../src/webview-content.ts', () => ({
  configureScoutWebview: vi.fn(),
  getScoutWebviewHtml: vi.fn(async () => '<html></html>'),
}));

function makeWebview() {
  let html = '';
  let messageListener: ((message: unknown) => void) | undefined;
  return {
    options: {},
    get html() {
      return html;
    },
    set html(value: string) {
      html = value;
    },
    onDidReceiveMessage: vi.fn((listener: (message: unknown) => void) => {
      messageListener = listener;
      return { dispose: vi.fn() };
    }),
    postMessage: vi.fn(async () => true),
    receive: (message: unknown) => messageListener?.(message),
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
    vi.mocked(getScoutWebviewHtml).mockClear();
  });

  it('renders only lazy file metadata and reuses the panel for record scrolling', async () => {
    const panel = makePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
    const manager = new ScoutChangesReviewPanelManager(
      vscode.Uri.file('/extension'),
      makeGlobalState(),
      false,
    );
    const review = makeReviewSnapshot();

    await manager.open({
      cwd: '/workspace',
      recordId: 'record-1',
      review,
      sessionId: 'session-1',
    });
    await manager.open({
      cwd: '/workspace',
      recordId: 'record-2',
      review,
      sessionId: 'session-1',
    });

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(getScoutWebviewHtml).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(getScoutWebviewHtml).mock.calls[0]?.[5]?.changesReview?.files[0],
    ).toMatchObject({
      path: '/workspace/src/app.ts',
      displayPath: 'src/app.ts',
      sessionId: 'session-1',
      fileId: 'file-1',
      revision: 1,
      projectionStatus: 'ready',
      additions: 1,
      deletions: 1,
      rows: [],
    });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'changes_review_scroll_to_record',
      recordId: 'record-2',
    });
  });

  it('projects artifact v2 metadata without materializing document rows', async () => {
    const panel = makePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
    const manager = new ScoutChangesReviewPanelManager(
      vscode.Uri.file('/extension'),
      makeGlobalState(),
      false,
    );

    await manager.open({
      cwd: '/workspace',
      review: makeArtifact(),
      sessionId: 'session-1',
    });

    expect(
      vi.mocked(getScoutWebviewHtml).mock.calls[0]?.[5]?.changesReview?.files[0],
    ).toMatchObject({
      fileId: 'file-1',
      revision: 2,
      projectionStatus: 'ready',
      rows: [],
    });
  });

  it('binds the generic protocol surface for lazy requests and releases it with the panel', async () => {
    const panel = makePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
    const protocolDisposable = { dispose: vi.fn() };
    const bindProtocol = vi.fn(() => protocolDisposable);
    const manager = new ScoutChangesReviewPanelManager(
      vscode.Uri.file('/extension'),
      makeGlobalState(),
      false,
      bindProtocol,
    );

    await manager.open({
      cwd: '/workspace',
      review: makeReviewSnapshot(),
      sessionId: 'session-1',
    });
    panel.dispose();

    expect(bindProtocol).toHaveBeenCalledWith(panel.webview);
    expect(protocolDisposable.dispose).toHaveBeenCalledTimes(1);
  });

  it('opens current review as pending and updates it after projection lands', async () => {
    const panel = makePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
    const manager = new ScoutChangesReviewPanelManager(
      vscode.Uri.file('/extension'),
      makeGlobalState(),
      false,
    );

    await manager.openCurrent({ cwd: '/workspace', sessionId: 'session-1' });
    await manager.updateCurrent({
      cwd: '/workspace',
      review: makeReviewSnapshot(),
      sessionId: 'session-1',
    });

    expect(vi.mocked(getScoutWebviewHtml).mock.calls[0]?.[5]?.changesReview).toBeUndefined();
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'changes_review_model_update',
        model: expect.objectContaining({ turnId: 'turn-1' }),
      }),
    );
  });
});

function makeReviewSnapshot(): FileReviewTurnSnapshot {
  const document = createDiffDocument('const value = 1;\n', 'const value = 2;\n');
  return {
    turnId: 'turn-1',
    phase: 'active',
    files: [
      {
        absolutePath: '/workspace/src/app.ts',
        path: 'src/app.ts',
        displayPath: 'src/app.ts',
        originalContent: 'const value = 1;\n',
        modifiedContent: 'const value = 2;\n',
        document,
        fileId: 'file-1',
        revision: 1,
        projectionStatus: 'ready',
        recordIds: ['record-1', 'record-2'],
        latestRecordId: 'record-2',
        latestSequence: 2,
        additions: document.additions,
        deletions: document.deletions,
        firstChangedLine: document.firstChangedLine,
      },
    ],
    records: [],
  };
}

function makeArtifact(): ReviewArtifactManifest {
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
        before: { kind: 'absent' },
        after: { kind: 'absent' },
      },
    ],
    files: [
      {
        fileId: 'file-1',
        path: 'src/app.ts',
        absolutePath: '/workspace/src/app.ts',
        displayPath: 'src/app.ts',
        recordIds: ['record-1'],
        latestRevision: 2,
        additions: 1,
        deletions: 1,
        baseline: { kind: 'absent' },
        final: { kind: 'absent' },
      },
    ],
  };
}
