// ============================================================
// SessionOperationScope — 单个 AgentSession 拥有的可取消操作集合
// 负责：同类操作防重入、外部取消信号链接、会话销毁时统一取消。
// ============================================================

export interface SessionOperationHandle {
  readonly signal: AbortSignal;
  finish(): void;
}

export class SessionOperationScope<TKind extends string> {
  private readonly active = new Map<TKind, AbortController>();
  private disposed = false;

  startExclusive(kind: TKind, parentSignal?: AbortSignal): SessionOperationHandle | undefined {
    if (this.disposed || this.active.has(kind)) return undefined;

    const controller = new AbortController();
    this.active.set(kind, controller);
    const abortFromParent = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) {
      abortFromParent();
    } else {
      parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    }

    let finished = false;
    return {
      signal: controller.signal,
      finish: () => {
        if (finished) return;
        finished = true;
        parentSignal?.removeEventListener('abort', abortFromParent);
        if (this.active.get(kind) === controller) {
          this.active.delete(kind);
        }
      },
    };
  }

  has(kind: TKind): boolean {
    return this.active.has(kind);
  }

  cancel(kind: TKind): void {
    this.active.get(kind)?.abort();
  }

  cancelAll(): void {
    for (const controller of this.active.values()) {
      controller.abort();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAll();
    this.active.clear();
  }
}
