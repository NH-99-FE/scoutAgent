// ============================================================
// Session file helpers — JSONL header reading and safe import copy
// ============================================================

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

// ---------- 类型 ----------

export interface SessionFileInfo {
  path: string;
  id?: string;
  cwd?: string;
  createdAt?: string;
  parentSessionPath?: string;
  forkPointEntryId?: string;
}

export interface DefaultSessionExportFileNameOptions {
  sessionId?: string;
  now?: Date;
}

const MAX_SESSION_ID_FILE_NAME_LENGTH = 80;

interface SessionHeader {
  type: 'session';
  version?: number;
  id?: string;
  timestamp?: string;
  cwd?: string;
  parentSession?: string;
  forkPointEntryId?: string;
}

// ---------- 读取 ----------

function parseSessionHeader(line: string, filePath: string): SessionHeader {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new Error(`Invalid session header JSON: ${filePath}`, { cause: error });
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { type?: unknown }).type !== 'session'
  ) {
    throw new Error(`Invalid session file header: ${filePath}`);
  }

  return parsed as SessionHeader;
}

export function readSessionFileInfo(filePath: string): SessionFileInfo {
  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Session file not found: ${resolvedPath}`);
  }

  const firstLine = readFileSync(resolvedPath, 'utf-8').split(/\r?\n/, 1)[0]?.trim();
  if (!firstLine) {
    throw new Error(`Session file is missing header: ${resolvedPath}`);
  }

  const header = parseSessionHeader(firstLine, resolvedPath);
  return {
    path: resolvedPath,
    id: typeof header.id === 'string' ? header.id : undefined,
    cwd: typeof header.cwd === 'string' ? header.cwd : undefined,
    createdAt: typeof header.timestamp === 'string' ? header.timestamp : undefined,
    parentSessionPath: typeof header.parentSession === 'string' ? header.parentSession : undefined,
    forkPointEntryId:
      typeof header.forkPointEntryId === 'string' ? header.forkPointEntryId : undefined,
  };
}

// ---------- 导出 ----------

export function createDefaultSessionExportFileName(
  options: DefaultSessionExportFileNameOptions = {},
): string {
  const timestamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const sessionId = sanitizeSessionIdForFileName(options.sessionId);
  return sessionId ? `session-${sessionId}-${timestamp}.jsonl` : `session-${timestamp}.jsonl`;
}

function sanitizeSessionIdForFileName(sessionId: string | undefined): string | undefined {
  const normalized = sessionId
    ?.trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
  const truncated = normalized
    ?.slice(0, MAX_SESSION_ID_FILE_NAME_LENGTH)
    .replace(/[^A-Za-z0-9]+$/g, '');
  return truncated || undefined;
}

// ---------- 导入 ----------

function rewriteHeaderCwd(filePath: string, cwd: string): void {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const firstLine = lines[0]?.trim();
  if (!firstLine) throw new Error(`Session file is missing header: ${filePath}`);
  const header = parseSessionHeader(firstLine, filePath);
  header.cwd = cwd;
  lines[0] = JSON.stringify(header);
  writeFileSync(filePath, lines.join('\n'), 'utf-8');
}

export function copySessionFileIntoSessionDir(options: {
  sourcePath: string;
  sessionDir: string;
  cwd: string;
}): SessionFileInfo {
  const sourcePath = resolve(options.sourcePath);
  if (!existsSync(sourcePath)) {
    throw new Error(`Session file not found: ${sourcePath}`);
  }

  const sessionDir = resolve(options.sessionDir);
  mkdirSync(sessionDir, { recursive: true });

  const destinationPath = join(sessionDir, `${Date.now()}_imported_${basename(sourcePath)}`);
  if (resolve(destinationPath) !== sourcePath) {
    copyFileSync(sourcePath, destinationPath);
  }
  rewriteHeaderCwd(destinationPath, options.cwd);
  return readSessionFileInfo(destinationPath);
}
