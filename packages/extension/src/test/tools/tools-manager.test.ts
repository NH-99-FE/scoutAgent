// ============================================================
// tools-manager 测试
// ============================================================

import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function importToolsManagerWithMocks(options: {
  platform?: NodeJS.Platform;
  arch?: string;
  existsSync?: (path: string) => boolean;
  spawnSync?: (
    command: string,
    args: string[],
  ) => { status: number | null; stdout?: Buffer; error?: Error };
  homedir?: string;
}) {
  vi.resetModules();
  vi.doMock('node:fs', () => ({
    chmodSync: vi.fn(),
    createWriteStream: vi.fn(),
    existsSync: vi.fn(options.existsSync ?? (() => false)),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    renameSync: vi.fn(),
    rmSync: vi.fn(),
  }));
  vi.doMock('node:child_process', () => ({
    spawnSync: vi.fn(
      options.spawnSync ??
        (() => ({
          status: 1,
          stdout: Buffer.from(''),
          error: Object.assign(new Error('not found'), { code: 'ENOENT' }),
        })),
    ),
  }));
  vi.doMock('node:os', () => ({
    homedir: vi.fn(() => options.homedir ?? '/home/test'),
    platform: vi.fn(() => options.platform ?? 'linux'),
    arch: vi.fn(() => options.arch ?? 'x64'),
  }));

  return await import('../../tools/shared/tools-manager.ts');
}

describe('getToolPath', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it('prefers the managed binary directory', async () => {
    process.env = { ...ORIGINAL_ENV, SCOUT_AGENT_BIN_DIR: '/managed/bin' };
    const { getToolPath } = await importToolsManagerWithMocks({
      existsSync: (path) => path.replace(/\\/g, '/') === '/managed/bin/rg',
    });

    expect(getToolPath('rg')?.replace(/\\/g, '/')).toBe('/managed/bin/rg');
  });

  it('falls back to the system command on PATH', async () => {
    const { getToolPath } = await importToolsManagerWithMocks({
      existsSync: () => false,
      spawnSync: (command) => ({
        status: command === 'rg' ? 0 : 1,
        stdout: Buffer.from(command === 'rg' ? 'ripgrep 14.1.1' : ''),
      }),
    });

    expect(getToolPath('rg')).toBe('rg');
  });

  it('supports fdfind as a system fd binary alias', async () => {
    const calls: string[] = [];
    const { getToolPath } = await importToolsManagerWithMocks({
      existsSync: () => false,
      spawnSync: (command) => {
        calls.push(command);
        return {
          status: command === 'fdfind' ? 0 : 1,
          stdout: Buffer.from(command === 'fdfind' ? 'fd 10.2.0' : ''),
          error: command === 'fdfind' ? undefined : new Error('not found'),
        };
      },
    });

    expect(getToolPath('fd')).toBe('fdfind');
    expect(calls).toEqual(['fd', 'fdfind']);
  });

  it('skips fdclone and continues to fdfind', async () => {
    const calls: string[] = [];
    const { getToolPath } = await importToolsManagerWithMocks({
      existsSync: () => false,
      spawnSync: (command) => {
        calls.push(command);
        return {
          status: 0,
          stdout: Buffer.from(command === 'fd' ? 'fd 3.01j' : 'fd 10.2.0'),
        };
      },
    });

    expect(getToolPath('fd')).toBe('fdfind');
    expect(calls).toEqual(['fd', 'fdfind']);
  });
});

describe('ensureTool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns undefined in offline mode when the tool is unavailable', async () => {
    process.env = { ...ORIGINAL_ENV, SCOUT_OFFLINE: '1' };
    const { ensureTool } = await importToolsManagerWithMocks({
      existsSync: () => false,
    });

    await expect(ensureTool('rg', true)).resolves.toBeUndefined();
  });
});
