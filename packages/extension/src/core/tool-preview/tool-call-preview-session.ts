// ============================================================
// Tool call preview session — 单次工具调用预览会话
// 负责：去重 request/progress、维护 request-scoped 资源生命周期。
// ============================================================

import type { ToolPreviewRequestSession } from './types.ts';

// ---------- Session ----------

export class ToolCallPreviewSession implements ToolPreviewRequestSession {
  private readonly resourcesByKey = new Map<string, Promise<unknown>>();
  requestKey: string | undefined;
  latestRequestKey: string | undefined;
  private progressKey: string | undefined;

  startRequest(key: string): boolean {
    if (this.requestKey === key) return false;
    this.requestKey = key;
    return true;
  }

  markLatestRequest(key: string): void {
    this.latestRequestKey = key;
  }

  startProgress(key: string): boolean {
    if (this.progressKey === key) return false;
    this.progressKey = key;
    return true;
  }

  ensureResource<T>(key: string, create: () => Promise<T>): Promise<T> {
    const existing = this.resourcesByKey.get(key);
    if (existing) return existing as Promise<T>;

    const promise = create();
    this.resourcesByKey.set(key, promise);
    return promise;
  }

  releaseResource(key: string): void {
    this.resourcesByKey.delete(key);
  }

  dispose(): void {
    this.requestKey = undefined;
    this.latestRequestKey = undefined;
    this.progressKey = undefined;
    this.resourcesByKey.clear();
  }
}
