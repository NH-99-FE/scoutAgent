// ============================================================
// Fork Candidate Menu Hook — fork 候选请求与面板状态
// ============================================================

import type { KeyboardEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ScoutForkCandidate } from '@scout-agent/shared';
import { protocolClient } from '@/bridge/protocol-client';

// ---------- 类型 ----------

type ForkCandidateListener = (candidates: ScoutForkCandidate[]) => void;

interface UseForkCandidateMenuOptions {
  branchVersion: string;
  prefetch: boolean;
  sessionId: string;
}

interface ForkCandidateLoadState {
  candidates: ScoutForkCandidate[];
  signature: string;
}

// ---------- 缓存 ----------

const candidateCache = new Map<string, ForkCandidateLoadState>();
const inflightRequests = new Map<string, Set<ForkCandidateListener>>();

// 稳定空数组：candidates 为 null（加载中）时复用同一引用，
// 避免 list 每次 render 新建导致 confirm/forkMenu 连锁重建、浮层监听器反复重绑。
const EMPTY_FORK_CANDIDATES: readonly ScoutForkCandidate[] = [];

function getCandidateSignature(candidates: ScoutForkCandidate[]): string {
  return candidates.map((candidate) => candidate.entryId).join('\n');
}

function getCacheKey(sessionId: string, branchVersion: string): string {
  return `${sessionId}\0${branchVersion}`;
}

function loadForkCandidates(
  cacheKey: string,
  sessionId: string,
  listener: ForkCandidateListener,
): () => void {
  const cached = candidateCache.get(cacheKey);
  if (cached) {
    listener(cached.candidates);
    return () => undefined;
  }

  const inflight = inflightRequests.get(cacheKey);
  if (inflight) {
    inflight.add(listener);
    return () => detachListener(cacheKey, inflight, listener);
  }

  const listeners = new Set<ForkCandidateListener>([listener]);
  inflightRequests.set(cacheKey, listeners);
  protocolClient.requestForkCandidates(sessionId, (candidates, responseSessionId) => {
    // 身份守卫：cacheKey 可能已被 clearForkCandidateCache 清除并由新请求重新占用，
    // 此时本次回包属于已作废的旧请求，整包丢弃——既不删除新请求的 Set，也不把过期候选投给新 listener。
    if (inflightRequests.get(cacheKey) !== listeners) return;
    inflightRequests.delete(cacheKey);
    if (responseSessionId !== sessionId) return;
    if (listeners.size === 0) return;
    candidateCache.set(cacheKey, {
      candidates,
      signature: getCandidateSignature(candidates),
    });
    listeners.forEach((currentListener) => currentListener(candidates));
  });

  return () => detachListener(cacheKey, listeners, listener);
}

// 仅当 map 中仍是本请求的 Set 时才按 key 移除，避免误删后续同 cacheKey 的新请求。
function detachListener(
  cacheKey: string,
  listeners: Set<ForkCandidateListener>,
  listener: ForkCandidateListener,
): void {
  listeners.delete(listener);
  if (listeners.size === 0 && inflightRequests.get(cacheKey) === listeners) {
    inflightRequests.delete(cacheKey);
  }
}

export function clearForkCandidateCache(sessionId?: string): void {
  if (sessionId) {
    for (const key of candidateCache.keys()) {
      if (key.startsWith(`${sessionId}\0`)) candidateCache.delete(key);
    }
    for (const key of inflightRequests.keys()) {
      if (key.startsWith(`${sessionId}\0`)) inflightRequests.delete(key);
    }
    return;
  }
  candidateCache.clear();
  inflightRequests.clear();
}

// ---------- Hook ----------

export function useForkCandidateMenu({
  branchVersion,
  prefetch,
  sessionId,
}: UseForkCandidateMenuOptions) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<ScoutForkCandidate[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [renderedCacheKey, setRenderedCacheKey] = useState(() =>
    getCacheKey(sessionId, branchVersion),
  );
  const wantsCandidates = open || prefetch;
  const cacheKey = getCacheKey(sessionId, branchVersion);

  // cacheKey 变化即重置面板状态：在 render 期同步调整（React 推荐方式），
  // 避免在 effect 内 setState 造成的级联渲染与一帧闪烁。
  if (renderedCacheKey !== cacheKey) {
    setRenderedCacheKey(cacheKey);
    setOpen(false);
    setCandidates(candidateCache.get(cacheKey)?.candidates ?? null);
    setActiveIndex(0);
  }

  // 旧 cacheKey 失效时清理其缓存与空闲 inflight 占位（外部 store 的副作用，留在 effect 中）。
  useEffect(() => {
    return () => {
      candidateCache.delete(cacheKey);
      const listeners = inflightRequests.get(cacheKey);
      if (listeners?.size === 0) inflightRequests.delete(cacheKey);
    };
  }, [cacheKey]);

  useEffect(() => {
    if (!wantsCandidates) return undefined;
    return loadForkCandidates(cacheKey, sessionId, (nextCandidates) => {
      setCandidates((currentCandidates) => {
        const currentSignature = currentCandidates
          ? getCandidateSignature(currentCandidates)
          : undefined;
        const nextSignature = getCandidateSignature(nextCandidates);
        return currentSignature === nextSignature ? currentCandidates : nextCandidates;
      });
      setActiveIndex(nextCandidates.length > 0 ? nextCandidates.length - 1 : 0);
    });
  }, [cacheKey, open, prefetch, sessionId, wantsCandidates]);

  const list = candidates ?? EMPTY_FORK_CANDIDATES;
  const boundedActiveIndex = list.length === 0 ? 0 : Math.min(activeIndex, list.length - 1);

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(0);
  }, []);

  const openMenu = useCallback(() => {
    setOpen(true);
  }, []);

  const confirm = useCallback(
    (index: number) => {
      const candidate = list[index];
      if (!candidate) return;
      clearForkCandidateCache(sessionId);
      protocolClient.forkSession(candidate.entryId);
      close();
    },
    [close, list, sessionId],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!open) return false;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return true;
      }
      if (list.length === 0) return false;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((boundedActiveIndex + 1) % list.length);
        return true;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((boundedActiveIndex - 1 + list.length) % list.length);
        return true;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        confirm(boundedActiveIndex);
        return true;
      }
      return false;
    },
    [boundedActiveIndex, close, confirm, list.length, open],
  );

  return useMemo(
    () => ({
      activeIndex: boundedActiveIndex,
      candidates,
      close,
      confirm,
      handleKeyDown,
      onHover: setActiveIndex,
      open,
      openMenu,
    }),
    [boundedActiveIndex, candidates, close, confirm, handleKeyDown, open, openMenu],
  );
}
