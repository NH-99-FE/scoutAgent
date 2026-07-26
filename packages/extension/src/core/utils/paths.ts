// ============================================================
// 路径输入归一 — 文件工具与运行时共享的纯路径语义
// 基于 Pi coding-agent/src/utils/paths.ts 同层移植。
// ============================================================

import { homedir } from 'node:os';
import { isAbsolute, join, resolve as nodeResolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- 类型 ----------

export interface PathInputOptions {
  /** 归一前移除首尾空白。 */
  trim?: boolean;
  /** 展开开头的 `~`；默认启用。 */
  expandTilde?: boolean;
  /** `~` 展开使用的 home；默认使用 `os.homedir()`。 */
  homeDir?: string;
  /** 移除 CLI @file 输入的 `@` 前缀。 */
  stripAtPrefix?: boolean;
  /** 将 Unicode 空格变体归一为普通空格。 */
  normalizeUnicodeSpaces?: boolean;
}

const UNICODE_SPACES = /[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g;

// ---------- 归一与解析 ----------

export function normalizePath(input: string, options: PathInputOptions = {}): string {
  let normalized = options.trim ? input.trim() : input;
  if (options.normalizeUnicodeSpaces) {
    normalized = normalized.replace(UNICODE_SPACES, ' ');
  }
  if (options.stripAtPrefix && normalized.startsWith('@')) {
    normalized = normalized.slice(1);
  }

  if (options.expandTilde ?? true) {
    const home = options.homeDir ?? homedir();
    if (normalized === '~') return home;
    if (
      normalized.startsWith('~/') ||
      (process.platform === 'win32' && normalized.startsWith('~\\'))
    ) {
      return join(home, normalized.slice(2));
    }
  }

  if (/^file:\/\//.test(normalized)) {
    return fileURLToPath(normalized);
  }

  return normalized;
}

export function resolvePath(
  input: string,
  baseDir: string = process.cwd(),
  options: PathInputOptions = {},
): string {
  const normalized = normalizePath(input, options);
  const normalizedBaseDir = normalizePath(baseDir);
  return isAbsolute(normalized)
    ? nodeResolvePath(normalized)
    : nodeResolvePath(normalizedBaseDir, normalized);
}
