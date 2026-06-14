// ============================================================
// Task search — Webview task 标题查询匹配逻辑
// 负责：按任务列表展示标题在 host 层过滤 session 元数据。
// ============================================================

import type { JsonlSessionMetadata } from '../../core/session/index.ts';

// ---------- 常量 ----------

export const DEFAULT_TASK_SEARCH_LIMIT = 20;
export const MAX_TASK_SEARCH_LIMIT = 100;

// ---------- 查询规范化 ----------

export function normalizeTaskSearchLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_TASK_SEARCH_LIMIT;
  return Math.max(1, Math.min(Math.floor(limit), MAX_TASK_SEARCH_LIMIT));
}

export function normalizeTaskSearchOffset(offset: number | undefined): number {
  if (typeof offset !== 'number' || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.floor(offset));
}

// ---------- 匹配 ----------

export function getTaskSearchText(session: JsonlSessionMetadata): string {
  return normalizeTaskSearchText(session.name ?? session.firstMessage ?? session.id);
}

export function matchesTaskSearch(session: JsonlSessionMetadata, query: string): boolean {
  const queryParts = getTaskSearchCacheKey(query).split(' ').filter(Boolean);
  if (queryParts.length === 0) return true;
  const title = getTaskSearchText(session);
  return queryParts.every((part) => title.includes(part));
}

export function getTaskSearchCacheKey(query: string): string {
  return normalizeTaskSearchText(query);
}

function normalizeTaskSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
