// ============================================================
// Session cwd policy — VS Code workspace-aware restore/import decisions
// ============================================================

import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// ---------- 类型 ----------

export interface SessionCwdPolicyInput {
  sessionCwd?: string;
  fallbackCwd: string;
  workspaceFolders: string[];
}

export type SessionCwdPolicyDecision =
  | { type: 'use-session-cwd'; cwd: string }
  | { type: 'use-fallback-cwd'; cwd: string; reason: 'missing-session-cwd' }
  | {
      type: 'needs-user-choice';
      reason: 'outside-workspace' | 'no-workspace' | 'missing-path';
      sessionCwd: string;
      fallbackCwd: string;
      workspaceFolders: string[];
    };

// ---------- 路径判断 ----------

function normalizePathForCompare(path: string): string {
  const resolved = resolve(path);
  const withoutTrailing = resolved.endsWith(sep) ? resolved.slice(0, -1) : resolved;
  return process.platform === 'win32' ? withoutTrailing.toLowerCase() : withoutTrailing;
}

export function isPathInsideOrEqual(childPath: string, parentPath: string): boolean {
  const child = normalizePathForCompare(childPath);
  const parent = normalizePathForCompare(parentPath);
  return child === parent || child.startsWith(`${parent}${sep}`);
}

// ---------- Policy ----------

export function resolveSessionCwdPolicy(input: SessionCwdPolicyInput): SessionCwdPolicyDecision {
  const fallbackCwd = resolve(input.fallbackCwd);
  const sessionCwd = input.sessionCwd?.trim() ? resolve(input.sessionCwd) : undefined;

  if (!sessionCwd) {
    return { type: 'use-fallback-cwd', cwd: fallbackCwd, reason: 'missing-session-cwd' };
  }

  if (!existsSync(sessionCwd)) {
    return {
      type: 'needs-user-choice',
      reason: 'missing-path',
      sessionCwd,
      fallbackCwd,
      workspaceFolders: input.workspaceFolders.map((folder) => resolve(folder)),
    };
  }

  const workspaceFolders = input.workspaceFolders.map((folder) => resolve(folder));
  if (workspaceFolders.length === 0) {
    return {
      type: 'needs-user-choice',
      reason: 'no-workspace',
      sessionCwd,
      fallbackCwd,
      workspaceFolders,
    };
  }

  if (workspaceFolders.some((folder) => isPathInsideOrEqual(sessionCwd, folder))) {
    return { type: 'use-session-cwd', cwd: sessionCwd };
  }

  return {
    type: 'needs-user-choice',
    reason: 'outside-workspace',
    sessionCwd,
    fallbackCwd,
    workspaceFolders,
  };
}
