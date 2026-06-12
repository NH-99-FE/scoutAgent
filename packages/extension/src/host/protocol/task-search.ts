// ============================================================
// Task search — Webview task 查询匹配逻辑
// 负责：按 Pi session selector 语义在 host 层过滤 session 元数据。
// ============================================================

import type { JsonlSessionMetadata } from '../../core/session/index.ts';

export function getTaskSearchText(session: JsonlSessionMetadata): string {
  return [session.id, session.name, session.allMessagesText, session.cwd, session.path]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
}

export function matchesTaskSearch(session: JsonlSessionMetadata, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return getTaskSearchText(session).includes(normalizedQuery);
}
