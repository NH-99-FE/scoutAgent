// ============================================================
// Session cwd policy 测试 — VS Code workspace 边界决策
// ============================================================

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { isPathInsideOrEqual, resolveSessionCwdPolicy } from '../session-cwd-policy.ts';

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'scout-session-cwd-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('session-cwd-policy', () => {
  it('treats equal paths and child paths as inside workspace', () => {
    const root = makeTempRoot();
    const child = join(root, 'packages', 'extension');
    mkdirSync(child, { recursive: true });

    expect(isPathInsideOrEqual(root, root)).toBe(true);
    expect(isPathInsideOrEqual(child, root)).toBe(true);
  });

  it('uses the session cwd when it exists inside a workspace folder', () => {
    const root = makeTempRoot();
    const sessionCwd = join(root, 'repo');
    mkdirSync(sessionCwd, { recursive: true });

    const decision = resolveSessionCwdPolicy({
      sessionCwd,
      fallbackCwd: root,
      workspaceFolders: [root],
    });

    expect(decision).toEqual({ type: 'use-session-cwd', cwd: sessionCwd });
  });

  it('asks for a user choice when the session cwd exists outside workspace', () => {
    const workspace = makeTempRoot();
    const outsideRoot = makeTempRoot();
    const sessionCwd = join(outsideRoot, 'repo');
    mkdirSync(sessionCwd, { recursive: true });

    const decision = resolveSessionCwdPolicy({
      sessionCwd,
      fallbackCwd: workspace,
      workspaceFolders: [workspace],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'needs-user-choice',
        reason: 'outside-workspace',
        sessionCwd,
        fallbackCwd: workspace,
      }),
    );
  });

  it('asks for a user choice when the original session cwd no longer exists', () => {
    const workspace = makeTempRoot();
    const missingCwd = join(workspace, 'missing');

    const decision = resolveSessionCwdPolicy({
      sessionCwd: missingCwd,
      fallbackCwd: workspace,
      workspaceFolders: [workspace],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'needs-user-choice',
        reason: 'missing-path',
        sessionCwd: missingCwd,
      }),
    );
  });

  it('uses fallback cwd when the session header has no cwd', () => {
    const workspace = makeTempRoot();

    expect(
      resolveSessionCwdPolicy({
        fallbackCwd: workspace,
        workspaceFolders: [workspace],
      }),
    ).toEqual({ type: 'use-fallback-cwd', cwd: workspace, reason: 'missing-session-cwd' });
  });
});
