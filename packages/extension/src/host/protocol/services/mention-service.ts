// ============================================================
// Mention protocol service — 文件 mention 查询请求
// ============================================================

import * as vscode from 'vscode';
import type { ScoutFileMentionItem } from '@scout-agent/shared';
import type { MentionProtocolHost, ProtocolPayload } from './types.ts';
import type { ProtocolResponder } from './types.ts';

// ---------- 常量 ----------

const FILE_MENTION_SKIP_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.scout',
  'dist',
  'out',
]);

// ---------- 类型 ----------

export interface MentionProtocolServiceOptions {
  cwd: string;
  logError: (message: string) => void;
}

// ---------- Service ----------

export class MentionProtocolService implements MentionProtocolHost {
  private readonly cwd: string;
  private readonly logError: (message: string) => void;

  constructor(options: MentionProtocolServiceOptions) {
    this.cwd = options.cwd;
    this.logError = options.logError;
  }

  async requestFileMentions(
    message: ProtocolPayload<'request_file_mentions'>,
    respond: ProtocolResponder,
  ): Promise<void> {
    try {
      const items = await this.collectFileMentionItems(message.query, message.limit);
      respond({ type: 'file_mentions_result', query: message.query, items });
    } catch (error) {
      respond({ type: 'file_mentions_result', query: message.query, items: [] });
      this.logError(
        `[scout] File mentions failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async collectFileMentionItems(
    query: string,
    limit = 50,
  ): Promise<ScoutFileMentionItem[]> {
    const cappedLimit = Math.max(1, Math.min(limit, 100));
    const normalizedQuery = query.trim().replace(/\\/g, '/').toLowerCase();
    const roots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? [];
    if (roots.length === 0 && this.cwd) {
      roots.push(vscode.Uri.file(this.cwd));
    }

    const items: ScoutFileMentionItem[] = [];
    const queue = [...roots];
    let scanned = 0;
    while (queue.length > 0 && items.length < cappedLimit && scanned < 2500) {
      const dir = queue.shift();
      if (!dir) break;
      scanned += 1;

      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(dir);
      } catch {
        continue;
      }

      entries.sort(([a], [b]) => a.localeCompare(b));
      for (const [name, fileType] of entries) {
        if (FILE_MENTION_SKIP_NAMES.has(name)) continue;
        const uri = vscode.Uri.joinPath(dir, name);
        const isDirectory = (fileType & vscode.FileType.Directory) !== 0;
        const relativePath = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
        const matches =
          !normalizedQuery ||
          name.toLowerCase().includes(normalizedQuery) ||
          relativePath.toLowerCase().includes(normalizedQuery);

        if (matches && items.length < cappedLimit) {
          items.push({
            id: relativePath,
            kind: isDirectory ? 'directory' : 'file',
            path: relativePath,
            label: name,
            description: getPathDescription(relativePath),
          });
        }
        if (isDirectory) {
          queue.push(uri);
        }
        if (items.length >= cappedLimit) break;
      }
    }
    return items;
  }
}

function getPathDescription(relativePath: string): string | undefined {
  const index = relativePath.lastIndexOf('/');
  return index > 0 ? relativePath.slice(0, index) : undefined;
}
