import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  ScoutExtensionAPI,
  ScoutHandlerFn,
  ToolResultEvent,
} from '../../src/core/extensions/types.ts';
import {
  REVIEW_ARTIFACT_CUSTOM_TYPE,
  FileReviewExtensionController,
  MutationJournal,
  runDiffWorkerRequest,
  type DiffWorkerClientPort,
  type DiffWorkerRequest,
  type DiffWorkerResponseListener,
  loadReviewArtifact,
  type ReviewArtifactManifest,
  type ReviewArtifactRef,
} from '../../src/core/review/index.ts';

interface ExtensionHarness {
  handlers: Map<string, ScoutHandlerFn[]>;
  appendEntry: ReturnType<typeof vi.fn>;
}

class ControlledDiffWorkerClient implements DiffWorkerClientPort {
  readonly pending: Array<{
    request: DiffWorkerRequest;
    listener: DiffWorkerResponseListener;
  }> = [];

  request(request: DiffWorkerRequest, listener: DiffWorkerResponseListener): void {
    this.pending.push({ request, listener });
  }

  settle(index: number): void {
    const pending = this.pending[index];
    if (!pending) throw new Error(`Missing worker request ${index}`);
    pending.listener(runDiffWorkerRequest(pending.request));
  }

  dispose(): void {}
}

async function createHarness(
  controller: FileReviewExtensionController,
  appendEntry = vi.fn(async () => undefined),
): Promise<ExtensionHarness> {
  const handlers = new Map<string, ScoutHandlerFn[]>();
  const api = {
    on: (event: string, handler: ScoutHandlerFn) => {
      const registered = handlers.get(event) ?? [];
      registered.push(handler);
      handlers.set(event, registered);
    },
    appendEntry,
  } as unknown as ScoutExtensionAPI;
  await controller.createFactory()(api);
  return { handlers, appendEntry };
}

async function emit(harness: ExtensionHarness, event: string, payload: unknown): Promise<unknown> {
  let result: unknown;
  for (const handler of harness.handlers.get(event) ?? []) {
    result = (await handler(payload, undefined)) ?? result;
  }
  return result;
}

async function captureMutation(
  controller: FileReviewExtensionController,
  toolCallId: string,
  filePath: string,
  before: string,
  after: string,
): Promise<void> {
  await controller.mutationCapture.run(
    {
      ownerId: controller.ownerId,
      toolCallId,
      operation: 'edit',
      path: filePath,
      absolutePath: resolve(filePath),
      displayPath: filePath,
    },
    async () => {
      controller.mutationCapture.captureBefore(Buffer.from(before));
      controller.mutationCapture.captureAfter(after);
      controller.mutationCapture.markWriteCommitted();
    },
  );
}

function makeToolResult(toolCallId: string): ToolResultEvent {
  return {
    type: 'tool_result',
    toolCallId,
    toolName: 'edit',
    input: { path: 'file.ts' },
    content: [{ type: 'text', text: 'edited' }],
    details: undefined,
    isError: false,
  };
}

describe('FileReviewExtensionController', () => {
  it('decorates tool_result and appends one complete artifact at agent_end', async () => {
    const worker = new ControlledDiffWorkerClient();
    const updates: string[] = [];
    const controller = new FileReviewExtensionController({
      sessionId: 'session-1',
      journal: new MutationJournal({ diffWorkerClient: worker }),
      onUpdated: (review) => updates.push(review.files[0]?.projectionStatus ?? 'missing'),
    });
    const harness = await createHarness(controller);

    await emit(harness, 'agent_start', { type: 'agent_start' });
    await captureMutation(controller, 'tool-1', 'src/app.ts', 'old\n', 'new\n');
    const decorated = await emit(harness, 'tool_result', makeToolResult('tool-1'));
    expect(decorated).toMatchObject({
      details: {
        kind: 'file_change',
        review: { status: 'pending', recordId: 'mutation-1' },
      },
    });
    expect(updates).toEqual(['pending']);

    const end = emit(harness, 'agent_end', { type: 'agent_end', messages: [] });
    worker.settle(0);
    await end;

    expect(updates).toEqual(['pending', 'ready']);
    expect(harness.appendEntry).toHaveBeenCalledTimes(1);
    expect(harness.appendEntry).toHaveBeenCalledWith(
      REVIEW_ARTIFACT_CUSTOM_TYPE,
      expect.objectContaining({
        complete: true,
        turnId: expect.stringContaining('session-1:run-'),
        manifestHash: expect.any(String),
        summary: expect.objectContaining({ fileCount: 1 }),
      }),
    );
    const artifact = await loadAppendedManifest(controller, harness);
    expect(artifact.records).toEqual([expect.objectContaining({ toolCallId: 'tool-1' })]);
    expect(controller.getJournal().getAggregates()).toHaveLength(0);
    controller.dispose();
  });

  it('finalizes only the run captured by agent_end when a later run starts during settlement', async () => {
    const worker = new ControlledDiffWorkerClient();
    const controller = new FileReviewExtensionController({
      sessionId: 'session-race',
      journal: new MutationJournal({ diffWorkerClient: worker }),
    });
    const harness = await createHarness(controller);

    await emit(harness, 'agent_start', { type: 'agent_start' });
    await captureMutation(controller, 'first-tool', 'first.ts', 'a', 'b');
    const firstEnd = emit(harness, 'agent_end', { type: 'agent_end', messages: [] });

    await emit(harness, 'agent_start', { type: 'agent_start' });
    await captureMutation(controller, 'second-tool', 'second.ts', 'c', 'd');
    worker.settle(0);
    await firstEnd;

    const firstArtifact = await loadAppendedManifest(controller, harness, 0);
    expect(firstArtifact.records.map((record) => record.toolCallId)).toEqual(['first-tool']);

    const secondEnd = emit(harness, 'agent_end', { type: 'agent_end', messages: [] });
    worker.settle(1);
    await secondEnd;
    const secondArtifact = await loadAppendedManifest(controller, harness, 1);
    expect(secondArtifact.records.map((record) => record.toolCallId)).toEqual(['second-tool']);
    expect(secondArtifact.turnId).not.toBe(firstArtifact.turnId);
    controller.dispose();
  });

  it('waits for all files and persists exactly one artifact for the run', async () => {
    const worker = new ControlledDiffWorkerClient();
    const controller = new FileReviewExtensionController({
      sessionId: 'session-multi',
      journal: new MutationJournal({ diffWorkerClient: worker }),
    });
    const harness = await createHarness(controller);

    await emit(harness, 'agent_start', { type: 'agent_start' });
    await captureMutation(controller, 'tool-a', 'a.ts', 'a', 'aa');
    await captureMutation(controller, 'tool-b', 'b.ts', 'b', 'bb');
    const end = emit(harness, 'agent_end', { type: 'agent_end', messages: [] });

    worker.settle(0);
    await Promise.resolve();
    expect(harness.appendEntry).not.toHaveBeenCalled();
    worker.settle(1);
    await end;

    expect(harness.appendEntry).toHaveBeenCalledTimes(1);
    const artifact = await loadAppendedManifest(controller, harness);
    expect(artifact.files).toHaveLength(2);
    expect(artifact.records.map((record) => record.toolCallId).sort()).toEqual([
      'tool-a',
      'tool-b',
    ]);
    controller.dispose();
  });

  it('persists generation_failed on timeout and ignores the late worker response', async () => {
    const worker = new ControlledDiffWorkerClient();
    const controller = new FileReviewExtensionController({
      sessionId: 'session-timeout',
      journal: new MutationJournal({ diffWorkerClient: worker }),
      finalizeTimeoutMs: 0,
    });
    const harness = await createHarness(controller);

    await emit(harness, 'agent_start', { type: 'agent_start' });
    await captureMutation(controller, 'tool-timeout', 'timeout.ts', 'old', 'new');
    await emit(harness, 'agent_end', { type: 'agent_end', messages: [] });

    const artifact = await loadAppendedManifest(controller, harness);
    expect(artifact.files[0]?.unavailableReason).toBeUndefined();
    worker.settle(0);
    expect(controller.getJournal().getAggregates()).toHaveLength(0);
    expect(harness.appendEntry).toHaveBeenCalledTimes(1);
    expect(artifact.files[0]?.unavailableReason).toBeUndefined();
    controller.dispose();
  });

  it('retains snapshots after append failure and retries pending artifacts on shutdown', async () => {
    const worker: DiffWorkerClientPort = {
      request: (request, listener) => listener(runDiffWorkerRequest(request)),
      dispose: () => undefined,
    };
    const appendEntry = vi
      .fn()
      .mockRejectedValueOnce(new Error('append failed'))
      .mockResolvedValue(undefined);
    const controller = new FileReviewExtensionController({
      sessionId: 'session-retry',
      journal: new MutationJournal({ diffWorkerClient: worker }),
    });
    const harness = await createHarness(controller, appendEntry);

    await emit(harness, 'agent_start', { type: 'agent_start' });
    await captureMutation(controller, 'tool-retry', 'retry.ts', 'old', 'new');
    await expect(emit(harness, 'agent_end', { type: 'agent_end', messages: [] })).rejects.toThrow(
      'append failed',
    );
    expect(controller.getJournal().getAggregates()[0]?.baseline.content).toBe('old');

    await emit(harness, 'session_shutdown', { type: 'session_shutdown', reason: 'quit' });
    expect(appendEntry).toHaveBeenCalledTimes(2);
    expect(controller.getJournal().getAggregates()).toHaveLength(0);
    controller.dispose();
  });

  it('stores only a lightweight ref in JSONL and full snapshots in the external manifest', async () => {
    const worker: DiffWorkerClientPort = {
      request: (request, listener) => listener(runDiffWorkerRequest(request)),
      dispose: () => undefined,
    };
    const controller = new FileReviewExtensionController({
      sessionId: 'session-degraded',
      journal: new MutationJournal({ diffWorkerClient: worker }),
    });
    const harness = await createHarness(controller);

    await emit(harness, 'agent_start', { type: 'agent_start' });
    await captureMutation(controller, 'tool-large', 'large.ts', 'old-1\nold-2\n', 'new-1\nnew-2\n');
    await emit(harness, 'agent_end', { type: 'agent_end', messages: [] });

    const ref = harness.appendEntry.mock.calls[0]?.[1] as ReviewArtifactRef;
    expect(ref).not.toHaveProperty('files');
    expect(ref).not.toHaveProperty('records');
    const artifact = await loadAppendedManifest(controller, harness);
    expect(artifact.files[0]).toMatchObject({ latestRevision: 1 });
    expect(artifact.records[0]).toMatchObject({ toolCallId: 'tool-large' });
    expect(controller.getJournal().getAggregates()).toHaveLength(0);
    controller.dispose();
  });

  it('retries pending artifacts through the explicit flush boundary', async () => {
    const worker: DiffWorkerClientPort = {
      request: (request, listener) => listener(runDiffWorkerRequest(request)),
      dispose: () => undefined,
    };
    const appendEntry = vi
      .fn()
      .mockRejectedValueOnce(new Error('append failed'))
      .mockResolvedValue(undefined);
    const controller = new FileReviewExtensionController({
      sessionId: 'session-flush',
      journal: new MutationJournal({ diffWorkerClient: worker }),
    });
    const harness = await createHarness(controller, appendEntry);

    await emit(harness, 'agent_start', { type: 'agent_start' });
    await captureMutation(controller, 'tool-flush', 'flush.ts', 'old', 'new');
    await expect(emit(harness, 'agent_end', { type: 'agent_end', messages: [] })).rejects.toThrow(
      'append failed',
    );

    await controller.flushPendingArtifacts();

    expect(appendEntry).toHaveBeenCalledTimes(2);
    expect(controller.getJournal().getAggregates()).toHaveLength(0);
    controller.dispose();
  });
});

async function loadAppendedManifest(
  controller: FileReviewExtensionController,
  harness: ExtensionHarness,
  index = 0,
): Promise<ReviewArtifactManifest> {
  const ref = harness.appendEntry.mock.calls[index]?.[1] as ReviewArtifactRef;
  return loadReviewArtifact(controller.getArtifactStore(), ref);
}
