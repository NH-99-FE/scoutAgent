// ============================================================
// Diff Worker client — 单 Worker 串行调度与 revision 生命周期控制
// 负责：合并待处理 revision、丢弃 stale 响应、单次崩溃重建与安全销毁。
// ============================================================

import { createNodeDiffWorkerTransport } from './diff-worker-entry.ts';
import type { DiffWorkerRequest, DiffWorkerResponse } from './diff-worker-protocol.ts';

// ---------- Transport ----------

export interface DiffWorkerTransport {
  postMessage(request: DiffWorkerRequest): void;
  terminate(): Promise<number> | number | void;
  on(event: 'message', listener: (response: DiffWorkerResponse) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  off(event: 'message', listener: (response: DiffWorkerResponse) => void): this;
  off(event: 'error', listener: (error: Error) => void): this;
  off(event: 'exit', listener: (code: number) => void): this;
}

export type DiffWorkerFactory = (workerUrl: URL) => DiffWorkerTransport;
export type DiffWorkerResponseListener = (response: DiffWorkerResponse) => void;

export interface DiffWorkerClientPort {
  request(request: DiffWorkerRequest, listener: DiffWorkerResponseListener): void;
  dispose(): void;
}

export interface DiffWorkerClientOptions {
  workerFactory?: DiffWorkerFactory;
  workerUrl?: URL;
}

interface DiffWorkerTask {
  key: string;
  request: DiffWorkerRequest;
  listener: DiffWorkerResponseListener;
}

interface WorkerListeners {
  message: (response: DiffWorkerResponse) => void;
  error: (error: Error) => void;
  exit: (code: number) => void;
}

// ---------- Client ----------

export class DiffWorkerClient implements DiffWorkerClientPort {
  private readonly workerFactory: DiffWorkerFactory;
  private readonly workerUrl: URL;
  private readonly latestRevisionByKey = new Map<string, number>();
  private readonly pendingByKey = new Map<string, DiffWorkerTask>();
  private readonly pendingKeys: string[] = [];
  private worker: DiffWorkerTransport | undefined;
  private workerListeners: WorkerListeners | undefined;
  private activeTask: DiffWorkerTask | undefined;
  private restartAttempted = false;
  private unusable = false;
  private disposed = false;

  constructor(options: DiffWorkerClientOptions = {}) {
    this.workerFactory = options.workerFactory ?? createNodeDiffWorkerTransport;
    this.workerUrl = options.workerUrl ?? new URL('./diff-worker.js', import.meta.url);
  }

  request(request: DiffWorkerRequest, listener: DiffWorkerResponseListener): void {
    if (this.disposed) return;

    const key = createDiffWorkerTaskKey(request);
    const latestRevision = this.latestRevisionByKey.get(key);
    if (latestRevision !== undefined && request.revision < latestRevision) return;
    this.latestRevisionByKey.set(key, request.revision);

    const task = { key, request, listener };
    if (!this.activeTask) {
      this.startTask(task);
      return;
    }

    if (!this.pendingByKey.has(key)) {
      this.pendingKeys.push(key);
    }
    this.pendingByKey.set(key, task);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.activeTask = undefined;
    this.pendingByKey.clear();
    this.pendingKeys.length = 0;
    this.latestRevisionByKey.clear();
    this.releaseWorker();
  }

  private startTask(task: DiffWorkerTask): void {
    if (this.disposed) return;
    if (this.unusable) {
      this.publishTaskError(task, 'Diff Worker 已不可用');
      this.startNextTask();
      return;
    }

    this.activeTask = task;
    const worker = this.ensureWorker();
    if (!worker) return;

    try {
      worker.postMessage(task.request);
    } catch (cause) {
      const error = new Error(
        `Diff Worker 请求发送失败: ${task.request.filePath} (${task.request.requestId})`,
        { cause },
      );
      this.handleWorkerFailure(worker, error);
    }
  }

  private ensureWorker(): DiffWorkerTransport | undefined {
    if (this.worker) return this.worker;

    try {
      const worker = this.workerFactory(this.workerUrl);
      const listeners: WorkerListeners = {
        message: (response) => this.handleResponse(worker, response),
        error: (error) => this.handleWorkerFailure(worker, error),
        exit: (code) => {
          // 主动 terminate 前会先移除监听器，因此仍可观察到的任何退出
          // 都代表飞行任务无法完成，不能让它永久停留在 pending。
          this.handleWorkerFailure(worker, new Error(`Diff Worker 意外退出: exit code ${code}`));
        },
      };
      worker.on('message', listeners.message);
      worker.on('error', listeners.error);
      worker.on('exit', listeners.exit);
      this.worker = worker;
      this.workerListeners = listeners;
      return worker;
    } catch (cause) {
      const error = new Error(`Diff Worker 启动失败: ${this.workerUrl.href}`, { cause });
      this.handleWorkerStartupFailure(error);
      return undefined;
    }
  }

  private handleResponse(worker: DiffWorkerTransport, response: DiffWorkerResponse): void {
    if (this.disposed || worker !== this.worker) return;
    const task = this.activeTask;
    if (!task || response.requestId !== task.request.requestId) return;

    this.activeTask = undefined;
    if (
      response.fileId === task.request.fileId &&
      response.revision === task.request.revision &&
      this.isLatest(task)
    ) {
      task.listener(response);
    }
    this.startNextTask();
  }

  private handleWorkerFailure(worker: DiffWorkerTransport, cause: unknown): void {
    if (this.disposed || worker !== this.worker) return;
    const error = new Error('Diff Worker 运行失败', { cause });
    this.releaseWorker();

    const failedTask = this.activeTask;
    this.activeTask = undefined;
    if (failedTask) {
      this.publishTaskError(failedTask, `${error.message}: ${getErrorMessage(cause)}`);
    }

    if (this.restartAttempted) {
      this.unusable = true;
      this.failPendingTasks('Diff Worker 重建后再次失败');
      return;
    }

    this.restartAttempted = true;
    this.startNextTask();
  }

  private handleWorkerStartupFailure(error: Error): void {
    const failedTask = this.activeTask;
    this.activeTask = undefined;
    if (failedTask) {
      this.publishTaskError(failedTask, `${error.message}: ${getErrorMessage(error.cause)}`);
    }

    if (this.restartAttempted) {
      this.unusable = true;
      this.failPendingTasks('Diff Worker 无法启动');
      return;
    }

    this.restartAttempted = true;
    this.startNextTask();
  }

  private startNextTask(): void {
    if (this.disposed || this.activeTask) return;

    while (this.pendingKeys.length > 0) {
      const key = this.pendingKeys.shift();
      if (!key) continue;
      const task = this.pendingByKey.get(key);
      if (!task) continue;
      this.pendingByKey.delete(key);
      this.startTask(task);
      return;
    }
  }

  private failPendingTasks(message: string): void {
    const tasks = Array.from(this.pendingByKey.values());
    this.pendingByKey.clear();
    this.pendingKeys.length = 0;
    for (const task of tasks) {
      this.publishTaskError(task, message);
    }
  }

  private publishTaskError(task: DiffWorkerTask, message: string): void {
    if (this.disposed || !this.isLatest(task)) return;
    task.listener({
      requestId: task.request.requestId,
      fileId: task.request.fileId,
      revision: task.request.revision,
      status: 'error',
      reason: 'generation_failed',
      message: `${message}: ${task.request.filePath} (${task.request.turnId}/${task.request.fileId}, revision ${task.request.revision})`,
    });
  }

  private isLatest(task: DiffWorkerTask): boolean {
    return this.latestRevisionByKey.get(task.key) === task.request.revision;
  }

  private releaseWorker(): void {
    const worker = this.worker;
    const listeners = this.workerListeners;
    this.worker = undefined;
    this.workerListeners = undefined;
    if (!worker) return;

    if (listeners) {
      worker.off('message', listeners.message);
      worker.off('error', listeners.error);
      worker.off('exit', listeners.exit);
    }
    try {
      const termination = worker.terminate();
      if (termination instanceof Promise) {
        void termination.catch(() => undefined);
      }
    } catch {
      // Worker 已失败时 terminate 可能再次抛错；生命周期已在本地切断。
    }
  }
}

// ---------- Helpers ----------

export function createDiffWorkerTaskKey(
  request: Pick<DiffWorkerRequest, 'ownerId' | 'turnId' | 'fileId'>,
): string {
  return `${request.ownerId}::${request.turnId}::${request.fileId}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
