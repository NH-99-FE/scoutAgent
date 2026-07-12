// ============================================================
// Mention protocol service — 文件 mention 选择与查询请求
// ============================================================

import * as vscode from 'vscode';
import { extname, relative } from 'node:path';
import {
  SCOUT_COMPOSER_IMAGE_MAX_BYTES,
  SCOUT_COMPOSER_IMAGE_MAX_COUNT,
  type ScoutComposerContentPick,
  type ScoutFileMentionItem,
} from '@scout-agent/shared';
import { isPathInsideOrEqual } from '../../../core/session-cwd.ts';
import { detectSupportedImageMimeType } from '../../../core/tools/shared/mime.ts';
import { discoverFileMentions, type DiscoverFileMentions } from './file-mention-discovery.ts';
import type { MentionProtocolHost, ProtocolPayload } from './types.ts';
import type { ProtocolResponder } from './types.ts';

// ---------- 常量 ----------

const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']);

// ---------- 类型 ----------

export interface MentionProtocolServiceOptions {
  discoverFileMentions?: DiscoverFileMentions;
  fdPath: Promise<string | undefined>;
  getCurrentCwd: () => string;
  logError: (message: string) => void;
}

interface ComposerContentClassification {
  selection?: ScoutComposerContentPick;
  warning?: string;
}

// ---------- Service ----------

export class MentionProtocolService implements MentionProtocolHost {
  private readonly discoverFileMentions: DiscoverFileMentions;
  private readonly fdPath: Promise<string | undefined>;
  private readonly getCurrentCwd: () => string;
  private readonly logError: (message: string) => void;

  constructor(options: MentionProtocolServiceOptions) {
    this.discoverFileMentions = options.discoverFileMentions ?? discoverFileMentions;
    this.fdPath = options.fdPath;
    this.getCurrentCwd = options.getCurrentCwd;
    this.logError = options.logError;
  }

  async pickComposerContent(
    message: ProtocolPayload<'pick_composer_content'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    try {
      const cwd = this.getCurrentCwd();
      const selectDirectory = message.selectionKind === 'directory';
      const defaultUri =
        (cwd ? vscode.Uri.file(cwd) : undefined) ?? vscode.workspace.workspaceFolders?.[0]?.uri;
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: !selectDirectory,
        canSelectFolders: selectDirectory,
        canSelectMany: !selectDirectory,
        defaultUri,
        openLabel: '添加',
        title: selectDirectory ? '添加文件夹' : '添加文件或图片',
      });
      if (!selected || selected.length === 0) {
        respond({ type: 'composer_content_pick_result', selections: [] });
        return;
      }

      const selections: ScoutComposerContentPick[] = [];
      const warnings: string[] = [];
      let imageCount = 0;
      let overflowImageCount = 0;
      for (const uri of selected) {
        try {
          if (
            !selectDirectory &&
            imageCount >= SCOUT_COMPOSER_IMAGE_MAX_COUNT &&
            hasSupportedImageExtension(uri.fsPath)
          ) {
            overflowImageCount += 1;
            continue;
          }
          const classification = await classifyComposerContent(uri, cwd);
          if (classification.warning) warnings.push(classification.warning);
          if (!classification.selection) continue;
          if (classification.selection.type === 'image') {
            if (imageCount >= SCOUT_COMPOSER_IMAGE_MAX_COUNT) {
              overflowImageCount += 1;
              continue;
            }
            imageCount += 1;
          }
          selections.push(classification.selection);
        } catch (error) {
          const label = getPathLabel(uri.fsPath.replace(/\\/g, '/'));
          warnings.push(`无法读取 ${label}，已忽略`);
          this.logError(
            `[scout] Composer content classification failed for ${uri.toString()}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (overflowImageCount > 0) {
        warnings.push(`最多只能添加 ${SCOUT_COMPOSER_IMAGE_MAX_COUNT} 张图片`);
      }
      respond({
        type: 'composer_content_pick_result',
        selections,
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    } catch (error) {
      respond({
        type: 'composer_content_pick_result',
        selections: [],
        error: '无法打开所选内容，请重试',
      });
      this.logError(
        `[scout] File mention picker failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async requestFileMentions(
    message: ProtocolPayload<'request_file_mentions'>,
    respond: ProtocolResponder,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      if (signal.aborted) return;
      const fdPath = await this.fdPath;
      if (signal.aborted) return;
      if (!fdPath) {
        respond({
          type: 'file_mentions_result',
          query: message.query,
          items: [],
          error: '文件搜索不可用：fd 未安装且自动下载失败',
        });
        return;
      }
      const cwd = this.getCurrentCwd();
      const items = await this.discoverFileMentions({
        cwd,
        fdPath,
        limit: message.limit ?? 50,
        query: message.query,
        signal,
      });
      if (signal.aborted) return;
      respond({ type: 'file_mentions_result', query: message.query, items });
    } catch (error) {
      if (signal.aborted) return;
      respond({
        type: 'file_mentions_result',
        query: message.query,
        items: [],
        error: '文件搜索失败，请重试',
      });
      this.logError(
        `[scout] File mentions failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function classifyComposerContent(
  uri: vscode.Uri,
  cwd: string,
): Promise<ComposerContentClassification> {
  const stat = await vscode.workspace.fs.stat(uri);
  const selectedPath = getMentionPath(uri.fsPath, cwd);
  const normalizedPath = selectedPath.replace(/\\/g, '/');
  const label = getPathLabel(normalizedPath);
  const isDirectory = (stat.type & vscode.FileType.Directory) !== 0;
  if (isDirectory) {
    return { selection: toReferenceSelection(normalizedPath, label, 'directory') };
  }

  if (!hasSupportedImageExtension(label)) {
    return { selection: toReferenceSelection(normalizedPath, label, 'file') };
  }
  if (stat.size > SCOUT_COMPOSER_IMAGE_MAX_BYTES) {
    return { warning: `${label} 超过 2MB，已忽略` };
  }
  const bytes = await vscode.workspace.fs.readFile(uri);
  if (bytes.byteLength > SCOUT_COMPOSER_IMAGE_MAX_BYTES) {
    return { warning: `${label} 超过 2MB，已忽略` };
  }
  const mimeType = detectSupportedImageMimeType(bytes);
  if (mimeType) {
    return {
      selection: {
        type: 'image',
        fileName: label,
        image: {
          type: 'image',
          data: Buffer.from(bytes).toString('base64'),
          mimeType,
        },
      },
    };
  }
  return {
    selection: toReferenceSelection(normalizedPath, label, 'file'),
    warning: `${label} 不是受支持的图片内容，已作为文件引用添加`,
  };
}

function hasSupportedImageExtension(filePath: string): boolean {
  return SUPPORTED_IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function toReferenceSelection(
  normalizedPath: string,
  label: string,
  kind: ScoutFileMentionItem['kind'],
): ScoutComposerContentPick {
  return {
    type: 'reference',
    item: {
      id: normalizedPath,
      kind,
      path: normalizedPath,
      label,
      description: getPathDescription(normalizedPath),
    },
  };
}

function getMentionPath(absolutePath: string, cwd: string): string {
  if (!cwd || !isPathInsideOrEqual(absolutePath, cwd)) return absolutePath;
  return relative(cwd, absolutePath) || '.';
}

function getPathDescription(relativePath: string): string | undefined {
  const index = relativePath.lastIndexOf('/');
  return index > 0 ? relativePath.slice(0, index) : undefined;
}

function getPathLabel(filePath: string): string {
  const normalizedPath = filePath.replace(/\/$/u, '');
  const index = normalizedPath.lastIndexOf('/');
  return index >= 0 ? normalizedPath.slice(index + 1) : normalizedPath;
}
