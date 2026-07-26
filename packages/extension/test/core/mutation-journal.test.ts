import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  MutationJournal,
  captureTextSnapshot,
  normalizeMutationAbsolutePath,
  type AppendMutationInput,
  type DiffDocument,
} from '../../src/core/review/index.ts';

function makeMutation(overrides: Partial<AppendMutationInput> = {}): AppendMutationInput {
  return {
    ownerId: 'owner-1',
    turnId: 'turn-1',
    toolCallId: 'tool-1',
    operation: 'edit',
    path: 'file.txt',
    absolutePath: resolve('file.txt'),
    displayPath: 'file.txt',
    before: captureTextSnapshot(Buffer.from('before')),
    after: captureTextSnapshot(Buffer.from('after')),
    toolOutcome: 'success',
    ...overrides,
  };
}

function makeDocument(): DiffDocument {
  return {
    version: 1,
    beforeLineCount: 1,
    afterLineCount: 1,
    additions: 1,
    deletions: 1,
    firstChangedLine: 1,
    hunks: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [
          { type: 'removed', text: 'before' },
          { type: 'added', text: 'after' },
        ],
      },
    ],
  };
}

describe('MutationJournal', () => {
  it('creates one pending aggregate and maps its record to the current aggregate', () => {
    const journal = new MutationJournal();
    const { record, aggregate } = journal.append(makeMutation());

    expect(record.sequence).toBe(1);
    expect(aggregate.recordIds).toEqual([record.recordId]);
    expect(aggregate.firstRecordId).toBe(record.recordId);
    expect(aggregate.latestRecordId).toBe(record.recordId);
    expect(aggregate.baseline.content).toBe('before');
    expect(aggregate.latest.content).toBe('after');
    expect(aggregate.revision).toBe(1);
    expect(aggregate.projection).toEqual({ status: 'pending', revision: 1 });
    expect(journal.getAggregateByRecordId(record.recordId)).toBe(aggregate);
  });

  it('keeps the first baseline and final after for same-turn normalized paths', () => {
    const journal = new MutationJournal();
    const first = journal.append(makeMutation());
    const second = journal.append(
      makeMutation({
        toolCallId: 'tool-2',
        path: './nested/../file.txt',
        absolutePath: resolve('nested', '..', 'file.txt'),
        before: captureTextSnapshot(Buffer.from('after')),
        after: captureTextSnapshot(Buffer.from('final')),
      }),
    );

    expect(second.aggregate).toBe(first.aggregate);
    expect(second.aggregate.baseline.content).toBe('before');
    expect(second.aggregate.latest.content).toBe('final');
    expect(second.aggregate.recordIds).toEqual([first.record.recordId, second.record.recordId]);
    expect(second.aggregate.latestRecordId).toBe(second.record.recordId);
    expect(second.aggregate.revision).toBe(2);
    expect(journal.getAggregateByRecordId(first.record.recordId)).toBe(second.aggregate);
    expect(journal.getAggregateByRecordId(second.record.recordId)).toBe(second.aggregate);
  });

  it('isolates different turns, owners, and absolute paths', () => {
    const journal = new MutationJournal();
    const first = journal.append(makeMutation());
    const otherTurn = journal.append(makeMutation({ turnId: 'turn-2', toolCallId: 'tool-2' }));
    const otherOwner = journal.append(makeMutation({ ownerId: 'owner-2', toolCallId: 'tool-3' }));
    const otherPath = journal.append(
      makeMutation({
        toolCallId: 'tool-4',
        path: 'other.txt',
        absolutePath: resolve('other.txt'),
      }),
    );

    expect(
      new Set([
        first.aggregate.fileId,
        otherTurn.aggregate.fileId,
        otherOwner.aggregate.fileId,
        otherPath.aggregate.fileId,
      ]).size,
    ).toBe(4);
    expect(journal.getTurnAggregates('turn-1', 'owner-1')).toHaveLength(2);
  });

  it('normalizes syntactic path aliases using the platform path rules', () => {
    expect(normalizeMutationAbsolutePath(resolve('dir', '..', 'file.txt'))).toBe(
      normalizeMutationAbsolutePath(resolve('file.txt')),
    );
  });

  it('increments record sequence and aggregate revision monotonically', () => {
    const journal = new MutationJournal();
    const revisions: number[] = [];
    journal.onUpdated((update) => revisions.push(update.revision));
    const results = [
      journal.append(makeMutation()),
      journal.append(makeMutation({ toolCallId: 'tool-2' })),
      journal.append(makeMutation({ toolCallId: 'tool-3' })),
    ];

    expect(results.map((result) => result.record.sequence)).toEqual([1, 2, 3]);
    expect(revisions).toEqual([1, 2, 3]);
    expect(results[2].aggregate.revision).toBe(3);
    expect(results[2].aggregate.projection).toEqual({ status: 'pending', revision: 3 });
  });

  it('rejects stale projection revisions and keeps the current revision', () => {
    const journal = new MutationJournal();
    const first = journal.append(makeMutation());
    const second = journal.append(makeMutation({ toolCallId: 'tool-2' }));

    expect(journal.setProjectionSettled(first.aggregate.fileId, 1, makeDocument())).toBe(false);
    expect(journal.setProjectionSettled(second.aggregate.fileId, 2, makeDocument())).toBe(true);
    expect(second.aggregate.projection.status).toBe('settled');
  });

  it('releases snapshot strings while retaining ready DiffDocument', () => {
    const journal = new MutationJournal();
    const { record, aggregate } = journal.append(makeMutation());
    const document = makeDocument();
    journal.setProjectionSettled(aggregate.fileId, aggregate.revision, document);

    expect(journal.releaseTurnSnapshots('turn-1')).toBe(true);
    expect(aggregate.baseline).toMatchObject({
      content: null,
      unavailableReason: 'content_released',
    });
    expect(aggregate.latest).toMatchObject({
      content: null,
      unavailableReason: 'content_released',
    });
    expect(record.before.content).toBeNull();
    expect(record.after.content).toBeNull();
    expect(aggregate.projection).toEqual({ status: 'settled', revision: 1, document });
  });

  it('does not publish or accept projection results after dispose', () => {
    const journal = new MutationJournal();
    const listener = vi.fn();
    const unsubscribe = journal.onUpdated(listener);
    const { aggregate } = journal.append(makeMutation());
    listener.mockClear();

    journal.dispose();
    expect(listener).not.toHaveBeenCalled();
    expect(journal.setProjectionSettled(aggregate.fileId, aggregate.revision, makeDocument())).toBe(
      false,
    );
    expect(listener).not.toHaveBeenCalled();
    expect(() => journal.append(makeMutation({ toolCallId: 'after-dispose' }))).toThrow(
      /MutationJournal 已销毁/,
    );
    unsubscribe();
  });
});

// ---------- Worker 投影接线 ----------

class FakeDiffWorkerClient {
  readonly posted: import('../../src/core/review/diff-worker/diff-worker-protocol.ts').DiffWorkerRequest[] =
    [];
  disposed = false;
  private listener:
    | ((
        response: import('../../src/core/review/diff-worker/diff-worker-protocol.ts').DiffWorkerResponse,
      ) => void)
    | undefined;

  request(
    request: import('../../src/core/review/diff-worker/diff-worker-protocol.ts').DiffWorkerRequest,
    listener: (
      response: import('../../src/core/review/diff-worker/diff-worker-protocol.ts').DiffWorkerResponse,
    ) => void,
  ): void {
    this.posted.push(request);
    this.listener = listener;
  }

  emit(
    response: import('../../src/core/review/diff-worker/diff-worker-protocol.ts').DiffWorkerResponse,
  ): void {
    this.listener?.(response);
  }

  dispose(): void {
    this.disposed = true;
  }
}

describe('MutationJournal worker projection', () => {
  it('schedules a worker request on append and applies the ready response', () => {
    const worker = new FakeDiffWorkerClient();
    const journal = new MutationJournal({ diffWorkerClient: worker });
    const { aggregate } = journal.append(makeMutation());

    expect(worker.posted).toHaveLength(1);
    expect(worker.posted[0]).toMatchObject({
      fileId: aggregate.fileId,
      revision: 1,
      originalContent: 'before',
      modifiedContent: 'after',
    });
    expect(aggregate.projection.status).toBe('pending');

    const document = makeDocument();
    worker.emit({
      requestId: worker.posted[0]!.requestId,
      fileId: aggregate.fileId,
      revision: 1,
      status: 'settled',
      document,
    });

    expect(aggregate.projection).toEqual({ status: 'settled', revision: 1, document });
    journal.dispose();
    expect(worker.disposed).toBe(true);
  });

  it('drops stale worker responses by revision', () => {
    const worker = new FakeDiffWorkerClient();
    const journal = new MutationJournal({ diffWorkerClient: worker });
    const first = journal.append(makeMutation());
    // 第二次 append 把 revision 推到 2，并丢弃 revision 1 的待处理请求
    journal.append(
      makeMutation({ toolCallId: 'tool-2', after: captureTextSnapshot(Buffer.from('final')) }),
    );

    expect(aggregateRevision(first.aggregate)).toBe(2);
    expect(first.aggregate.projection.status).toBe('pending');

    // 旧 revision 的响应被丢弃
    worker.emit({
      requestId: 'stale',
      fileId: first.aggregate.fileId,
      revision: 1,
      status: 'settled',
      document: makeDocument(),
    });
    expect(first.aggregate.projection.status).toBe('pending');

    journal.dispose();
  });

  it('applies canonical unavailable documents', () => {
    const worker = new FakeDiffWorkerClient();
    const journal = new MutationJournal({ diffWorkerClient: worker });
    const { aggregate } = journal.append(makeMutation());

    worker.emit({
      requestId: worker.posted[0]!.requestId,
      fileId: aggregate.fileId,
      revision: 1,
      status: 'settled',
      document: { ...makeDocument(), hunks: [], unavailableReason: 'diff_too_large' },
    });
    expect(aggregate.projection).toEqual({
      status: 'settled',
      revision: 1,
      document: { ...makeDocument(), hunks: [], unavailableReason: 'diff_too_large' },
    });

    journal.dispose();
  });

  it('looks up records by toolCallId', () => {
    const worker = new FakeDiffWorkerClient();
    const journal = new MutationJournal({ diffWorkerClient: worker });
    journal.append(makeMutation({ toolCallId: 'call-A' }));

    expect(journal.getRecordByToolCallId('call-A')?.toolCallId).toBe('call-A');
    expect(journal.getRecordByToolCallId('missing')).toBeUndefined();
    journal.dispose();
  });
});

function aggregateRevision(
  aggregate: import('../../src/core/review/index.ts').TurnFileAggregate,
): number {
  return aggregate.revision;
}
