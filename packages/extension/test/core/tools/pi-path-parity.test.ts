// ============================================================
// Pi path parity — 锁定 edit/write 使用的路径输入契约
// 对应 Pi: packages/coding-agent/test/{paths,path-utils}.test.ts
// 同步日期: 2026-07-26
// ============================================================

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  expandPath,
  resolveReadPathAsync,
  resolveToCwd,
} from '../../../src/core/tools/shared/path-utils.ts';

let tempDir = '';

afterEach(() => {
  if (!tempDir) return;
  rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

function createTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'scout-pi-path-parity-'));
  return tempDir;
}

describe('Pi path parity', () => {
  it('normalizes @ paths, Unicode spaces, file URLs, and home shortcuts exactly', () => {
    const cwd = join(tmpdir(), 'scout-path-cwd');
    const target = join(cwd, 'file with spaces.ts');

    expect(expandPath('@file.ts')).toBe('file.ts');
    expect(expandPath('file\u00a0name.ts')).toBe('file name.ts');
    expect(expandPath('file\u202fname.ts')).toBe('file name.ts');
    expect(expandPath('~')).toBe(homedir());
    expect(expandPath('~/file.ts')).toBe(join(homedir(), 'file.ts'));
    expect(expandPath('~draft.md')).toBe('~draft.md');
    expect(resolveToCwd(pathToFileURL(target).href, cwd)).toBe(resolve(target));
  });

  it('resolves relative and absolute paths with the Pi rules', () => {
    const cwd = join(tmpdir(), 'scout-path-cwd');
    const absolutePath = process.platform === 'win32' ? 'C:\\work\\file.ts' : '/work/file.ts';

    expect(resolveToCwd('@src/file.ts', cwd)).toBe(resolve(cwd, 'src/file.ts'));
    expect(resolveToCwd(absolutePath, cwd)).toBe(resolve(absolutePath));
    expect(resolveToCwd('@~draft.md', cwd)).toBe(resolve(cwd, '~draft.md'));
  });

  it.each([
    {
      label: 'AM/PM narrow no-break space',
      stored: 'Screenshot 2026-07-26 at 10.00.00\u202fPM.png',
      input: 'Screenshot 2026-07-26 at 10.00.00 PM.png',
    },
    {
      label: 'NFD',
      stored: 'cafe\u0301.ts',
      input: 'caf\u00e9.ts',
    },
    {
      label: 'curly quote',
      stored: 'Capture d\u2019ecran.ts',
      input: "Capture d'ecran.ts",
    },
    {
      label: 'NFD plus curly quote',
      stored: 'Capture d\u2019e\u0301cran.ts',
      input: "Capture d'\u00e9cran.ts",
    },
  ])('resolves the Pi macOS $label filename variant', async ({ stored, input }) => {
    const cwd = createTempDir();
    writeFileSync(join(cwd, stored), 'content');

    expect(await resolveReadPathAsync(input, cwd)).toBe(join(cwd, stored));
  });
});
