// ============================================================
// Diff Worker package smoke — 验证生产 dist worker 可被 Node 启动
// 负责：不触发构建，仅在 package 预先生成 dist/diff-worker.js 时运行。
// ============================================================

import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

const workerPath = new URL('../../dist/diff-worker.js', import.meta.url);
const hasProductionBundle = existsSync(workerPath);

describe.skipIf(!hasProductionBundle)('production diff-worker bundle', () => {
  it('starts the bundled worker and returns a settled document', async () => {
    const worker = new Worker(workerPath);
    try {
      const response = await new Promise<{
        status: string;
        requestId: string;
        fileId: string;
        revision: number;
        document?: { additions: number };
      }>((resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.postMessage({
          requestId: 'bundle-request-1',
          ownerId: 'bundle-owner',
          turnId: 'bundle-turn',
          fileId: 'bundle-file',
          revision: 1,
          filePath: '/workspace/bundle.ts',
          originalContent: 'old\n',
          modifiedContent: 'new\n',
          maxBytes: 1024,
          contextLines: 3,
        });
      });

      expect(response).toMatchObject({
        requestId: 'bundle-request-1',
        fileId: 'bundle-file',
        revision: 1,
        status: 'settled',
      });
      expect(response.document?.additions).toBe(1);
    } finally {
      await worker.terminate();
    }
  });
});
