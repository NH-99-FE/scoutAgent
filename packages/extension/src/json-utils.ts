// ============================================================
// JSON 工具 — extension 内部 JSON 文件与纯 JSON 数据处理
// ============================================================

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

const FILE_LOCK_MAX_ATTEMPTS = 10;
const FILE_LOCK_RETRY_DELAY_MS = 20;
const FILE_LOCK_STALE_MS = 30_000;

// ---------- 类型 ----------

export type JsonReadResult<TValue> = { ok: true; value: TValue } | { ok: false; error: string };

export interface ReadJsonFileOptions<TMissing = undefined> {
  errorLabel: string;
  missingValue?: TMissing;
}

export interface ReadJsonObjectFileOptions {
  errorLabel: string;
  rootError: string;
}

// ---------- 文件读写 ----------

export function readJsonFile<TMissing = undefined>(
  path: string,
  options: ReadJsonFileOptions<TMissing>,
): JsonReadResult<unknown | TMissing> {
  if (!existsSync(path)) return { ok: true, value: options.missingValue as TMissing };
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf-8')) as unknown };
  } catch (cause) {
    return {
      ok: false,
      error: `${options.errorLabel}: ${path}: ${formatError(cause)}`,
    };
  }
}

export function readJsonObjectFile(
  path: string,
  options: ReadJsonObjectFileOptions,
): JsonReadResult<Record<string, unknown>> {
  const read = readJsonFile(path, {
    errorLabel: options.errorLabel,
    missingValue: {},
  });
  if (!read.ok) return read;
  if (isRecord(read.value)) return { ok: true, value: read.value };
  return {
    ok: false,
    error: `${options.errorLabel}: ${path}: ${options.rootError}`,
  };
}

export function writeJsonFile(path: string, value: unknown): void {
  writeTextFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function withFileLock<TValue>(path: string, fn: () => TValue): TValue {
  const release = acquireFileLock(path);
  try {
    return fn();
  } finally {
    release();
  }
}

// ---------- 纯 JSON 数据 ----------

export function cloneJson<TValue>(value: TValue): TValue {
  return JSON.parse(JSON.stringify(value)) as TValue;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function formatError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function writeTextFileAtomic(path: string, content: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tempPath = join(
    dir,
    `.${basename(path)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    writeFileSync(tempPath, content, 'utf-8');
    renameSync(tempPath, path);
  } catch (cause) {
    rmSync(tempPath, { force: true });
    throw cause;
  }
}

function acquireFileLock(path: string): () => void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const lockPath = `${path}.lock`;
  let lastError: unknown;

  for (let attempt = 1; attempt <= FILE_LOCK_MAX_ATTEMPTS; attempt++) {
    try {
      mkdirSync(lockPath);
      writeFileSync(
        join(lockPath, 'owner'),
        `${process.pid}\n${new Date().toISOString()}\n`,
        'utf-8',
      );
      return () => rmSync(lockPath, { recursive: true, force: true });
    } catch (cause) {
      const code = getErrorCode(cause);
      if (code !== 'EEXIST') throw cause;
      lastError = cause;
      if (isStaleLock(lockPath)) {
        rmSync(lockPath, { recursive: true, force: true });
        continue;
      }
      if (attempt === FILE_LOCK_MAX_ATTEMPTS) break;
      waitSynchronously(FILE_LOCK_RETRY_DELAY_MS);
    }
  }

  throw new Error(`Failed to acquire file lock: ${path}`, {
    cause: lastError,
  });
}

function isStaleLock(lockPath: string): boolean {
  try {
    return Date.now() - statSync(lockPath).mtimeMs > FILE_LOCK_STALE_MS;
  } catch (cause) {
    return getErrorCode(cause) === 'ENOENT';
  }
}

function waitSynchronously(delayMs: number): void {
  const start = Date.now();
  while (Date.now() - start < delayMs) {
    // 保持 SettingsManager 同步 API，同时沿用 Pi 的 scoped lock 形态。
  }
}

function getErrorCode(cause: unknown): string | undefined {
  return typeof cause === 'object' && cause !== null && 'code' in cause
    ? String((cause as { code?: unknown }).code)
    : undefined;
}
