// ============================================================
// Review Artifact Store — gzip 压缩的内容寻址文本/manifest 存储
// 负责：原子提交、hash 校验、大小防护与基础孤儿回收。
// ============================================================

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { MAX_REVIEW_TEXT_BYTES } from '../text-size.ts';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const REVIEW_ARTIFACT_STORE_VERSION = 1;
export const REVIEW_ARTIFACT_GC_GRACE_MS = 24 * 60 * 60 * 1_000;
export const REVIEW_ARTIFACT_SOFT_LIMIT_BYTES = 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

export interface ReviewArtifactStoreOptions {
  agentDir: string;
}

export interface ReviewArtifactGarbageCollectionResult {
  deletedFiles: number;
  deletedBytes: number;
  retainedBytes: number;
  reclaimableFiles: number;
  reclaimableBytes: number;
}

export class ReviewArtifactStore {
  readonly root: string;
  private readonly blobRoot: string;
  private readonly manifestRoot: string;

  constructor(options: ReviewArtifactStoreOptions) {
    this.root = join(resolve(options.agentDir), 'artifacts', 'review');
    this.blobRoot = join(this.root, 'blobs', 'sha256');
    this.manifestRoot = join(this.root, 'manifests', 'sha256');
  }

  async putText(content: string): Promise<string> {
    const normalized = content.startsWith('\uFEFF') ? content.slice(1) : content;
    const bytes = Buffer.from(normalized, 'utf8');
    if (bytes.byteLength > MAX_REVIEW_TEXT_BYTES) {
      throw new Error(`Review snapshot exceeds ${MAX_REVIEW_TEXT_BYTES} bytes`);
    }
    const hash = hashBytes(bytes);
    await this.putCompressedObject(this.getBlobPath(hash), createEnvelope('review_text', bytes));
    return hash;
  }

  async getText(hash: string): Promise<string> {
    const stored = await this.getCompressedObject(this.getBlobPath(assertHash(hash)), {
      maxBytes: MAX_REVIEW_TEXT_BYTES + 256,
    });
    const bytes = parseEnvelope(stored, 'review_text');
    if (bytes.byteLength > MAX_REVIEW_TEXT_BYTES) throw new Error('Review artifact is too large');
    if (hashBytes(bytes) !== hash) throw new Error(`Review artifact hash mismatch: ${hash}`);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  async putManifest(value: unknown): Promise<string> {
    const bytes = Buffer.from(stableStringify(value), 'utf8');
    if (bytes.byteLength > MAX_MANIFEST_BYTES) {
      throw new Error(`Review manifest exceeds ${MAX_MANIFEST_BYTES} bytes`);
    }
    const hash = hashBytes(bytes);
    await this.putCompressedObject(
      this.getManifestPath(hash),
      createEnvelope('review_manifest', bytes),
    );
    return hash;
  }

  async getManifest(hash: string): Promise<unknown> {
    const stored = await this.getCompressedObject(this.getManifestPath(assertHash(hash)), {
      maxBytes: MAX_MANIFEST_BYTES + 256,
    });
    const bytes = parseEnvelope(stored, 'review_manifest');
    if (bytes.byteLength > MAX_MANIFEST_BYTES) throw new Error('Review manifest is too large');
    if (hashBytes(bytes) !== hash) throw new Error(`Review artifact hash mismatch: ${hash}`);
    return JSON.parse(bytes.toString('utf8')) as unknown;
  }

  getBlobPath(hash: string): string {
    return join(this.blobRoot, hash.slice(0, 2), `${hash}.gz`);
  }

  getManifestPath(hash: string): string {
    return join(this.manifestRoot, hash.slice(0, 2), `${hash}.json.gz`);
  }

  async collectGarbage(
    referencedManifestHashes: ReadonlySet<string>,
    referencedBlobHashes: ReadonlySet<string>,
    options: { now?: number; graceMs?: number } = {},
  ): Promise<ReviewArtifactGarbageCollectionResult> {
    const now = options.now ?? Date.now();
    const graceMs = options.graceMs ?? REVIEW_ARTIFACT_GC_GRACE_MS;
    const candidates = [
      ...(await listStoredObjects(this.manifestRoot, '.json.gz')).map((entry) => ({
        ...entry,
        referenced: referencedManifestHashes.has(entry.hash),
      })),
      ...(await listStoredObjects(this.blobRoot, '.gz')).map((entry) => ({
        ...entry,
        referenced: referencedBlobHashes.has(entry.hash),
      })),
    ];
    const temporaryFiles = [
      ...(await listTemporaryFiles(this.manifestRoot)),
      ...(await listTemporaryFiles(this.blobRoot)),
    ];
    const retainedBytes = candidates.reduce((sum, entry) => sum + entry.size, 0);
    let deletedBytes = 0;
    let deletedFiles = 0;
    const removable = candidates
      .filter((entry) => !entry.referenced && now - entry.mtimeMs >= graceMs)
      .sort((left, right) => left.mtimeMs - right.mtimeMs);
    const reclaimableBytes = removable.reduce((sum, entry) => sum + entry.size, 0);

    // 正式 CAS 对象只扫描，不自动删除。put/manifest/session ref 尚未共享
    // 跨进程提交锁前，后台 sweep 会与其他 VS Code 窗口的提交产生竞态。
    for (const entry of temporaryFiles) {
      if (now - entry.mtimeMs < graceMs) continue;
      await rm(entry.path, { force: true });
      deletedBytes += entry.size;
      deletedFiles += 1;
    }
    return {
      deletedFiles,
      deletedBytes,
      retainedBytes,
      reclaimableFiles: removable.length,
      reclaimableBytes,
    };
  }

  private async putCompressedObject(path: string, bytes: Buffer): Promise<void> {
    try {
      const existing = await readFile(path);
      const uncompressed = await gunzipAsync(existing);
      if (hashBytes(uncompressed) !== hashBytes(bytes)) {
        throw new Error(`Review artifact hash collision at ${path}`);
      }
      return;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }

    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const compressed = await gzipAsync(bytes, { level: 6 });
    const tempPath = join(dirname(path), `.${randomUUID()}.tmp`);
    const file = await open(tempPath, 'wx', 0o600);
    try {
      await file.writeFile(compressed);
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await rename(tempPath, path);
      const directory = await open(dirname(path), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error) {
      await rm(tempPath, { force: true });
      if (!isAlreadyExistsError(error)) throw error;
    }
  }

  private async getCompressedObject(path: string, options: { maxBytes: number }): Promise<Buffer> {
    const compressed = await readFile(path);
    const bytes = await gunzipAsync(compressed, { maxOutputLength: options.maxBytes + 1 });
    if (bytes.byteLength > options.maxBytes) throw new Error('Review artifact is too large');
    return bytes;
  }
}

type ReviewArtifactObjectType = 'review_text' | 'review_manifest';

function createEnvelope(type: ReviewArtifactObjectType, payload: Buffer): Buffer {
  const header = Buffer.from(
    `${JSON.stringify({ type, version: REVIEW_ARTIFACT_STORE_VERSION, byteLength: payload.byteLength })}\n`,
    'utf8',
  );
  return Buffer.concat([header, payload]);
}

function parseEnvelope(stored: Buffer, expectedType: ReviewArtifactObjectType): Buffer {
  const separator = stored.indexOf(0x0a);
  if (separator < 0 || separator > 255) throw new Error('Review artifact envelope is invalid');
  let header: unknown;
  try {
    header = JSON.parse(stored.subarray(0, separator).toString('utf8')) as unknown;
  } catch {
    throw new Error('Review artifact envelope header is invalid');
  }
  if (
    !header ||
    typeof header !== 'object' ||
    !('type' in header) ||
    header.type !== expectedType ||
    !('version' in header) ||
    header.version !== REVIEW_ARTIFACT_STORE_VERSION ||
    !('byteLength' in header) ||
    !Number.isInteger(header.byteLength)
  ) {
    throw new Error('Review artifact object type or version is unsupported');
  }
  const payload = stored.subarray(separator + 1);
  if (payload.byteLength !== header.byteLength) {
    throw new Error('Review artifact envelope length mismatch');
  }
  return payload;
}

async function listTemporaryFiles(root: string) {
  const result: Array<{ path: string; size: number; mtimeMs: number }> = [];
  let directories: string[];
  try {
    directories = await readdir(root);
  } catch (error) {
    if (isMissingFileError(error)) return result;
    throw error;
  }
  for (const directoryName of directories) {
    const directory = join(root, directoryName);
    for (const fileName of await readdir(directory)) {
      if (!fileName.endsWith('.tmp')) continue;
      const path = join(directory, fileName);
      const metadata = await stat(path);
      result.push({ path, size: metadata.size, mtimeMs: metadata.mtimeMs });
    }
  }
  return result;
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJsonValue(child)]),
  );
}

function assertHash(hash: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Invalid review artifact hash: ${hash}`);
  return hash;
}

async function listStoredObjects(root: string, suffix: string) {
  const result: Array<{ hash: string; path: string; size: number; mtimeMs: number }> = [];
  let directories: string[];
  try {
    directories = await readdir(root);
  } catch (error) {
    if (isMissingFileError(error)) return result;
    throw error;
  }
  for (const directoryName of directories) {
    const directory = join(root, directoryName);
    for (const fileName of await readdir(directory)) {
      if (!fileName.endsWith(suffix)) continue;
      const hash = fileName.slice(0, -suffix.length);
      if (!/^[a-f0-9]{64}$/.test(hash)) continue;
      const path = join(directory, fileName);
      const metadata = await stat(path);
      result.push({ hash, path, size: metadata.size, mtimeMs: metadata.mtimeMs });
    }
  }
  return result;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function isAlreadyExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST');
}
