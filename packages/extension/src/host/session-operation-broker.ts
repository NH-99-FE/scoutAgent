// ============================================================
// SessionOperationBroker — 宿主层会话用户意图调度器
// 负责：串行化 session replacement，并对 Webview 用户意图应用 latest-wins。
// ============================================================

// ---------- 类型 ----------

export type SessionUserOperationKind = 'new_session_message' | 'open_task' | 'restore_session';

export interface SessionOperationToken {
  readonly id: string;
  readonly kind: SessionUserOperationKind;
  isLatest(): boolean;
}

export type SessionOperationResult<T> =
  | { status: 'completed'; id: string; kind: SessionUserOperationKind; value: T }
  | { status: 'stale'; id: string; kind: SessionUserOperationKind }
  | { status: 'failed'; id: string; kind: SessionUserOperationKind; error: string };

// ---------- 辅助 ----------

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------- SessionOperationBroker ----------

export class SessionOperationBroker {
  private queue: Promise<void> = Promise.resolve();
  private latestUserOperation?: { id: string; kind: SessionUserOperationKind };

  beginUserOperation(kind: SessionUserOperationKind, id: string): SessionOperationToken {
    this.latestUserOperation = { id, kind };
    return {
      id,
      kind,
      isLatest: () => this.isLatestUserOperation(id, kind),
    };
  }

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let releaseCurrent: () => void = () => undefined;
    this.queue = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      releaseCurrent();
    }
  }

  async runUserOperation<T>(
    token: SessionOperationToken,
    operation: (token: SessionOperationToken) => Promise<T>,
  ): Promise<SessionOperationResult<T>> {
    return await this.runExclusive(async () => {
      if (!token.isLatest()) {
        return { status: 'stale', id: token.id, kind: token.kind };
      }

      try {
        const value = await operation(token);
        if (!token.isLatest()) {
          return { status: 'stale', id: token.id, kind: token.kind };
        }
        return { status: 'completed', id: token.id, kind: token.kind, value };
      } catch (error) {
        if (!token.isLatest()) {
          return { status: 'stale', id: token.id, kind: token.kind };
        }
        return {
          status: 'failed',
          id: token.id,
          kind: token.kind,
          error: toErrorMessage(error),
        };
      }
    });
  }

  private isLatestUserOperation(id: string, kind: SessionUserOperationKind): boolean {
    return this.latestUserOperation?.id === id && this.latestUserOperation.kind === kind;
  }
}
