// ============================================================
// Diff Worker 测试 — 覆盖纯 runtime 与 fake transport 生命周期
// 负责：验证预算投影、revision 丢弃、重建上限与 dispose 隔离。
// ============================================================

import { describe, expect, it } from 'vitest';
import {
  DiffWorkerClient,
  type DiffWorkerResponseListener,
  type DiffWorkerTransport,
} from '../../src/core/review/diff-worker/diff-worker-client.ts';
import type {
  DiffWorkerRequest,
  DiffWorkerResponse,
} from '../../src/core/review/diff-worker/diff-worker-protocol.ts';
import { runDiffWorkerRequest } from '../../src/core/review/diff-worker/diff-worker-runtime.ts';

class FakeDiffWorker implements DiffWorkerTransport {
  readonly posted: DiffWorkerRequest[] = [];
  terminated = false;
  private readonly messageListeners = new Set<(response: DiffWorkerResponse) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly exitListeners = new Set<(code: number) => void>();

  postMessage(request: DiffWorkerRequest): void {
    if (this.terminated) throw new Error('fake worker terminated');
    this.posted.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  on(
    event: 'message' | 'error' | 'exit',
    listener: DiffWorkerResponseListener | ((error: Error) => void) | ((code: number) => void),
  ): this {
    if (event === 'message')
      this.messageListeners.add(listener as (response: DiffWorkerResponse) => void);
    if (event === 'error') this.errorListeners.add(listener as (error: Error) => void);
    if (event === 'exit') this.exitListeners.add(listener as (code: number) => void);
    return this;
  }

  off(
    event: 'message' | 'error' | 'exit',
    listener: DiffWorkerResponseListener | ((error: Error) => void) | ((code: number) => void),
  ): this {
    if (event === 'message')
      this.messageListeners.delete(listener as (response: DiffWorkerResponse) => void);
    if (event === 'error') this.errorListeners.delete(listener as (error: Error) => void);
    if (event === 'exit') this.exitListeners.delete(listener as (code: number) => void);
    return this;
  }

  emitMessage(response: DiffWorkerResponse): void {
    for (const listener of this.messageListeners) listener(response);
  }

  emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error);
  }

  emitExit(code: number): void {
    for (const listener of this.exitListeners) listener(code);
  }
}

function makeRequest(overrides: Partial<DiffWorkerRequest> = {}): DiffWorkerRequest {
  return {
    requestId: 'request-1',
    ownerId: 'owner-1',
    turnId: 'turn-1',
    fileId: 'file-1',
    revision: 1,
    filePath: '/workspace/app.ts',
    originalContent: 'old\n',
    modifiedContent: 'new\n',
    maxBytes: 1024,
    contextLines: 3,
    ...overrides,
  };
}

function settledResponse(request: DiffWorkerRequest): DiffWorkerResponse {
  const response = runDiffWorkerRequest(request);
  if (response.status !== 'settled') {
    throw new Error(`expected settled response, got ${response.status}`);
  }
  return {
    requestId: request.requestId,
    fileId: request.fileId,
    revision: request.revision,
    status: 'settled',
    document: response.document,
  };
}

describe('runDiffWorkerRequest', () => {
  it('returns a canonical document without thread dependencies', () => {
    const response = runDiffWorkerRequest(makeRequest());

    expect(response).toMatchObject({
      requestId: 'request-1',
      fileId: 'file-1',
      revision: 1,
      status: 'settled',
    });
    expect(response.status === 'settled' ? response.document.additions : 0).toBe(1);
  });

  it('returns a canonical unavailable document when the request budget is exceeded', () => {
    const response = runDiffWorkerRequest(
      makeRequest({ originalContent: '0123456789', maxBytes: 3 }),
    );

    expect(response).toMatchObject({
      status: 'settled',
      document: {
        additions: 0,
        deletions: 0,
        hunks: [],
        unavailableReason: 'content_too_large',
      },
    });
  });

  it('converts generation failures to canonical terminal documents', () => {
    const response = runDiffWorkerRequest(makeRequest({ contextLines: -1 }));

    expect(response).toMatchObject({
      status: 'settled',
      fileId: 'file-1',
      revision: 1,
      document: {
        additions: 0,
        deletions: 0,
        hunks: [],
        unavailableReason: 'generation_failed',
      },
    });
  });
});

describe('DiffWorkerClient', () => {
  it('keeps only the latest queued revision and drops the stale response', () => {
    const worker = new FakeDiffWorker();
    const client = new DiffWorkerClient({ workerFactory: () => worker });
    const responses: DiffWorkerResponse[] = [];
    const first = makeRequest({ requestId: 'request-1', revision: 1 });
    const second = makeRequest({ requestId: 'request-2', revision: 2, modifiedContent: 'final\n' });

    client.request(first, (response) => responses.push(response));
    client.request(second, (response) => responses.push(response));
    expect(worker.posted.map((request) => request.revision)).toEqual([1]);

    worker.emitMessage(settledResponse(first));
    expect(worker.posted.map((request) => request.revision)).toEqual([1, 2]);
    expect(responses).toHaveLength(0);

    worker.emitMessage(settledResponse(second));
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ requestId: 'request-2', revision: 2 });
    client.dispose();
  });

  it('coalesces a pending key while another key is in flight', () => {
    const worker = new FakeDiffWorker();
    const client = new DiffWorkerClient({ workerFactory: () => worker });
    const first = makeRequest({ requestId: 'a-1', fileId: 'file-a' });
    const pendingFirst = makeRequest({ requestId: 'b-1', fileId: 'file-b' });
    const pendingLatest = makeRequest({
      requestId: 'b-2',
      fileId: 'file-b',
      revision: 2,
      modifiedContent: 'latest\n',
    });

    client.request(first, () => undefined);
    client.request(pendingFirst, () => undefined);
    client.request(pendingLatest, () => undefined);
    worker.emitMessage(settledResponse(first));

    expect(worker.posted.map((request) => `${request.fileId}:${request.revision}`)).toEqual([
      'file-a:1',
      'file-b:2',
    ]);
    client.dispose();
  });

  it('fails the flight, rebuilds once, and never restarts indefinitely', () => {
    const workers = [new FakeDiffWorker(), new FakeDiffWorker()];
    let factoryCalls = 0;
    const client = new DiffWorkerClient({
      workerFactory: () => {
        const worker = workers[factoryCalls];
        factoryCalls += 1;
        if (!worker) throw new Error('unexpected third worker');
        return worker;
      },
    });
    const responses: DiffWorkerResponse[] = [];
    const first = makeRequest({ requestId: 'request-1' });
    const second = makeRequest({ requestId: 'request-2', fileId: 'file-2' });

    client.request(first, (response) => responses.push(response));
    client.request(second, (response) => responses.push(response));
    workers[0].emitError(new Error('worker crashed'));
    expect(factoryCalls).toBe(2);
    expect(workers[1].posted).toHaveLength(1);
    expect(responses[0]?.status).toBe('error');

    workers[1].emitExit(0);
    expect(responses).toHaveLength(2);
    expect(responses[1]?.status).toBe('error');

    client.request(makeRequest({ requestId: 'request-3', fileId: 'file-3' }), (response) =>
      responses.push(response),
    );
    expect(factoryCalls).toBe(2);
    expect(responses).toHaveLength(3);
    expect(responses[2]?.status).toBe('error');
    client.dispose();
  });

  it('fails startup twice and then marks future requests unavailable', () => {
    let factoryCalls = 0;
    const client = new DiffWorkerClient({
      workerFactory: () => {
        factoryCalls += 1;
        throw new Error(`startup-${factoryCalls}`);
      },
    });
    const responses: DiffWorkerResponse[] = [];

    client.request(makeRequest({ requestId: 'request-1' }), (response) => responses.push(response));
    client.request(makeRequest({ requestId: 'request-2' }), (response) => responses.push(response));
    client.request(makeRequest({ requestId: 'request-3' }), (response) => responses.push(response));

    expect(factoryCalls).toBe(2);
    expect(responses).toHaveLength(3);
    expect(responses.every((response) => response.status === 'error')).toBe(true);
    client.dispose();
  });

  it('does not publish after dispose', () => {
    const worker = new FakeDiffWorker();
    const client = new DiffWorkerClient({ workerFactory: () => worker });
    const responses: DiffWorkerResponse[] = [];
    const request = makeRequest();

    client.request(request, (response) => responses.push(response));
    client.dispose();
    worker.emitMessage(settledResponse(request));

    expect(worker.terminated).toBe(true);
    expect(responses).toHaveLength(0);
  });
});
