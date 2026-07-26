// ============================================================
// 路径解析工具 — 文件工具路径解析与 macOS 文件名变体
// 基于 Pi coding-agent/src/core/tools/path-utils.ts 同层移植
// ============================================================

import { accessSync, constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { relative } from 'node:path';
import { normalizePath, resolvePath } from '../../utils/index.ts';

const NARROW_NO_BREAK_SPACE = '\u202f';

function tryMacOSScreenshotPath(filePath: string): string {
  return filePath.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`);
}

function tryNFDVariant(filePath: string): string {
  // macOS 以 NFD 存储文件名；用户输入通常是 NFC。
  return filePath.normalize('NFD');
}

function tryCurlyQuoteVariant(filePath: string): string {
  // macOS 截图名使用 U+2019；用户通常输入 ASCII apostrophe。
  return filePath.replace(/'/g, '\u2019');
}

function fileExists(filePath: string): boolean {
  try {
    accessSync(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function expandPath(filePath: string): string {
  return normalizePath(filePath, {
    normalizeUnicodeSpaces: true,
    stripAtPrefix: true,
  });
}

/**
 * 将路径解析为相对于 cwd 的绝对路径。
 * 同时处理 ~、@、Unicode 空格、file URL 与绝对路径。
 */
export function resolveToCwd(filePath: string, cwd: string): string {
  return resolvePath(filePath, cwd, {
    normalizeUnicodeSpaces: true,
    stripAtPrefix: true,
  });
}

/**
 * 将绝对路径格式化为相对 cwd 的展示路径。
 * cwd 外路径保留 ../ 前缀，由调用方决定是否额外标记 External。
 */
export function formatPathRelativeToCwd(filePath: string, cwd: string): string {
  if (!cwd) return filePath;
  const displayPath = relative(cwd, filePath) || '.';
  return displayPath.replace(/\\/g, '/');
}

/**
 * 读取路径解析（支持 macOS 文件名变体）。
 * 依次尝试原始路径、NFD 变体、弯引号变体。
 */
export function resolveReadPath(filePath: string, cwd: string): string {
  const resolved = resolveToCwd(filePath, cwd);

  if (fileExists(resolved)) return resolved;

  const amPmVariant = tryMacOSScreenshotPath(resolved);
  if (amPmVariant !== resolved && fileExists(amPmVariant)) return amPmVariant;

  const nfdVariant = tryNFDVariant(resolved);
  if (nfdVariant !== resolved && fileExists(nfdVariant)) return nfdVariant;

  const curlyVariant = tryCurlyQuoteVariant(resolved);
  if (curlyVariant !== resolved && fileExists(curlyVariant)) return curlyVariant;

  const nfdCurlyVariant = tryCurlyQuoteVariant(nfdVariant);
  if (nfdCurlyVariant !== resolved && fileExists(nfdCurlyVariant)) return nfdCurlyVariant;

  return resolved;
}

export async function resolveReadPathAsync(filePath: string, cwd: string): Promise<string> {
  const resolved = resolveToCwd(filePath, cwd);

  if (await pathExists(resolved)) return resolved;

  const amPmVariant = tryMacOSScreenshotPath(resolved);
  if (amPmVariant !== resolved && (await pathExists(amPmVariant))) return amPmVariant;

  const nfdVariant = tryNFDVariant(resolved);
  if (nfdVariant !== resolved && (await pathExists(nfdVariant))) return nfdVariant;

  const curlyVariant = tryCurlyQuoteVariant(resolved);
  if (curlyVariant !== resolved && (await pathExists(curlyVariant))) return curlyVariant;

  const nfdCurlyVariant = tryCurlyQuoteVariant(nfdVariant);
  if (nfdCurlyVariant !== resolved && (await pathExists(nfdCurlyVariant))) {
    return nfdCurlyVariant;
  }

  return resolved;
}
