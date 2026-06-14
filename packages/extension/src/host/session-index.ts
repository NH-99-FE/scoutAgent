// ============================================================
// SessionIndex — 宿主层 session 元数据缓存
// 负责：缓存任务列表/会话列表查询结果，避免搜索分页重复扫描 JSONL。
// ============================================================

import type { JsonlSessionMetadata } from '../core/session/index.ts';

// ---------- 类型 ----------

export type SessionIndexScope = 'workspace' | 'all';

export interface SessionIndexLoaders {
  listWorkspace: () => Promise<JsonlSessionMetadata[]>;
  listAll: () => Promise<JsonlSessionMetadata[]>;
}

interface SessionIndexCacheEntry {
  sessions: JsonlSessionMetadata[];
  filtered: Map<string, JsonlSessionMetadata[]>;
}

// ---------- SessionIndex ----------

export class SessionIndex {
  private readonly loaders: SessionIndexLoaders;
  private readonly cache = new Map<SessionIndexScope, SessionIndexCacheEntry>();
  private readonly inFlight = new Map<SessionIndexScope, Promise<SessionIndexCacheEntry>>();
  private readonly revisions = new Map<SessionIndexScope, number>();

  constructor(loaders: SessionIndexLoaders) {
    this.loaders = loaders;
  }

  async list(scope: SessionIndexScope): Promise<JsonlSessionMetadata[]> {
    return (await this.getEntry(scope)).sessions;
  }

  async filter(
    scope: SessionIndexScope,
    cacheKey: string,
    predicate: (session: JsonlSessionMetadata) => boolean,
  ): Promise<JsonlSessionMetadata[]> {
    const entry = await this.getEntry(scope);
    const cached = entry.filtered.get(cacheKey);
    if (cached) return cached;

    const filtered = entry.sessions.filter(predicate);
    entry.filtered.set(cacheKey, filtered);
    return filtered;
  }

  invalidate(scope?: SessionIndexScope): void {
    if (scope) {
      this.bumpRevision(scope);
      this.cache.delete(scope);
      this.inFlight.delete(scope);
      return;
    }
    this.bumpRevision('workspace');
    this.bumpRevision('all');
    this.cache.clear();
    this.inFlight.clear();
  }

  private async getEntry(scope: SessionIndexScope): Promise<SessionIndexCacheEntry> {
    const cached = this.cache.get(scope);
    if (cached) return cached;

    const running = this.inFlight.get(scope);
    if (running) return running;

    const revision = this.getRevision(scope);
    const load = this.load(scope)
      .then((sessions) => {
        const entry = { sessions, filtered: new Map<string, JsonlSessionMetadata[]>() };
        if (this.getRevision(scope) === revision) {
          this.cache.set(scope, entry);
        }
        return entry;
      })
      .finally(() => {
        if (this.inFlight.get(scope) === load) {
          this.inFlight.delete(scope);
        }
      });
    this.inFlight.set(scope, load);
    return load;
  }

  private async load(scope: SessionIndexScope): Promise<JsonlSessionMetadata[]> {
    return scope === 'all' ? await this.loaders.listAll() : await this.loaders.listWorkspace();
  }

  private getRevision(scope: SessionIndexScope): number {
    return this.revisions.get(scope) ?? 0;
  }

  private bumpRevision(scope: SessionIndexScope): void {
    this.revisions.set(scope, this.getRevision(scope) + 1);
  }
}
