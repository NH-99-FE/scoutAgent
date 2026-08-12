// ============================================================
// Changes Review Feature — lazy file diff request/cache
// 负责：按 fileId/revision 去重请求、引用计数取消、投影完成后精准重试。
// ============================================================

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type {
  ChangesReviewProjectionUpdatedEvent,
  FileDiffResultMessage,
  RequestFileDiffMessage,
  ScoutFileDiffView,
} from '@scout-agent/shared';
import { protocolClient, type CancellableProtocolRequest } from '@/bridge/protocol-client';

// ---------- 类型 ----------

export type FileDiffLoadState =
  | { status: 'idle' | 'loading' | 'pending' }
  | { status: 'ready'; diff: ScoutFileDiffView }
  | { status: 'unavailable' | 'error'; message?: string };

export interface UseFileDiffOptions extends Omit<RequestFileDiffMessage, 'type'> {
  enabled?: boolean;
}

interface FileDiffCacheEntry {
  key: string;
  params: Omit<RequestFileDiffMessage, 'type'>;
  state: FileDiffLoadState;
  listeners: Set<() => void>;
  refs: number;
  request?: CancellableProtocolRequest;
}

// ---------- Cache ----------

const MAX_CACHE_ENTRIES = 64;
const IDLE_STATE: FileDiffLoadState = { status: 'idle' };
const entries = new Map<string, FileDiffCacheEntry>();

export function useFileDiff(options: UseFileDiffOptions): FileDiffLoadState {
  const {
    sessionId,
    turnId,
    fileId,
    revision,
    recordId,
    view,
    mode,
    includeTokens,
    range,
    enabled = true,
  } = options;
  const hunkOffset = range?.hunkOffset;
  const hunkLimit = range?.hunkLimit;
  const params = useMemo<Omit<RequestFileDiffMessage, 'type'>>(
    () => ({
      sessionId,
      turnId,
      fileId,
      revision,
      recordId,
      view,
      mode,
      includeTokens,
      range:
        hunkOffset !== undefined && hunkLimit !== undefined ? { hunkOffset, hunkLimit } : undefined,
    }),
    [
      sessionId,
      turnId,
      fileId,
      revision,
      recordId,
      view,
      mode,
      includeTokens,
      hunkOffset,
      hunkLimit,
    ],
  );
  const key = useMemo(() => createFileDiffCacheKey(params), [params]);
  const subscribe = useCallback(
    (listener: () => void) =>
      enabled ? subscribeToFileDiffEntry(key, params, listener) : () => undefined,
    [enabled, key, params],
  );
  const getSnapshot = useCallback(
    () => (enabled ? getOrCreateEntry(key, params).state : IDLE_STATE),
    [enabled, key, params],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function applyChangesReviewProjectionUpdated(
  event: ChangesReviewProjectionUpdatedEvent,
): void {
  for (const entry of entries.values()) {
    if (
      entry.params.sessionId !== event.sessionId ||
      entry.params.turnId !== event.turnId ||
      entry.params.fileId !== event.fileId ||
      entry.params.revision !== event.revision ||
      entry.state.status !== 'pending'
    ) {
      continue;
    }
    if (event.status === 'unavailable') {
      updateEntry(entry, { status: 'unavailable' });
    } else if (entry.refs > 0) {
      beginRequest(entry);
    } else {
      updateEntry(entry, { status: 'idle' });
    }
  }
}

export function clearFileDiffCache(): void {
  for (const entry of entries.values()) entry.request?.cancel();
  entries.clear();
}

function subscribeToFileDiffEntry(
  key: string,
  params: Omit<RequestFileDiffMessage, 'type'>,
  listener: () => void,
): () => void {
  const entry = getOrCreateEntry(key, params);
  entry.refs += 1;
  entry.listeners.add(listener);
  if (entry.state.status === 'idle') beginRequest(entry);

  return () => {
    entry.listeners.delete(listener);
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs === 0 && entry.request) {
      entry.request.cancel();
      entry.request = undefined;
      updateEntry(entry, IDLE_STATE);
    }
    trimCache();
  };
}

function getOrCreateEntry(
  key: string,
  params: Omit<RequestFileDiffMessage, 'type'>,
): FileDiffCacheEntry {
  const existing = entries.get(key);
  if (existing) {
    entries.delete(key);
    entries.set(key, existing);
    return existing;
  }
  const entry: FileDiffCacheEntry = {
    key,
    params: {
      ...params,
      range: params.range && { ...params.range },
    },
    state: { status: 'idle' },
    listeners: new Set(),
    refs: 0,
  };
  entries.set(key, entry);
  trimCache();
  return entry;
}

function beginRequest(entry: FileDiffCacheEntry): void {
  if (entry.request) return;
  updateEntry(entry, { status: 'loading' });
  let settledSynchronously = false;
  const request = protocolClient.requestFileDiff({
    payload: entry.params,
    onResult: (result) => {
      settledSynchronously = true;
      entry.request = undefined;
      if (!matchesEntry(result, entry)) {
        updateEntry(entry, {
          status: 'error',
          message: 'File diff response identity is stale',
        });
        return;
      }
      if (result.status === 'ready') {
        updateEntry(entry, { status: 'ready', diff: result.diff });
      } else if (result.status === 'pending') {
        updateEntry(entry, { status: 'pending' });
      } else {
        updateEntry(entry, { status: result.status, message: result.message });
      }
    },
    onError: (message) => {
      settledSynchronously = true;
      entry.request = undefined;
      updateEntry(entry, { status: 'error', message });
    },
  });
  if (!settledSynchronously) entry.request = request;
}

function matchesEntry(result: FileDiffResultMessage, entry: FileDiffCacheEntry): boolean {
  return (
    result.turnId === entry.params.turnId &&
    result.fileId === entry.params.fileId &&
    result.revision === entry.params.revision
  );
}

function updateEntry(entry: FileDiffCacheEntry, state: FileDiffLoadState): void {
  entry.state = state;
  for (const listener of entry.listeners) listener();
}

function createFileDiffCacheKey(options: Omit<RequestFileDiffMessage, 'type'>): string {
  return JSON.stringify([
    options.sessionId,
    options.turnId,
    options.fileId,
    options.revision,
    options.recordId ?? '',
    options.view,
    options.mode,
    options.includeTokens,
    options.range?.hunkOffset ?? 0,
    options.range?.hunkLimit ?? 0,
  ]);
}

function trimCache(): void {
  if (entries.size <= MAX_CACHE_ENTRIES) return;
  for (const [key, entry] of entries) {
    if (entry.refs > 0 || entry.request) continue;
    entries.delete(key);
    if (entries.size <= MAX_CACHE_ENTRIES) return;
  }
}
