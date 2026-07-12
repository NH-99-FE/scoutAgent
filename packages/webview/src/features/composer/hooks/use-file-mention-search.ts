// ============================================================
// File Mention Search Hook — Composer 文件搜索请求与过期结果隔离
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import type { ScoutFileMentionItem } from '@scout-agent/shared';
import { protocolClient } from '@/bridge/protocol-client';

const FILE_MENTION_SEARCH_DEBOUNCE_MS = 120;
const FILE_MENTION_SEARCH_LIMIT = 50;
const EMPTY_ITEMS: ScoutFileMentionItem[] = [];

interface SettledFileMentionSearch {
  error?: string;
  items: ScoutFileMentionItem[];
  query: string | null;
}

export function useFileMentionSearch(query: string | null) {
  const [settled, setSettled] = useState<SettledFileMentionSearch>({
    items: EMPTY_ITEMS,
    query: null,
  });

  useEffect(() => {
    if (!query) return undefined;
    let active = true;
    let request: ReturnType<typeof protocolClient.requestFileMentions> | undefined;
    const timer = window.setTimeout(() => {
      request = protocolClient.requestFileMentions({
        limit: FILE_MENTION_SEARCH_LIMIT,
        onError: (message) => {
          if (active) setSettled({ error: message, items: EMPTY_ITEMS, query });
        },
        onResult: (result) => {
          if (!active || result.query !== query) return;
          setSettled({ error: result.error, items: result.items, query });
        },
        query,
      });
    }, FILE_MENTION_SEARCH_DEBOUNCE_MS);

    return () => {
      active = false;
      window.clearTimeout(timer);
      request?.cancel();
    };
  }, [query]);

  return useMemo(() => {
    if (!query) return { error: undefined, items: EMPTY_ITEMS, loading: false };
    if (settled.query !== query) {
      return { error: undefined, items: EMPTY_ITEMS, loading: true };
    }
    return { error: settled.error, items: settled.items, loading: false };
  }, [query, settled]);
}
