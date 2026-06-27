// ============================================================
// Debounced Value Hook — 延迟提交高频输入值
// ============================================================

import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  const normalizedDelayMs = Math.max(0, delayMs);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedValue(value);
    }, normalizedDelayMs);

    return () => window.clearTimeout(timer);
  }, [normalizedDelayMs, value]);

  return debouncedValue;
}
