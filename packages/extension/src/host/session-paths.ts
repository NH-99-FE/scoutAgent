// ============================================================
// Session path helpers — 宿主层负责 Scout 会话目录策略
// ============================================================

import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ---------- 路径计算 ----------

export function encodeSessionCwd(cwd: string): string {
  const resolvedCwd = resolve(cwd);
  return `--${resolvedCwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

export function getSessionsRoot(agentDir: string): string {
  return join(resolve(agentDir), 'sessions');
}

export function getDefaultSessionDir(cwd: string, agentDir: string): string {
  const sessionDir = join(getSessionsRoot(agentDir), encodeSessionCwd(cwd));
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }
  return sessionDir;
}
