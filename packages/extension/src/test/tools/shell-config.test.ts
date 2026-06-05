// ============================================================
// shell-config 测试
// ============================================================

import { delimiter } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function importShellConfigWithMocks(options: {
  platform: NodeJS.Platform;
  existsSync: (path: string) => boolean;
  spawnSync?: () => { status: number | null; stdout: string };
  env?: NodeJS.ProcessEnv;
}) {
  vi.resetModules();
  vi.doMock('node:fs', () => ({
    existsSync: vi.fn(options.existsSync),
  }));
  vi.doMock('node:child_process', () => ({
    spawnSync: vi.fn(options.spawnSync ?? (() => ({ status: 1, stdout: '' }))),
  }));
  vi.spyOn(process, 'platform', 'get').mockReturnValue(options.platform);
  process.env = { ...ORIGINAL_ENV, ...options.env };

  return await import('../../tools/shared/shell-config.ts');
}

describe('getShellConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it('uses an existing custom shell path', async () => {
    const { getShellConfig } = await importShellConfigWithMocks({
      platform: 'linux',
      existsSync: (path) => path === '/custom/bash',
    });

    expect(getShellConfig('/custom/bash')).toEqual({ shell: '/custom/bash', args: ['-c'] });
  });

  it('throws when the custom shell path is missing', async () => {
    const { getShellConfig } = await importShellConfigWithMocks({
      platform: 'linux',
      existsSync: () => false,
    });

    expect(() => getShellConfig('/missing/bash')).toThrow(
      'Custom shell path not found: /missing/bash',
    );
  });

  it('prefers Git Bash from Program Files on Windows', async () => {
    const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
    const { getShellConfig } = await importShellConfigWithMocks({
      platform: 'win32',
      env: { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': '' },
      existsSync: (path) => path === gitBash,
    });

    expect(getShellConfig()).toEqual({ shell: gitBash, args: ['-c'] });
  });

  it('falls back to bash.exe on PATH on Windows', async () => {
    const bashOnPath = 'C:\\msys64\\usr\\bin\\bash.exe';
    const { getShellConfig } = await importShellConfigWithMocks({
      platform: 'win32',
      env: { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
      existsSync: (path) => path === bashOnPath,
      spawnSync: () => ({ status: 0, stdout: `${bashOnPath}\r\n` }),
    });

    expect(getShellConfig()).toEqual({ shell: bashOnPath, args: ['-c'] });
  });

  it('uses /bin/bash on Unix when available', async () => {
    const { getShellConfig } = await importShellConfigWithMocks({
      platform: 'linux',
      existsSync: (path) => path === '/bin/bash',
    });

    expect(getShellConfig()).toEqual({ shell: '/bin/bash', args: ['-c'] });
  });

  it('falls back to sh on Unix when bash is unavailable', async () => {
    const { getShellConfig } = await importShellConfigWithMocks({
      platform: 'linux',
      existsSync: () => false,
      spawnSync: () => ({ status: 1, stdout: '' }),
    });

    expect(getShellConfig()).toEqual({ shell: 'sh', args: ['-c'] });
  });
});

describe('getShellEnv', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns an independent environment copy with a normalized PATH key', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      PATH: ['first', '', 'second'].join(delimiter),
      SCOUT_TEST_ENV: 'present',
    };
    const { getShellEnv } = await import('../../tools/shared/shell-config.ts');

    const env = getShellEnv();
    env.SCOUT_TEST_ENV = 'changed';

    expect(env.PATH).toBe(['first', 'second'].join(delimiter));
    expect(process.env.SCOUT_TEST_ENV).toBe('present');
  });
});
