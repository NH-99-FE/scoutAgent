// ============================================================
// Session file 测试 — JSONL header 读取与导入复制
// ============================================================

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  copySessionFileIntoAgentDir,
  encodeSessionCwd,
  readSessionFileInfo,
} from '../session-file.ts';

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'scout-session-file-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('session-file', () => {
  it('reads metadata from the first JSONL session header', () => {
    const root = makeTempRoot();
    const sourcePath = join(root, 'session.jsonl');
    writeFileSync(
      sourcePath,
      [
        JSON.stringify({
          type: 'session',
          id: 'session-1',
          timestamp: '2026-06-07T00:00:00.000Z',
          cwd: join(root, 'repo'),
          parentSession: '/parent.jsonl',
        }),
        JSON.stringify({ type: 'user_message', content: 'hello' }),
      ].join('\n'),
      'utf-8',
    );

    expect(readSessionFileInfo(sourcePath)).toEqual({
      path: sourcePath,
      id: 'session-1',
      createdAt: '2026-06-07T00:00:00.000Z',
      cwd: join(root, 'repo'),
      parentSessionPath: '/parent.jsonl',
    });
  });

  it('copies a session into the agent dir and rewrites its cwd header', () => {
    const root = makeTempRoot();
    const sourcePath = join(root, 'session.jsonl');
    const agentDir = join(root, '.scout');
    const targetCwd = join(root, 'workspace');
    writeFileSync(
      sourcePath,
      [
        JSON.stringify({
          type: 'session',
          id: 'session-1',
          timestamp: '2026-06-07T00:00:00.000Z',
          cwd: join(root, 'old-workspace'),
        }),
        JSON.stringify({ type: 'assistant_message', content: 'hello' }),
      ].join('\n'),
      'utf-8',
    );

    const copied = copySessionFileIntoAgentDir({
      sourcePath,
      agentDir,
      cwd: targetCwd,
    });

    expect(copied.cwd).toBe(targetCwd);
    expect(copied.path).toContain(encodeSessionCwd(targetCwd));
    expect(copied.path).not.toBe(sourcePath);

    const firstLine = readFileSync(copied.path, 'utf-8').split(/\r?\n/, 1)[0]!;
    expect(JSON.parse(firstLine)).toEqual(
      expect.objectContaining({
        type: 'session',
        id: 'session-1',
        cwd: targetCwd,
      }),
    );
  });

  it('throws a contextual error for invalid session headers', () => {
    const root = makeTempRoot();
    const sourcePath = join(root, 'bad.jsonl');
    writeFileSync(sourcePath, JSON.stringify({ type: 'event' }), 'utf-8');

    expect(() => readSessionFileInfo(sourcePath)).toThrow(
      `Invalid session file header: ${sourcePath}`,
    );
  });
});
