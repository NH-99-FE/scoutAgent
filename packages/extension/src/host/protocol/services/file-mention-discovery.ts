// ============================================================
// File mention discovery — 基于 fd 的 ignore-aware 项目路径发现
// ============================================================

import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import type { ScoutFileMentionItem } from '@scout-agent/shared';

const DEFAULT_FILE_MENTION_EXCLUDES = [
  '.git',
  '.hg',
  '.svn',
  '.scout',
  'node_modules',
  'dist',
  'out',
];
const MAX_DISCOVERY_MULTIPLIER = 4;

export interface DiscoverFileMentionsOptions {
  cwd: string;
  fdPath: string;
  limit: number;
  query: string;
  signal: AbortSignal;
}

export type DiscoverFileMentions = (
  options: DiscoverFileMentionsOptions,
) => Promise<ScoutFileMentionItem[]>;

export async function discoverFileMentions({
  cwd,
  fdPath,
  limit,
  query,
  signal,
}: DiscoverFileMentionsOptions): Promise<ScoutFileMentionItem[]> {
  if (!cwd || signal.aborted) return [];
  const cappedLimit = Math.max(1, Math.min(limit, 100));
  const discoveryLimit = cappedLimit * MAX_DISCOVERY_MULTIPLIER;

  const paths = await runFd(fdPath, buildFileMentionFdArgs(query, discoveryLimit), cwd, signal);
  const candidates = await projectFileMentionCandidates(paths, cwd, cappedLimit);
  if (signal.aborted) return [];
  return candidates;
}

export function buildFileMentionFdArgs(query: string, limit: number): string[] {
  const args = [
    '--color=never',
    '--hidden',
    '--no-require-git',
    '--full-path',
    '--ignore-case',
    '--max-results',
    String(limit),
  ];
  for (const pattern of DEFAULT_FILE_MENTION_EXCLUDES) {
    args.push('--exclude', pattern);
  }
  // fd 默认不跟随目录符号链接，避免搜索越出 cwd；ignore 文件优先级由 fd 统一处理。
  args.push('--', toFdRegex(query), '.');
  return args;
}

async function runFd(
  fdPath: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
): Promise<string[]> {
  return new Promise((resolvePromise, reject) => {
    if (signal.aborted) {
      resolvePromise([]);
      return;
    }
    const child = spawn(fdPath, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const lines: string[] = [];
    let stderr = '';
    let settled = false;
    const reader = createInterface({ input: child.stdout });
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      reader.close();
      callback();
    };
    const onAbort = () => {
      if (!child.killed) child.kill();
      settle(() => resolvePromise([]));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    reader.on('line', (line) => {
      const normalizedPath = normalizeCandidatePath(line, cwd);
      if (normalizedPath) lines.push(normalizedPath);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      settle(() => reject(new Error(`fd 文件发现失败: ${error.message}`, { cause: error })));
    });
    child.on('close', (code) => {
      if (signal.aborted) {
        settle(() => resolvePromise([]));
        return;
      }
      if (code !== 0 && lines.length === 0) {
        settle(() => reject(new Error(stderr.trim() || `fd 文件发现退出码: ${code}`)));
        return;
      }
      settle(() => resolvePromise(lines));
    });
  });
}

export async function projectFileMentionCandidates(
  candidatePaths: string[],
  cwd: string,
  limit: number,
  statPath: typeof stat = stat,
): Promise<ScoutFileMentionItem[]> {
  const candidates = await Promise.all(
    candidatePaths.map(async (candidatePath) => projectCandidate(candidatePath, cwd, statPath)),
  );
  return candidates
    .filter((item): item is ScoutFileMentionItem => item !== undefined)
    .sort(compareMentionItems)
    .slice(0, limit);
}

async function projectCandidate(
  candidatePath: string,
  cwd: string,
  statPath: typeof stat,
): Promise<ScoutFileMentionItem | undefined> {
  const absolutePath = resolve(cwd, candidatePath);
  const relativePath = relative(cwd, absolutePath).replace(/\\/g, '/');
  if (!relativePath || relativePath === '..' || relativePath.startsWith('../')) return undefined;

  let kind: ScoutFileMentionItem['kind'] = 'file';
  try {
    kind = (await statPath(absolutePath)).isDirectory() ? 'directory' : 'file';
  } catch {
    // 损坏的符号链接仍作为文件候选保留，但不会被 fd 遍历。
  }
  const description = dirname(relativePath).replace(/\\/g, '/');
  return {
    id: relativePath,
    kind,
    path: relativePath,
    label: basename(relativePath),
    description: description === '.' ? undefined : description,
  };
}

function normalizeCandidatePath(candidatePath: string, cwd: string): string | undefined {
  const trimmedPath = candidatePath.trim().replace(/[\\/]$/u, '');
  if (!trimmedPath) return undefined;
  const relativePath = isAbsolute(trimmedPath) ? relative(cwd, trimmedPath) : trimmedPath;
  return relativePath.replace(/^\.([\\/])/u, '').replace(/\\/g, '/');
}

function toFdRegex(query: string): string {
  const normalizedQuery = query.trim().replace(/\\/g, '/');
  if (!normalizedQuery) return '.';
  return normalizedQuery
    .split('/')
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\\\/]');
}

function compareMentionItems(a: ScoutFileMentionItem, b: ScoutFileMentionItem): number {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
  return a.path.localeCompare(b.path);
}
