// ============================================================
// Scout Diff review panel — 多文件变更审查 WebviewPanel
// 负责：渲染 runtime review store 快照，支持 unified/split diff 视图
// ============================================================

import * as vscode from 'vscode';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import type {
  ScoutChangesReviewFile,
  ScoutChangesReviewModel,
  ScoutChangesReviewRow,
  ScoutChangesReviewViewMode,
  ScoutChangesReviewWebviewMessage,
} from '@scout-agent/shared';
import type { FileReviewFile, FileReviewTurnSnapshot } from '../../core/review/file-review.ts';
import type { FileReviewArtifact, FileReviewArtifactFile } from './file-review-artifact.ts';
import { MAX_REVIEW_TEXT_BYTES } from '../../core/text-size.ts';
import { formatPathRelativeToCwd } from '../../core/tools/shared/path-utils.ts';
import {
  computeReviewDiff,
  createReviewContentFingerprint,
  decodeReviewContent,
  isSameReviewContentFingerprint,
  REVIEW_CONTEXT_LINES,
  type FileReviewContentFingerprint,
  type ReviewDisplayRow,
} from '../../core/review/file-review.ts';
import {
  addReviewRowTokens,
  createReviewLineTokens,
} from '../../core/review/review-syntax-tokens.ts';
import { splitReviewLines } from '../../core/review/review-text.ts';
import { configureScoutWebview, getScoutWebviewHtml } from '../../webview-content.ts';

// ---------- 类型 ----------

export interface OpenChangesReviewPanelInput {
  allowCurrentFileContextExpansion?: boolean;
  cwd: string;
  recordId?: string;
  review: FileReviewTurnSnapshot | FileReviewArtifact;
}

type ReviewPanelRow = ScoutChangesReviewRow;

// ---------- 常量 ----------

const VIEW_TYPE = 'scout-agent.changesReview';
const VIEW_MODE_KEY = 'scout.changesReview.viewMode';
const SCOUT_DIFF_TITLE = 'Scout Diff';
const REVIEW_PANEL_RENDER_VERSION = 2;
const MAX_CURRENT_REVIEW_CONTENT_BYTES = MAX_REVIEW_TEXT_BYTES;
const MAX_REVIEW_HIDDEN_CONTEXT_ROWS = 500;
const MAX_REVIEW_HIDDEN_CONTEXT_BYTES = 256 * 1024;
const MAX_REVIEW_HIDDEN_CONTEXT_TOKENS = 20_000;
const FILE_CHANGED_STATUS_NOTE =
  'File changed since this review; collapsed context cannot be expanded.';
const FILE_TOO_LARGE_STATUS_NOTE =
  'Current file is too large to read for collapsed context expansion.';
const FOLD_CONTEXT_LIMIT_STATUS_NOTE =
  'Large collapsed context is not expanded to keep the review responsive.';

// ---------- Manager ----------

export class ScoutChangesReviewPanelManager implements vscode.Disposable {
  private readonly extensionUri: vscode.Uri;
  private readonly globalState: vscode.Memento;
  private readonly isDev: boolean;
  private panel?: vscode.WebviewPanel;
  private messageSubscription?: vscode.Disposable;
  private signature?: string;

  constructor(extensionUri: vscode.Uri, globalState: vscode.Memento, isDev: boolean) {
    this.extensionUri = extensionUri;
    this.globalState = globalState;
    this.isDev = isDev;
  }

  async open(input: OpenChangesReviewPanelInput): Promise<void> {
    const model = await createReviewPanelModel(input, this.getViewMode());
    const signature = createPanelSignature(model);
    const panel = this.ensurePanel();
    panel.title = SCOUT_DIFF_TITLE;
    panel.reveal(this.getTargetColumn());

    if (this.signature !== signature) {
      panel.webview.html = await getScoutWebviewHtml(
        this.extensionUri,
        panel.webview,
        this.isDev,
        'changes-review',
        undefined,
        { changesReview: model },
      );
      this.signature = signature;
    } else if (input.recordId) {
      void panel.webview.postMessage({ type: 'scroll_to_record', recordId: input.recordId });
    }
  }

  dispose(): void {
    this.messageSubscription?.dispose();
    this.panel?.dispose();
    this.messageSubscription = undefined;
    this.panel = undefined;
    this.signature = undefined;
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
    this.messageSubscription = panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message);
    });
    panel.onDidDispose(() => {
      this.messageSubscription?.dispose();
      this.messageSubscription = undefined;
      this.panel = undefined;
      this.signature = undefined;
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
  const runtimeContentReleased = isRuntimeReviewContentReleased(input.review);
  const files = await Promise.all(
    input.review.files.map((file, index) =>
      createReviewPanelFile(
        file,
        input.cwd,
        index,
        input.allowCurrentFileContextExpansion ?? false,
        runtimeContentReleased,
      ),
    ),
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

async function createReviewPanelFile(
  file: FileReviewFile | FileReviewArtifactFile,
  cwd: string,
  index: number,
  allowCurrentFileContextExpansion: boolean,
  runtimeContentReleased: boolean,
): Promise<ScoutChangesReviewFile> {
  const displayPath = formatDisplayPath(cwd, file.absolutePath);
  if (isArtifactFile(file)) {
    const hydrated = await hydrateArtifactRows(file, allowCurrentFileContextExpansion);
    return {
      id: `file-${index}`,
      path: file.absolutePath,
      displayPath,
      absolutePath: file.absolutePath,
      external: isExternalPath(cwd, file.absolutePath),
      additions: file.additions,
      deletions: file.deletions,
      recordIds: file.recordIds,
      unavailableReason: file.unavailableReason,
      statusNote: hydrated.statusNote,
      rows: addReviewRowTokens(hydrated.rows, file.absolutePath),
    };
  }

  if (runtimeContentReleased) {
    return {
      id: `file-${index}`,
      path: file.absolutePath,
      displayPath,
      absolutePath: file.absolutePath,
      external: isExternalPath(cwd, file.absolutePath),
      additions: file.additions,
      deletions: file.deletions,
      recordIds: file.recordIds,
      unavailableReason: 'Changes are no longer available',
      rows: [],
    };
  }

  const diff = computeReviewDiff(file.originalContent, file.modifiedContent, {
    collapseContext: true,
    contextLines: REVIEW_CONTEXT_LINES,
    filePath: file.absolutePath,
    includeTokens: true,
    unavailableReason: file.unavailableReason,
  });
  const hydrated = hydrateFoldRowsFromContent(diff.rows, file.modifiedContent, file.absolutePath);
  return {
    id: `file-${index}`,
    path: file.absolutePath,
    displayPath,
    absolutePath: file.absolutePath,
    external: isExternalPath(cwd, file.absolutePath),
    additions: diff.unavailableReason ? file.additions : diff.additions,
    deletions: diff.unavailableReason ? file.deletions : diff.deletions,
    recordIds: file.recordIds,
    unavailableReason: diff.unavailableReason,
    statusNote: hydrated.limited ? FOLD_CONTEXT_LIMIT_STATUS_NOTE : undefined,
    rows: hydrated.rows,
  };
}

function isRuntimeReviewContentReleased(
  review: FileReviewTurnSnapshot | FileReviewArtifact,
): boolean {
  return 'contentReleased' in review && review.contentReleased === true;
}

async function hydrateArtifactRows(
  file: FileReviewArtifactFile,
  allowCurrentFileContextExpansion: boolean,
): Promise<{ rows: ReviewPanelRow[]; statusNote?: string }> {
  if (file.unavailableReason || !hasExpandableFold(file.rows)) {
    return { rows: file.rows };
  }
  if (!allowCurrentFileContextExpansion) {
    return { rows: file.rows };
  }
  if (!file.modifiedFingerprint) {
    return {
      rows: file.rows,
      statusNote: FILE_CHANGED_STATUS_NOTE,
    };
  }

  const current = await readCurrentReviewContent(file.absolutePath, file.modifiedFingerprint);
  if (current.content === undefined) {
    return {
      rows: file.rows,
      statusNote: current.statusNote,
    };
  }

  const currentFingerprint = createReviewContentFingerprint(current.content);
  if (!isSameReviewContentFingerprint(file.modifiedFingerprint, currentFingerprint)) {
    return { rows: file.rows, statusNote: FILE_CHANGED_STATUS_NOTE };
  }

  const hydrated = hydrateFoldRowsFromContent(file.rows, current.content, file.absolutePath);
  return {
    rows: hydrated.rows,
    statusNote: hydrated.limited ? FOLD_CONTEXT_LIMIT_STATUS_NOTE : undefined,
  };
}

function hasExpandableFold(rows: readonly ReviewDisplayRow[]): boolean {
  return rows.some((row) => row.type === 'fold' && Boolean(row.count && row.newStartLine));
}

async function readCurrentReviewContent(
  absolutePath: string,
  expectedFingerprint: FileReviewContentFingerprint,
): Promise<{ content?: string; statusNote: string }> {
  try {
    const fileStat = await stat(absolutePath);
    if (fileStat.size !== expectedFingerprint.size) {
      return { statusNote: FILE_CHANGED_STATUS_NOTE };
    }
    if (fileStat.size > MAX_CURRENT_REVIEW_CONTENT_BYTES) {
      return { statusNote: FILE_TOO_LARGE_STATUS_NOTE };
    }
    const decoded = decodeReviewContent(await readFile(absolutePath));
    if (decoded.content === null) {
      return {
        statusNote: 'File cannot be decoded; collapsed context cannot be expanded.',
      };
    }
    return { content: decoded.content, statusNote: '' };
  } catch (error) {
    const code =
      error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
    if (code === 'ENOENT') {
      return { statusNote: FILE_CHANGED_STATUS_NOTE };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      statusNote: `File cannot be read; collapsed context cannot be expanded. ${message}`,
    };
  }
}

function hydrateFoldRowsFromContent(
  rows: readonly ReviewDisplayRow[],
  modifiedContent: string | null,
  filePath: string,
): { rows: ReviewPanelRow[]; limited: boolean } {
  if (modifiedContent === null) return { rows: [...rows], limited: false };
  if (!hasExpandableFold(rows)) return { rows: [...rows], limited: false };
  const lines = splitReviewLines(modifiedContent);
  const budget: HiddenContextBudget = {
    remainingRows: MAX_REVIEW_HIDDEN_CONTEXT_ROWS,
    remainingBytes: MAX_REVIEW_HIDDEN_CONTEXT_BYTES,
    remainingTokens: MAX_REVIEW_HIDDEN_CONTEXT_TOKENS,
  };
  let limited = false;
  const next = rows.map((row) => {
    if (row.type !== 'fold') return row;
    const hiddenRows = createHiddenContextRows(row, lines, filePath, budget);
    if (hiddenRows === undefined) {
      limited = true;
      return row;
    }
    if (hiddenRows.length === 0) return row;
    return { ...row, hiddenRows };
  });
  return { rows: next, limited };
}

interface HiddenContextBudget {
  remainingRows: number;
  remainingBytes: number;
  remainingTokens: number;
}

function createHiddenContextRows(
  fold: ReviewDisplayRow,
  modifiedLines: readonly string[],
  filePath: string,
  budget: HiddenContextBudget,
): ScoutChangesReviewRow[] | undefined {
  const count = fold.count ?? 0;
  const newStartLine = fold.newStartLine;
  if (!newStartLine || count <= 0) return [];
  const measurement = measureHiddenContext(fold, modifiedLines);
  if (!measurement) return undefined;
  if (measurement.count > budget.remainingRows || measurement.byteLength > budget.remainingBytes) {
    return undefined;
  }

  const oldStartLine = fold.oldStartLine ?? newStartLine;
  const hiddenTexts = modifiedLines.slice(newStartLine - 1, newStartLine - 1 + count);
  if (hiddenTexts.length !== count) return undefined;
  const tokenLines = createReviewLineTokens(hiddenTexts.join('\n'), filePath);
  const tokenCount = tokenLines.reduce((sum, tokens) => sum + tokens.length, 0);
  if (tokenCount > budget.remainingTokens) return undefined;

  const rows: ScoutChangesReviewRow[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const newLineNumber = newStartLine + offset;
    const text = hiddenTexts[offset];
    if (text === undefined) return undefined;
    rows.push({
      type: 'context',
      oldLineNumber: oldStartLine + offset,
      newLineNumber,
      text,
      tokens: tokenLines[offset],
    });
  }
  budget.remainingRows -= measurement.count;
  budget.remainingBytes -= measurement.byteLength;
  budget.remainingTokens -= tokenCount;
  return rows;
}

function measureHiddenContext(
  fold: ReviewDisplayRow,
  modifiedLines: readonly string[],
): { count: number; byteLength: number } | undefined {
  const count = fold.count ?? 0;
  const newStartLine = fold.newStartLine;
  if (!newStartLine || count <= 0) return { count: 0, byteLength: 0 };

  let byteLength = 0;
  for (let offset = 0; offset < count; offset += 1) {
    const text = modifiedLines[newStartLine + offset - 1];
    if (text === undefined) return undefined;
    byteLength += Buffer.byteLength(text, 'utf-8') + 1;
  }
  return { count, byteLength };
}

function isArtifactFile(
  file: FileReviewFile | FileReviewArtifactFile,
): file is FileReviewArtifactFile {
  return Array.isArray((file as FileReviewArtifactFile).rows);
}

function formatDisplayPath(cwd: string, absolutePath: string): string {
  return formatPathRelativeToCwd(absolutePath, cwd);
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
      unavailableReason: file.unavailableReason,
      recordIds: file.recordIds,
      rowCount: file.rows.length,
      statusNote: file.statusNote,
      folds: file.rows
        .filter((row) => row.type === 'fold')
        .map((row) => ({
          count: row.count,
          oldStartLine: row.oldStartLine,
          newStartLine: row.newStartLine,
          hiddenCount: row.hiddenRows?.length ?? 0,
        })),
      tokens: createRowsTokenSignature(file.rows),
    })),
  });
}

function createRowsTokenSignature(rows: readonly ScoutChangesReviewRow[]): string {
  return rows
    .map((row) => {
      if (row.type === 'fold') {
        return `fold:${row.count}:${createRowsTokenSignature(row.hiddenRows ?? [])}`;
      }
      const tokens = row.tokens ?? [];
      const diffCount = tokens.filter((token) => token.diff).length;
      const scopeCount = tokens.filter((token) => token.syntaxScopes?.length).length;
      return `${row.type}:${tokens.length}:${diffCount}:${scopeCount}`;
    })
    .join('|');
}
