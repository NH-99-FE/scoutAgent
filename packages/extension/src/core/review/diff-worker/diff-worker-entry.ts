// ============================================================
// Diff Worker entry — Node Worker transport 与线程消息适配
// 负责：创建生产 Worker，并在 Worker 线程内执行纯 runtime。
// ============================================================

import { parentPort, Worker } from 'node:worker_threads';
import type { DiffWorkerFactory } from './diff-worker-client.ts';
import type { DiffWorkerRequest } from './diff-worker-protocol.ts';
import { runDiffWorkerRequest } from './diff-worker-runtime.ts';

// ---------- 主线程 transport ----------

export const createNodeDiffWorkerTransport: DiffWorkerFactory = (workerUrl) =>
  new Worker(workerUrl);

// ---------- Worker 线程 ----------

const workerPort = parentPort;
if (workerPort) {
  workerPort.on('message', (request: DiffWorkerRequest) => {
    workerPort.postMessage(runDiffWorkerRequest(request));
  });
}
