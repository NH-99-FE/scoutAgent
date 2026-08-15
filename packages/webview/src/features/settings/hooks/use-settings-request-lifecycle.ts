// ============================================================
// Settings Request Lifecycle — 设置协议请求的通用时序状态
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

/** 首次启用 controller 时加载一次；手动调用会同时标记为已加载。 */
export function useLazySettingsLoad(enabled: boolean, request: () => void): () => void {
  const hasRequestedRef = useRef(false);

  useEffect(() => {
    if (!enabled || hasRequestedRef.current) return;
    hasRequestedRef.current = true;
    request();
  }, [enabled, request]);

  return useCallback(() => {
    hasRequestedRef.current = true;
    request();
  }, [request]);
}

export interface SettingsRequestLifecycle<TScope extends string> {
  isLoading: boolean;
  isSaving: boolean;
  error: string;
  savedScope: TScope | null;
  beginRequest: (channel: string) => number;
  isCurrentRequest: (channel: string, requestId: number) => boolean;
  isMounted: () => boolean;
  beginLoad: () => void;
  finishLoad: (error?: string) => void;
  beginSave: (scope: TScope) => void;
  finishSave: (scope: TScope, options?: { error?: string; saved?: boolean }) => void;
  clearFeedback: (scope?: TScope) => void;
  reportError: (error: string) => void;
}

/**
 * 收拢设置 controller 的存活状态、latest-wins 请求通道和通用反馈状态。
 * 结果如何投影到业务草稿，仍由具体 controller 决定。
 */
export function useSettingsRequestLifecycle<
  TScope extends string,
>(): SettingsRequestLifecycle<TScope> {
  const mountedRef = useRef(true);
  const requestVersionsRef = useRef<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedScope, setSavedScope] = useState<TScope | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const beginRequest = useCallback((channel: string) => {
    const requestId = (requestVersionsRef.current[channel] ?? 0) + 1;
    requestVersionsRef.current[channel] = requestId;
    return requestId;
  }, []);
  const isCurrentRequest = useCallback(
    (channel: string, requestId: number) =>
      mountedRef.current && requestId === requestVersionsRef.current[channel],
    [],
  );
  const isMounted = useCallback(() => mountedRef.current, []);

  const beginLoad = useCallback(() => {
    setIsLoading(true);
    setError('');
    setSavedScope(null);
  }, []);
  const finishLoad = useCallback((nextError = '') => {
    setIsLoading(false);
    setError(nextError);
    setSavedScope(null);
  }, []);
  const beginSave = useCallback((scope: TScope) => {
    setIsSaving(true);
    setError('');
    setSavedScope((current) => (current === scope ? null : current));
  }, []);
  const finishSave = useCallback(
    (scope: TScope, options: { error?: string; saved?: boolean } = {}) => {
      setIsSaving(false);
      setError(options.error ?? '');
      setSavedScope((current) => (options.saved ? scope : current === scope ? null : current));
    },
    [],
  );
  const clearFeedback = useCallback((scope?: TScope) => {
    setError('');
    setSavedScope((current) => (scope === undefined || current === scope ? null : current));
  }, []);
  const reportError = useCallback((nextError: string) => {
    setError(nextError);
  }, []);

  return {
    isLoading,
    isSaving,
    error,
    savedScope,
    beginRequest,
    isCurrentRequest,
    isMounted,
    beginLoad,
    finishLoad,
    beginSave,
    finishSave,
    clearFeedback,
    reportError,
  };
}
