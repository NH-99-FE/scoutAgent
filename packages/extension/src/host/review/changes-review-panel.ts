// ============================================================
// Scout Diff review panel — 多文件变更审查 WebviewPanel
// 负责：只投影轻量文件摘要；展开后的 diff 通过 review protocol 按需请求。
// ============================================================

import * as vscode from 'vscode';
import { isAbsolute, relative } from 'node:path';
import type {
  ScoutChangesReviewFile,
  ScoutChangesReviewHostMessage,
  ScoutChangesReviewModel,
  ScoutChangesReviewViewMode,
  ScoutChangesReviewWebviewMessage,
} from '@scout-agent/shared';
import type { FileReviewFile, FileReviewTurnSnapshot } from '../../core/review/index.ts';
import { formatPathRelativeToCwd } from '../../core/tools/shared/path-utils.ts';
import { configureScoutWebview, getScoutWebviewHtml } from '../../webview-content.ts';
import type {
  FileReviewArtifact,
  FileReviewArtifactFile,
} from '../../core/review/file-review-artifact.ts';

// ---------- 类型 ----------

export interface OpenChangesReviewPanelInput {
  allowCurrentFileContextExpansion?: boolean;
  cwd: string;
  recordId?: string;
  review: FileReviewTurnSnapshot | FileReviewArtifact;
  sessionId: string;
}

export interface OpenCurrentChangesReviewPanelInput {
  cwd: string;
  review?: FileReviewTurnSnapshot | FileReviewArtifact;
  sessionId: string;
}

type ReviewPanelTarget = { kind: 'turn'; turnId: string } | { kind: 'current'; sessionId: string };

// ---------- 常量 ----------

const VIEW_TYPE = 'scout-agent.changesReview';
const VIEW_MODE_KEY = 'scout.changesReview.viewMode';
const SCOUT_DIFF_TITLE = 'Scout Diff';
const REVIEW_PANEL_RENDER_VERSION = 3;

// ---------- Manager ----------

export class ScoutChangesReviewPanelManager implements vscode.Disposable {
  private readonly extensionUri: vscode.Uri;
  private readonly globalState: vscode.Memento;
  private readonly isDev: boolean;
  private readonly bindProtocol?: (webview: vscode.Webview) => vscode.Disposable;
  private panel?: vscode.WebviewPanel;
  private messageSubscription?: vscode.Disposable;
  private protocolSubscription?: vscode.Disposable;
  private signature?: string;
  private target?: ReviewPanelTarget;

  constructor(
    extensionUri: vscode.Uri,
    globalState: vscode.Memento,
    isDev: boolean,
    bindProtocol?: (webview: vscode.Webview) => vscode.Disposable,
  ) {
    this.extensionUri = extensionUri;
    this.globalState = globalState;
    this.isDev = isDev;
    this.bindProtocol = bindProtocol;
  }

  async open(input: OpenChangesReviewPanelInput): Promise<void> {
    const model = await createReviewPanelModel(input, this.getViewMode());
    const signature = createPanelSignature(model);
    const target: ReviewPanelTarget = { kind: 'turn', turnId: model.turnId };
    const targetChanged = !isSameReviewPanelTarget(this.target, target);
    const panel = this.ensurePanel();
    this.target = target;
    panel.title = SCOUT_DIFF_TITLE;
    panel.reveal(this.getTargetColumn());

    if (targetChanged || this.signature !== signature) {
      await this.render(panel, model);
      this.signature = signature;
    } else if (input.recordId) {
      void this.postPanelMessage(panel, {
        type: 'changes_review_scroll_to_record',
        recordId: input.recordId,
      });
    }
  }

  async openCurrent(input: OpenCurrentChangesReviewPanelInput): Promise<void> {
    const model = input.review
      ? await createReviewPanelModel(
          {
            allowCurrentFileContextExpansion: true,
            cwd: input.cwd,
            review: input.review,
            sessionId: input.sessionId,
          },
          this.getViewMode(),
        )
      : undefined;
    const signature = model
      ? createPanelSignature(model)
      : createCurrentPendingPanelSignature(input.sessionId);
    const target: ReviewPanelTarget = { kind: 'current', sessionId: input.sessionId };
    const targetChanged = !isSameReviewPanelTarget(this.target, target);
    const panel = this.ensurePanel();
    this.target = target;
    panel.title = SCOUT_DIFF_TITLE;
    panel.reveal(this.getTargetColumn());

    if (targetChanged || this.signature === undefined) {
      await this.render(panel, model);
    } else if (this.signature !== signature) {
      await this.updatePanelModel(panel, model);
    }
    this.signature = signature;
  }

  async updateCurrent(input: OpenCurrentChangesReviewPanelInput): Promise<void> {
    const panel = this.panel;
    if (!panel || !isCurrentReviewPanelTarget(this.target, input.sessionId)) return;
    const model = input.review
      ? await createReviewPanelModel(
          {
            allowCurrentFileContextExpansion: true,
            cwd: input.cwd,
            review: input.review,
            sessionId: input.sessionId,
          },
          this.getViewMode(),
        )
      : undefined;
    const signature = model
      ? createPanelSignature(model)
      : createCurrentPendingPanelSignature(input.sessionId);
    if (this.signature === signature) return;
    await this.updatePanelModel(panel, model);
    this.signature = signature;
  }

  dispose(): void {
    this.messageSubscription?.dispose();
    this.protocolSubscription?.dispose();
    this.panel?.dispose();
    this.messageSubscription = undefined;
    this.protocolSubscription = undefined;
    this.panel = undefined;
    this.signature = undefined;
    this.target = undefined;
  }

  private async render(
    panel: vscode.WebviewPanel,
    model: ScoutChangesReviewModel | undefined,
  ): Promise<void> {
    panel.webview.html = await getScoutWebviewHtml(
      this.extensionUri,
      panel.webview,
      this.isDev,
      'changes-review',
      undefined,
      { changesReview: model },
    );
  }

  private async postPanelMessage(
    panel: vscode.WebviewPanel,
    message: ScoutChangesReviewHostMessage,
  ): Promise<boolean> {
    return await panel.webview.postMessage(message);
  }

  private async updatePanelModel(
    panel: vscode.WebviewPanel,
    model: ScoutChangesReviewModel | undefined,
  ): Promise<void> {
    const delivered = await this.postPanelMessage(panel, {
      type: 'changes_review_model_update',
      model,
    });
    if (!delivered) await this.render(panel, model);
  }

  private ensurePanel(): vscode.WebviewPanel {
    if (this.panel) return this.panel;
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      SCOUT_DIFF_TITLE,
      this.getTargetColumn(),
      {
        enableScripts: true,
        retainContextWhenHidden: false,
      },
    );
    configureScoutWebview(this.extensionUri, panel.webview);
    this.panel = panel;
    this.protocolSubscription = this.bindProtocol?.(panel.webview);
    this.messageSubscription = panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message);
    });
    panel.onDidDispose(() => {
      this.messageSubscription?.dispose();
      this.protocolSubscription?.dispose();
      this.messageSubscription = undefined;
      this.protocolSubscription = undefined;
      this.panel = undefined;
      this.signature = undefined;
      this.target = undefined;
    });
    return panel;
  }

  private getTargetColumn(): vscode.ViewColumn {
    return vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
  }

  private getViewMode(): ScoutChangesReviewViewMode {
    const value = this.globalState.get<ScoutChangesReviewViewMode>(VIEW_MODE_KEY);
    return value === 'split' ? 'split' : 'unified';
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object') return;
    const typed = message as Partial<ScoutChangesReviewWebviewMessage>;
    if (
      typed.type === 'changes_review_set_view_mode' &&
      (typed.mode === 'unified' || typed.mode === 'split')
    ) {
      await this.globalState.update(VIEW_MODE_KEY, typed.mode);
      return;
    }
    if (typed.type === 'changes_review_open_file' && typeof typed.path === 'string') {
      try {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(typed.path));
        await vscode.window.showTextDocument(document, { preview: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showInformationMessage(`Unable to open file: ${message}`);
      }
    }
  }
}

// ---------- Model ----------

async function createReviewPanelModel(
  input: OpenChangesReviewPanelInput,
  viewMode: ScoutChangesReviewViewMode,
): Promise<ScoutChangesReviewModel> {
  const files = input.review.files.map((file) =>
    createReviewPanelFile(file, input.cwd, input.sessionId),
  );
  return {
    turnId: input.review.turnId,
    viewMode,
    scrollToRecordId: input.recordId,
    files,
    totals: {
      fileCount: files.length,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    },
  };
}

function createReviewPanelFile(
  file: FileReviewFile | FileReviewArtifactFile,
  cwd: string,
  sessionId: string,
): ScoutChangesReviewFile {
  const common = {
    id: createReviewPanelFileId(file.absolutePath),
    path: file.absolutePath,
    displayPath: formatDisplayPath(cwd, file.absolutePath),
    absolutePath: file.absolutePath,
    external: isExternalPath(cwd, file.absolutePath),
    sessionId,
    recordIds: [...file.recordIds],
    rows: [],
  };

  if (isArtifactFile(file)) {
    return {
      ...common,
      fileId: file.fileId,
      revision: file.latestRevision,
      projectionStatus: file.document.unavailableReason ? 'unavailable' : 'ready',
      additions: file.document.additions,
      deletions: file.document.deletions,
      unavailableReason: file.document.unavailableReason,
    };
  }

  return {
    ...common,
    fileId: file.fileId,
    revision: file.revision,
    projectionStatus: file.projectionStatus,
    additions: file.additions,
    deletions: file.deletions,
    unavailableReason: file.unavailableReason,
  };
}

function isArtifactFile(
  file: FileReviewFile | FileReviewArtifactFile,
): file is FileReviewArtifactFile {
  return 'latestRevision' in file;
}

function formatDisplayPath(cwd: string, absolutePath: string): string {
  return formatPathRelativeToCwd(absolutePath, cwd);
}

function createReviewPanelFileId(absolutePath: string): string {
  return `file-${encodeURIComponent(absolutePath)}`;
}

function isExternalPath(cwd: string, absolutePath: string): boolean {
  if (!cwd) return false;
  const rel = relative(cwd, absolutePath);
  return rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel);
}

function createPanelSignature(model: ScoutChangesReviewModel): string {
  return JSON.stringify({
    renderVersion: REVIEW_PANEL_RENDER_VERSION,
    turnId: model.turnId,
    viewMode: model.viewMode,
    files: model.files.map((file) => ({
      path: file.path,
      displayPath: file.displayPath,
      additions: file.additions,
      deletions: file.deletions,
      fileId: file.fileId,
      revision: file.revision,
      projectionStatus: file.projectionStatus,
      unavailableReason: file.unavailableReason,
      recordIds: file.recordIds,
    })),
  });
}

function createCurrentPendingPanelSignature(sessionId: string): string {
  return JSON.stringify({
    renderVersion: REVIEW_PANEL_RENDER_VERSION,
    kind: 'current_pending',
    sessionId,
  });
}

function isSameReviewPanelTarget(
  left: ReviewPanelTarget | undefined,
  right: ReviewPanelTarget,
): boolean {
  if (!left || left.kind !== right.kind) return false;
  if (left.kind === 'turn' && right.kind === 'turn') return left.turnId === right.turnId;
  return left.kind === 'current' && right.kind === 'current' && left.sessionId === right.sessionId;
}

function isCurrentReviewPanelTarget(
  target: ReviewPanelTarget | undefined,
  sessionId: string,
): target is { kind: 'current'; sessionId: string } {
  return target?.kind === 'current' && target.sessionId === sessionId;
}
