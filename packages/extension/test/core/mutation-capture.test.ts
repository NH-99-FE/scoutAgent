import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MAX_REVIEW_TEXT_BYTES } from '../../src/core/text-size.ts';
import { createEditToolDefinition } from '../../src/core/tools/edit.ts';
import type { EditOperations } from '../../src/core/tools/edit.ts';
import { createWriteToolDefinition, type WriteOperations } from '../../src/core/tools/write.ts';
import {
  MutationCaptureCoordinator,
  MutationJournal,
  captureStringSnapshot,
  captureTextSnapshot,
  withEditReviewCapture,
  withWriteReviewCapture,
  type MutationCaptureScope,
  type ReviewSnapshotProvider,
} from '../../src/core/review/index.ts';

function makeScope(overrides: Partial<MutationCaptureScope> = {}): MutationCaptureScope {
  return {
    ownerId: 'owner-1',
    toolCallId: 'tool-1',
    operation: 'edit',
    path: 'file.txt',
    absolutePath: resolve('file.txt'),
    displayPath: 'file.txt',
    ...overrides,
  };
}

function makeCoordinator(journal: MutationJournal, getTurnId = () => 'turn-1') {
  return new MutationCaptureCoordinator({ journal, getTurnId });
}

function makeEditOperations(overrides: Partial<EditOperations> = {}): EditOperations {
  return {
    access: vi.fn(async () => undefined),
    readFile: vi.fn(async () => Buffer.from('before')),
    writeFile: vi.fn(async () => undefined),
    ...overrides,
  };
}

function makeWriteOperations(overrides: Partial<WriteOperations> = {}): WriteOperations {
  return {
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    ...overrides,
  };
}

function makeSnapshotProvider(
  readBefore: ReviewSnapshotProvider['readBefore'] = async () => ({
    kind: 'captured',
    snapshot: captureTextSnapshot(Buffer.from('before')),
  }),
): ReviewSnapshotProvider {
  return { readBefore: vi.fn(readBefore) };
}

describe('edit review capture', () => {
  it('reuses the delegate Buffer once and captures exact before and after text', async () => {
    const journal = new MutationJournal();
    const capture = makeCoordinator(journal);
    const buffer = Buffer.from('﻿first\r\n你好\r\n', 'utf8');
    const operations = makeEditOperations({ readFile: vi.fn(async () => buffer) });
    const decorated = withEditReviewCapture(operations, capture);
    const after = '﻿second\r\n你好\r\n';

    await capture.run(makeScope(), async () => {
      await decorated.access(resolve('file.txt'));
      const actual = await decorated.readFile(resolve('file.txt'));
      expect(actual).toBe(buffer);
      await decorated.writeFile(resolve('file.txt'), after);
    });

    expect(operations.readFile).toHaveBeenCalledTimes(1);
    const [record] = journal.getRecords();
    expect(record.before).toEqual({
      content: 'first\r\n你好\r\n',
      byteLength: buffer.byteLength,
    });
    expect(record.after).toEqual({ content: after, byteLength: Buffer.byteLength(after) });
    expect(record.toolOutcome).toBe('success');
  });

  it.each(['access', 'readFile', 'writeFile'] as const)(
    'preserves the original %s failure and does not commit',
    async (method) => {
      const journal = new MutationJournal();
      const capture = makeCoordinator(journal);
      const failure = new Error(`${method} failed`);
      const operations = makeEditOperations({
        [method]: vi.fn(async () => {
          throw failure;
        }),
      });
      const decorated = withEditReviewCapture(operations, capture);

      const promise = capture.run(makeScope(), async () => {
        await decorated.access(resolve('file.txt'));
        await decorated.readFile(resolve('file.txt'));
        await decorated.writeFile(resolve('file.txt'), 'after');
      });

      await expect(promise).rejects.toBe(failure);
      expect(journal.getRecords()).toHaveLength(0);
    },
  );

  it('isolates concurrent AsyncLocalStorage scopes', async () => {
    const journal = new MutationJournal();
    const capture = makeCoordinator(journal);
    const decorated = withEditReviewCapture(makeEditOperations(), capture);

    await Promise.all([
      capture.run(
        makeScope({ toolCallId: 'tool-a', path: 'a.txt', absolutePath: resolve('a.txt') }),
        async () => {
          await Promise.resolve();
          capture.captureBefore(Buffer.from('a-before'));
          await decorated.writeFile(resolve('a.txt'), 'a-after');
        },
      ),
      capture.run(
        makeScope({ toolCallId: 'tool-b', path: 'b.txt', absolutePath: resolve('b.txt') }),
        async () => {
          capture.captureBefore(Buffer.from('b-before'));
          await Promise.resolve();
          await decorated.writeFile(resolve('b.txt'), 'b-after');
        },
      ),
    ]);

    expect(
      journal
        .getRecords()
        .map((record) => [record.toolCallId, record.before.content, record.after.content]),
    ).toEqual(
      expect.arrayContaining([
        ['tool-a', 'a-before', 'a-after'],
        ['tool-b', 'b-before', 'b-after'],
      ]),
    );
  });

  it('keeps same-file concurrent edits ordered by the mutation queue', async () => {
    const journal = new MutationJournal();
    const capture = makeCoordinator(journal);
    let content = 'alpha';
    const operations = withEditReviewCapture(
      makeEditOperations({
        readFile: vi.fn(async () => Buffer.from(content)),
        writeFile: vi.fn(async (_path, next) => {
          await Promise.resolve();
          content = next;
        }),
      }),
      capture,
    );
    const definition = createEditToolDefinition(process.cwd(), { operations });
    const path = 'queued-review-capture.txt';
    const absolutePath = resolve(path);

    await Promise.all([
      capture.run(makeScope({ toolCallId: 'first', path, absolutePath }), () =>
        definition.execute('first', { path, edits: [{ oldText: 'alpha', newText: 'beta' }] }),
      ),
      capture.run(makeScope({ toolCallId: 'second', path, absolutePath }), () =>
        definition.execute('second', { path, edits: [{ oldText: 'beta', newText: 'gamma' }] }),
      ),
    ]);

    expect(content).toBe('gamma');
    expect(
      journal.getRecords().map((record) => [record.before.content, record.after.content]),
    ).toEqual([
      ['alpha', 'beta'],
      ['beta', 'gamma'],
    ]);
  });

  it('freezes turnId when run starts', async () => {
    const journal = new MutationJournal();
    let turnId = 'turn-before';
    const capture = makeCoordinator(journal, () => turnId);
    const decorated = withEditReviewCapture(makeEditOperations(), capture);

    await capture.run(makeScope(), async () => {
      await decorated.readFile(resolve('file.txt'));
      turnId = 'turn-after';
      await decorated.writeFile(resolve('file.txt'), 'after');
    });

    expect(journal.getRecords()[0].turnId).toBe('turn-before');
  });

  it('does not change tool success when Journal publication fails', async () => {
    const journal = new MutationJournal();
    journal.dispose();
    const capture = makeCoordinator(journal);
    const decorated = withEditReviewCapture(makeEditOperations(), capture);

    await expect(
      capture.run(makeScope(), async () => {
        await decorated.readFile(resolve('file.txt'));
        await decorated.writeFile(resolve('file.txt'), 'after');
        return 'tool result';
      }),
    ).resolves.toBe('tool result');
  });

  it('does not capture or block decorated operations without a scope', async () => {
    const journal = new MutationJournal();
    const decorated = withEditReviewCapture(makeEditOperations(), makeCoordinator(journal));

    await expect(decorated.readFile(resolve('file.txt'))).resolves.toEqual(Buffer.from('before'));
    await expect(decorated.writeFile(resolve('file.txt'), 'after')).resolves.toBeUndefined();
    expect(journal.getRecords()).toHaveLength(0);
  });
});

describe('captured text snapshots', () => {
  it('uses the oracle fatal UTF-8 BOM semantics and preserves CRLF/non-ASCII text', () => {
    const content = '﻿line 1\r\n中文\r\n';
    expect(captureTextSnapshot(Buffer.from(content))).toEqual({
      content: 'line 1\r\n中文\r\n',
      byteLength: Buffer.byteLength(content),
    });
  });

  it('reports binary and oversized buffers explicitly', () => {
    expect(captureTextSnapshot(Buffer.from([0xff]))).toMatchObject({
      content: null,
      unavailableReason: 'binary_or_unsupported',
    });
    expect(captureTextSnapshot(Buffer.alloc(MAX_REVIEW_TEXT_BYTES + 1, 0x61))).toEqual({
      content: null,
      byteLength: MAX_REVIEW_TEXT_BYTES + 1,
      unavailableReason: 'content_too_large',
    });
    expect(captureStringSnapshot(`text${String.fromCharCode(0)}binary`)).toMatchObject({
      content: null,
      unavailableReason: 'binary_or_unsupported',
    });
    expect(captureStringSnapshot('a'.repeat(MAX_REVIEW_TEXT_BYTES + 1))).toMatchObject({
      content: null,
      byteLength: MAX_REVIEW_TEXT_BYTES + 1,
      unavailableReason: 'content_too_large',
    });
  });
});

describe('write review capture', () => {
  it('captures an existing baseline once at the first mkdir boundary', async () => {
    const journal = new MutationJournal();
    const capture = makeCoordinator(journal);
    const operations = makeWriteOperations();
    const provider = makeSnapshotProvider();
    const decorated = withWriteReviewCapture(operations, capture, provider);
    const scope = makeScope({ operation: 'write' });

    await capture.run(scope, async () => {
      await decorated.mkdir(resolve('.'));
      await decorated.mkdir(resolve('.'));
      await decorated.writeFile(scope.absolutePath, 'after');
    });

    expect(provider.readBefore).toHaveBeenCalledTimes(1);
    expect(provider.readBefore).toHaveBeenCalledWith(scope.absolutePath);
    expect(journal.getRecords()[0].before.content).toBe('before');
    expect(journal.getRecords()[0].after.content).toBe('after');
  });

  it('uses null as a new-file baseline', async () => {
    const journal = new MutationJournal();
    const capture = makeCoordinator(journal);
    const provider = makeSnapshotProvider(async () => ({ kind: 'missing' }));
    const decorated = withWriteReviewCapture(makeWriteOperations(), capture, provider);

    await capture.run(makeScope({ operation: 'write' }), async () => {
      await decorated.mkdir(resolve('.'));
      await decorated.writeFile(resolve('file.txt'), 'created');
    });

    expect(journal.getRecords()[0].before).toEqual({ content: null, byteLength: 0 });
  });

  it('never falls back to local fs without a provider', async () => {
    const journal = new MutationJournal();
    const capture = makeCoordinator(journal);
    const decorated = withWriteReviewCapture(makeWriteOperations(), capture);

    await capture.run(makeScope({ operation: 'write' }), async () => {
      await decorated.mkdir(resolve('.'));
      await decorated.writeFile(resolve('file.txt'), 'remote content');
    });

    expect(journal.getRecords()[0].before).toEqual({
      content: null,
      byteLength: 0,
      unavailableReason: 'original_unavailable',
    });
  });

  it.each(['mkdir', 'writeFile'] as const)('does not commit when %s fails', async (method) => {
    const journal = new MutationJournal();
    const capture = makeCoordinator(journal);
    const failure = new Error(`${method} failed`);
    const operations = makeWriteOperations({
      [method]: vi.fn(async () => {
        throw failure;
      }),
    });
    const decorated = withWriteReviewCapture(operations, capture, makeSnapshotProvider());

    const promise = capture.run(makeScope({ operation: 'write' }), async () => {
      await decorated.mkdir(resolve('.'));
      await decorated.writeFile(resolve('file.txt'), 'after');
    });

    await expect(promise).rejects.toBe(failure);
    expect(journal.getRecords()).toHaveLength(0);
  });

  it('records error_after_write when the tool aborts after delegate success', async () => {
    const journal = new MutationJournal();
    const capture = makeCoordinator(journal);
    const decorated = withWriteReviewCapture(
      makeWriteOperations(),
      capture,
      makeSnapshotProvider(),
    );
    const abortError = new Error('Operation aborted');

    const promise = capture.run(makeScope({ operation: 'write' }), async () => {
      await decorated.mkdir(resolve('.'));
      await decorated.writeFile(resolve('file.txt'), 'after');
      throw abortError;
    });

    await expect(promise).rejects.toBe(abortError);
    expect(journal.getRecords()[0].toolOutcome).toBe('error_after_write');
  });

  it('records error_after_write when the real write definition observes abort after write', async () => {
    const journal = new MutationJournal();
    const capture = makeCoordinator(journal);
    const abortController = new AbortController();
    const scope = makeScope({ operation: 'write' });
    const operations = withWriteReviewCapture(
      makeWriteOperations({
        writeFile: vi.fn(async () => {
          abortController.abort();
        }),
      }),
      capture,
      makeSnapshotProvider(),
    );
    const definition = createWriteToolDefinition(process.cwd(), { operations });

    await expect(
      capture.run(scope, () =>
        definition.execute(
          scope.toolCallId,
          { path: scope.path, content: 'after abort' },
          abortController.signal,
        ),
      ),
    ).rejects.toThrow('Operation aborted');
    expect(journal.getRecords()[0].toolOutcome).toBe('error_after_write');
    expect(journal.getRecords()[0].after.content).toBe('after abort');
  });

  it('does not read a provider or block write operations without a scope', async () => {
    const journal = new MutationJournal();
    const provider = makeSnapshotProvider();
    const decorated = withWriteReviewCapture(
      makeWriteOperations(),
      makeCoordinator(journal),
      provider,
    );

    await decorated.mkdir(resolve('.'));
    await decorated.writeFile(resolve('file.txt'), 'after');

    expect(provider.readBefore).not.toHaveBeenCalled();
    expect(journal.getRecords()).toHaveLength(0);
  });

  it('keeps capture/provider failures observational', async () => {
    const journal = new MutationJournal();
    const capture = makeCoordinator(journal);
    const decorated = withWriteReviewCapture(
      makeWriteOperations(),
      capture,
      makeSnapshotProvider(async () => {
        throw new Error('snapshot failed');
      }),
    );

    await expect(
      capture.run(makeScope({ operation: 'write' }), async () => {
        await decorated.mkdir(resolve('.'));
        await decorated.writeFile(resolve('file.txt'), 'after');
      }),
    ).resolves.toBeUndefined();
    expect(journal.getRecords()[0].before.unavailableReason).toBe('original_unavailable');
  });

  it('keeps the exact Pi write result when provider capture and Journal publication fail', async () => {
    const journal = new MutationJournal();
    const capture = makeCoordinator(journal);
    const provider = makeSnapshotProvider(async () => {
      throw new Error('snapshot failed');
    });
    const operations = makeWriteOperations();
    const definition = createWriteToolDefinition(process.cwd(), {
      operations: withWriteReviewCapture(operations, capture, provider),
    });
    const scope = makeScope({ operation: 'write' });

    const result = await capture.run(scope, () =>
      definition.execute(scope.toolCallId, { path: scope.path, content: 'after' }),
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Successfully wrote 5 bytes to file.txt' }],
      details: undefined,
    });
    expect(operations.mkdir).toHaveBeenCalledTimes(1);
    expect(operations.writeFile).toHaveBeenCalledTimes(1);
    expect(journal.getRecords()[0]).toMatchObject({
      before: { content: null, unavailableReason: 'original_unavailable' },
      after: { content: 'after' },
      toolOutcome: 'success',
    });

    journal.dispose();
    await expect(
      capture.run(makeScope({ operation: 'write', toolCallId: 'tool-2' }), () =>
        definition.execute('tool-2', { path: 'file.txt', content: 'again' }),
      ),
    ).resolves.toEqual({
      content: [{ type: 'text', text: 'Successfully wrote 5 bytes to file.txt' }],
      details: undefined,
    });
  });

  it('keeps write successful when captured baseline decoding is unavailable', async () => {
    const journal = new MutationJournal();
    const capture = makeCoordinator(journal);
    const provider = makeSnapshotProvider(async () => ({
      kind: 'captured',
      snapshot: captureTextSnapshot(Buffer.from([0xff])),
    }));
    const operations = makeWriteOperations();
    const definition = createWriteToolDefinition(process.cwd(), {
      operations: withWriteReviewCapture(operations, capture, provider),
    });
    const scope = makeScope({ operation: 'write' });

    await expect(
      capture.run(scope, () =>
        definition.execute(scope.toolCallId, { path: scope.path, content: 'text' }),
      ),
    ).resolves.toMatchObject({ details: undefined });
    expect(operations.writeFile).toHaveBeenCalledTimes(1);
    expect(journal.getRecords()[0].before.unavailableReason).toBe('binary_or_unsupported');
  });
});
