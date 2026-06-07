// ============================================================
// 托管工具 — rg/fd 查找与按需安装
// ============================================================

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { arch, platform } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// ---------- 类型 ----------

type ManagedToolName = 'fd' | 'rg';

interface ToolConfig {
  name: string;
  repo: string;
  binaryName: string;
  systemBinaryNames?: string[];
  tagPrefix: string;
  isVersionOutput: (output: string) => boolean;
  getAssetName: (version: string, plat: string, architecture: string) => string | null;
}

// ---------- 常量 ----------

const NETWORK_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

const TOOLS: Record<ManagedToolName, ToolConfig> = {
  fd: {
    name: 'fd',
    repo: 'sharkdp/fd',
    binaryName: 'fd',
    systemBinaryNames: ['fd', 'fdfind'],
    tagPrefix: 'v',
    isVersionOutput: (output) =>
      /^fd\s+\d+\.\d+\.\d+(?:\s|$)/i.test(output) || /sharkdp\/fd|fd-find/i.test(output),
    getAssetName: (version, plat, architecture) => {
      if (plat === 'darwin') {
        const archStr = architecture === 'arm64' ? 'aarch64' : 'x86_64';
        return `fd-v${version}-${archStr}-apple-darwin.tar.gz`;
      }
      if (plat === 'linux') {
        const archStr = architecture === 'arm64' ? 'aarch64' : 'x86_64';
        return `fd-v${version}-${archStr}-unknown-linux-gnu.tar.gz`;
      }
      if (plat === 'win32') {
        const archStr = architecture === 'arm64' ? 'aarch64' : 'x86_64';
        return `fd-v${version}-${archStr}-pc-windows-msvc.zip`;
      }
      return null;
    },
  },
  rg: {
    name: 'ripgrep',
    repo: 'BurntSushi/ripgrep',
    binaryName: 'rg',
    tagPrefix: '',
    isVersionOutput: (output) => /^ripgrep\s+\d+|^rg\s+\d+|BurntSushi\/ripgrep/i.test(output),
    getAssetName: (version, plat, architecture) => {
      if (plat === 'darwin') {
        const archStr = architecture === 'arm64' ? 'aarch64' : 'x86_64';
        return `ripgrep-${version}-${archStr}-apple-darwin.tar.gz`;
      }
      if (plat === 'linux') {
        if (architecture === 'arm64') return `ripgrep-${version}-aarch64-unknown-linux-gnu.tar.gz`;
        return `ripgrep-${version}-x86_64-unknown-linux-musl.tar.gz`;
      }
      if (plat === 'win32') {
        const archStr = architecture === 'arm64' ? 'aarch64' : 'x86_64';
        return `ripgrep-${version}-${archStr}-pc-windows-msvc.zip`;
      }
      return null;
    },
  },
};

// ---------- 路径与模式 ----------

function getBinDir(): string {
  return process.env.SCOUT_AGENT_BIN_DIR || join(homedir(), '.scout', 'bin');
}

function isOfflineModeEnabled(): boolean {
  const value = process.env.SCOUT_OFFLINE ?? process.env.PI_OFFLINE;
  if (!value) return false;
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes';
}

// ---------- 查找 ----------

function commandMatchesTool(command: string, config: ToolConfig): boolean {
  try {
    const result = spawnSync(command, ['--version'], { stdio: 'pipe', windowsHide: true });
    if (result.error) return false;
    const output = `${result.stdout?.toString() ?? ''}\n${result.stderr?.toString() ?? ''}`.trim();
    return config.isVersionOutput(output);
  } catch {
    return false;
  }
}

export function getToolPath(tool: ManagedToolName): string | null {
  const config = TOOLS[tool];
  const localPath = join(getBinDir(), config.binaryName + (platform() === 'win32' ? '.exe' : ''));
  if (existsSync(localPath)) return localPath;

  const systemBinaryNames = config.systemBinaryNames ?? [config.binaryName];
  for (const systemBinaryName of systemBinaryNames) {
    if (commandMatchesTool(systemBinaryName, config)) return systemBinaryName;
  }

  return null;
}

// ---------- 下载与解压 ----------

function createTimedAbortSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  const onAbort = () => {
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal?.aborted) {
    onAbort();
  } else {
    parentSignal?.addEventListener('abort', onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', onAbort);
    },
  };
}

async function getLatestVersion(repo: string, signal?: AbortSignal): Promise<string> {
  const timedSignal = createTimedAbortSignal(NETWORK_TIMEOUT_MS, signal);
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { 'User-Agent': 'scout-agent' },
      signal: timedSignal.signal,
    });
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }
    const data = (await response.json()) as { tag_name: string };
    return data.tag_name.replace(/^v/, '');
  } finally {
    timedSignal.dispose();
  }
}

async function downloadFile(url: string, destination: string, signal?: AbortSignal): Promise<void> {
  const timedSignal = createTimedAbortSignal(DOWNLOAD_TIMEOUT_MS, signal);
  try {
    const response = await fetch(url, {
      signal: timedSignal.signal,
    });
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status}`);
    }
    if (!response.body) {
      throw new Error('No response body');
    }
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(destination));
  } finally {
    timedSignal.dispose();
  }
}

function findBinaryRecursively(rootDir: string, binaryFileName: string): string | null {
  const stack = [rootDir];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) continue;
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isFile() && entry.name === binaryFileName) return fullPath;
      if (entry.isDirectory()) stack.push(fullPath);
    }
  }
  return null;
}

function formatSpawnFailure(result: SpawnSyncReturns<Buffer>): string {
  if (result.error?.message) return result.error.message;
  const stderr = result.stderr?.toString().trim();
  if (stderr) return stderr;
  const stdout = result.stdout?.toString().trim();
  if (stdout) return stdout;
  return `exit status ${result.status ?? 'unknown'}`;
}

function runExtractionCommand(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, { stdio: 'pipe', windowsHide: true });
  if (!result.error && result.status === 0) return null;
  return `${command}: ${formatSpawnFailure(result)}`;
}

function extractTarGzArchive(archivePath: string, extractDir: string, assetName: string): void {
  const failure = runExtractionCommand('tar', ['xzf', archivePath, '-C', extractDir]);
  if (failure) {
    throw new Error(`Failed to extract ${assetName}: ${failure}`);
  }
}

function getWindowsTarCommand(): string {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (systemRoot) {
    const systemTar = join(systemRoot, 'System32', 'tar.exe');
    if (existsSync(systemTar)) return systemTar;
  }
  return 'tar.exe';
}

function extractZipArchive(archivePath: string, extractDir: string, assetName: string): void {
  const failures: string[] = [];
  if (platform() === 'win32') {
    const tarFailure = runExtractionCommand(getWindowsTarCommand(), [
      'xf',
      archivePath,
      '-C',
      extractDir,
    ]);
    if (!tarFailure) return;
    failures.push(tarFailure);

    const script =
      "& { param($archive, $destination) $ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }";
    const powershellFailure = runExtractionCommand('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
      archivePath,
      extractDir,
    ]);
    if (!powershellFailure) return;
    failures.push(powershellFailure);
  } else {
    const unzipFailure = runExtractionCommand('unzip', ['-q', archivePath, '-d', extractDir]);
    if (!unzipFailure) return;
    failures.push(unzipFailure);

    const tarFailure = runExtractionCommand('tar', ['xf', archivePath, '-C', extractDir]);
    if (!tarFailure) return;
    failures.push(tarFailure);
  }

  throw new Error(`Failed to extract ${assetName}: ${failures.join('; ')}`);
}

async function downloadTool(tool: ManagedToolName, signal?: AbortSignal): Promise<string> {
  const config = TOOLS[tool];
  const plat = platform();
  const architecture = arch();
  let version = await getLatestVersion(config.repo, signal);
  if (tool === 'fd' && plat === 'darwin' && architecture === 'x64') {
    version = '10.3.0';
  }

  const assetName = config.getAssetName(version, plat, architecture);
  if (!assetName) {
    throw new Error(`Unsupported platform: ${plat}/${architecture}`);
  }

  const binDir = getBinDir();
  mkdirSync(binDir, { recursive: true });

  const downloadUrl = `https://github.com/${config.repo}/releases/download/${config.tagPrefix}${version}/${assetName}`;
  const archivePath = join(binDir, assetName);
  const binaryExt = plat === 'win32' ? '.exe' : '';
  const binaryPath = join(binDir, config.binaryName + binaryExt);
  const extractDir = join(
    binDir,
    `extract_tmp_${config.binaryName}_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
  );

  await downloadFile(downloadUrl, archivePath, signal);
  mkdirSync(extractDir, { recursive: true });

  try {
    if (assetName.endsWith('.tar.gz')) {
      extractTarGzArchive(archivePath, extractDir, assetName);
    } else if (assetName.endsWith('.zip')) {
      extractZipArchive(archivePath, extractDir, assetName);
    } else {
      throw new Error(`Unsupported archive format: ${assetName}`);
    }

    const binaryFileName = config.binaryName + binaryExt;
    const extractedDir = join(extractDir, assetName.replace(/\.(tar\.gz|zip)$/, ''));
    const candidates = [join(extractedDir, binaryFileName), join(extractDir, binaryFileName)];
    const extractedBinary =
      candidates.find((candidate) => existsSync(candidate)) ??
      findBinaryRecursively(extractDir, binaryFileName);

    if (!extractedBinary) {
      throw new Error(
        `Binary not found in archive: expected ${binaryFileName} under ${extractDir}`,
      );
    }
    renameSync(extractedBinary, binaryPath);
    if (plat !== 'win32') chmodSync(binaryPath, 0o755);
  } finally {
    rmSync(archivePath, { force: true });
    rmSync(extractDir, { recursive: true, force: true });
  }

  return binaryPath;
}

// ---------- 公开入口 ----------

export async function ensureTool(
  tool: ManagedToolName,
  silent: boolean = false,
  options?: { signal?: AbortSignal },
): Promise<string | undefined> {
  const existingPath = getToolPath(tool);
  if (existingPath) return existingPath;
  if (options?.signal?.aborted) return undefined;

  const config = TOOLS[tool];
  if (isOfflineModeEnabled()) {
    if (!silent) {
      console.warn(`${config.name} not found. Offline mode enabled, skipping download.`);
    }
    return undefined;
  }

  if (platform() === 'android') {
    if (!silent) {
      const pkgName = tool === 'rg' ? 'ripgrep' : 'fd';
      console.warn(`${config.name} not found. Install with: pkg install ${pkgName}`);
    }
    return undefined;
  }

  if (!silent) {
    process.stdout.write(`${config.name} not found. Downloading...\n`);
  }

  try {
    const path = await downloadTool(tool, options?.signal);
    if (!silent) {
      process.stdout.write(`${config.name} installed to ${path}\n`);
    }
    return path;
  } catch (error) {
    if (!silent) {
      console.warn(
        `Failed to download ${config.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return undefined;
  }
}
