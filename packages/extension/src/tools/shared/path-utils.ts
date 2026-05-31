// ============================================================
// 路径解析工具 — 文件路径解析和 ~ 展开
// 基于 Pi path-utils.ts 移植，去掉对 Pi utils/paths.ts 的依赖
// ============================================================

import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

/** 检查路径是否存在 */
export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 展开 ~ 为 home 目录，归一化路径。
 * Scout 简化版：只处理 ~ 展开和绝对路径解析。
 */
export function expandPath(filePath: string): string {
  const normalized = filePath;
  const home = homedir();
  if (normalized === '~') return home;
  if (
    normalized.startsWith('~/') ||
    (process.platform === 'win32' && normalized.startsWith('~\\'))
  ) {
    return resolve(home, normalized.slice(2));
  }
  return normalized;
}

/**
 * 将路径解析为相对于 cwd 的绝对路径。
 * 支持 ~ 展开和绝对路径。
 */
export function resolveToCwd(filePath: string, cwd: string): string {
  const normalized = expandPath(filePath);
  return isAbsolute(normalized) ? resolve(normalized) : resolve(cwd, normalized);
}

/**
 * 读取路径解析（支持 macOS 文件名变体）。
 * 依次尝试原始路径、NFD 变体、弯引号变体。
 */
export async function resolveReadPathAsync(filePath: string, cwd: string): Promise<string> {
  const resolved = resolveToCwd(filePath, cwd);

  if (await pathExists(resolved)) return resolved;

  // 尝试 NFD 变体（macOS 文件名使用 NFD 形式）
  const nfdVariant = resolved.normalize('NFD');
  if (nfdVariant !== resolved && (await pathExists(nfdVariant))) return nfdVariant;

  return resolved;
}
