// ============================================================
// Shell 配置 — Pi 风格的 bash shell 发现与环境构造
// ============================================================

import { existsSync } from 'node:fs';
import { delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';

// ---------- 类型 ----------

export interface ShellConfig {
  shell: string;
  args: string[];
}

// ---------- shell 发现 ----------

function findBashOnPath(): string | null {
  if (process.platform === 'win32') {
    try {
      const result = spawnSync('where', ['bash.exe'], {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
      });
      if (result.status === 0 && result.stdout) {
        const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
        if (firstMatch && existsSync(firstMatch)) return firstMatch;
      }
    } catch {
      // 忽略查询失败，交给上层 fallback。
    }
    return null;
  }

  try {
    const result = spawnSync('which', ['bash'], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status === 0 && result.stdout) {
      const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
      if (firstMatch) return firstMatch;
    }
  } catch {
    // 忽略查询失败，交给上层 fallback。
  }
  return null;
}

/**
 * 解析 bash shell 配置。
 *
 * 顺序与 Pi 保持一致：
 * 1. 用户指定 shellPath
 * 2. Windows Git Bash 常见安装路径
 * 3. PATH 上的 bash
 * 4. Unix 上的 /bin/bash，最后回退 sh
 */
export function getShellConfig(customShellPath?: string): ShellConfig {
  if (customShellPath) {
    if (existsSync(customShellPath)) {
      return { shell: customShellPath, args: ['-c'] };
    }
    throw new Error(`Custom shell path not found: ${customShellPath}`);
  }

  if (process.platform === 'win32') {
    const paths: string[] = [];
    const programFiles = process.env.ProgramFiles;
    if (programFiles) paths.push(`${programFiles}\\Git\\bin\\bash.exe`);
    const programFilesX86 = process.env['ProgramFiles(x86)'];
    if (programFilesX86) paths.push(`${programFilesX86}\\Git\\bin\\bash.exe`);

    for (const path of paths) {
      if (existsSync(path)) {
        return { shell: path, args: ['-c'] };
      }
    }

    const bashOnPath = findBashOnPath();
    if (bashOnPath) return { shell: bashOnPath, args: ['-c'] };

    throw new Error(
      `No bash shell found. Options:\n` +
        `  1. Install Git for Windows: https://git-scm.com/download/win\n` +
        `  2. Add your bash to PATH (Cygwin, MSYS2, etc.)\n` +
        '  3. Set shellPath in Scout Settings > Runtime Settings (or settings.json)\n\n' +
        `Searched Git Bash in:\n${paths.map((path) => `  ${path}`).join('\n')}`,
    );
  }

  if (existsSync('/bin/bash')) {
    return { shell: '/bin/bash', args: ['-c'] };
  }

  const bashOnPath = findBashOnPath();
  if (bashOnPath) return { shell: bashOnPath, args: ['-c'] };

  return { shell: 'sh', args: ['-c'] };
}

/**
 * 构造 shell 环境。
 *
 * Scout 没有 Pi 的内置工具下载 bin 目录，因此这里只负责返回独立副本，
 * 并规范化 PATH key，避免后续 hook 直接修改 process.env。
 */
export function getShellEnv(): NodeJS.ProcessEnv {
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  const currentPath = process.env[pathKey] ?? '';
  const pathEntries = currentPath.split(delimiter).filter(Boolean);
  const normalizedPath = pathEntries.join(delimiter);

  return {
    ...process.env,
    [pathKey]: normalizedPath,
  };
}
