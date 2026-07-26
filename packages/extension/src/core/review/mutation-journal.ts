// ============================================================
// Mutation Journal — append-only 文件突变事实与 turn/file 聚合
// ============================================================

import { normalize, resolve } from 'node:path';
import { MAX_REVIEW_TEXT_BYTES } from '../text-size.ts';
import {
  REVIEW_CONTEXT_LINES,
  createUnavailableDiffDocument,
  type DiffDocument,
} from './diff-document.ts';
import { DiffWorkerClient } from './diff-worker/diff-worker-client.ts';
import type {
  DiffWorkerClientPort,
  DiffWorkerResponseListener,
} from './diff-worker/diff-worker-client.ts';
import type { DiffWorkerResponse } from './diff-worker/diff-worker-protocol.ts';
import type { CapturedTextSnapshot, MutationOperation } from './mutation-capture-context.ts';
import type {
  FileReviewFile,
  FileReviewProjectionStatus,
  FileReviewRecord,
  FileReviewTurnSnapshot,
} from './file-review.ts';

// ---------- 类型 ----------

export type MutationToolOutcome = 'success' | 'error_after_write';

export interface MutationRecord {
  recordId: string;
  ownerId: string;
  turnId: string;
  toolCallId: string;
  operation: MutationOperation;
  path: string;
  absolutePath: string;
  displayPath?: string;
  sequence: number;
  toolOutcome: MutationToolOutcome;
}

export type MutationProjection =
  | { status: 'pending'; revision: number }
  | { status: 'settled'; revision: number; document: DiffDocument };

export interface TurnFileAggregate {
  fileId: string;
  turnId: string;
  path: string;
  absolutePath: string;
  displayPath?: string;
  recordIds: string[];
  firstRecordId: string;
  latestRecordId: string;
  baseline: CapturedTextSnapshot;
  latest: CapturedTextSnapshot;
  revision: number;
  projection: MutationProjection;
}

export interface AppendMutationInput {
  ownerId: string;
  turnId: string;
  toolCallId: string;
  operation: MutationOperation;
  path: string;
  absolutePath: string;
  displayPath?: string;
  before: CapturedTextSnapshot;
  after: CapturedTextSnapshot;
  toolOutcome: MutationToolOutcome;
}

export interface MutationAppendResult {
  record: MutationRecord;
  aggregate: TurnFileAggregate;
}

export interface MutationJournalUpdate {
  type: 'append' | 'projection' | 'release';
  ownerId: string;
  turnId: string;
  fileId: string;
  revision: number;
}

export type MutationJournalListener = (update: MutationJournalUpdate) => void;

export interface MutationJournalOptions {
  diffWorkerClient?: DiffWorkerClientPort;
  maxBytes?: number;
  contextLines?: number;
  onUpdated?: MutationJournalListener;
}

export interface FinalizeMutationTurnOptions {
  timeoutMs?: number;
}

interface AggregateEntry {
  ownerId: string;
  aggregate: TurnFileAggregate;
}

const DEFAULT_FINALIZE_TIMEOUT_MS = 2_000;

// ---------- 路径 ----------

/** 将调用方提供的 absolutePath 收敛为 Journal 的稳定聚合键。 */
export function normalizeMutationAbsolutePath(absolutePath: string): string {
  const normalized = normalize(resolve(absolutePath));
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function aggregateKey(ownerId: string, turnId: string, absolutePath: string): string {
  return JSON.stringify([ownerId, turnId, normalizeMutationAbsolutePath(absolutePath)]);
}

// ---------- Journal ----------

export class MutationJournal {
  private readonly records: MutationRecord[] = [];
  private readonly recordsById = new Map<string, MutationRecord>();
  private readonly recordsByToolCallId = new Map<string, MutationRecord>();
  private readonly aggregateEntries = new Map<string, AggregateEntry>();
  private readonly aggregateKeyByRecordId = new Map<string, string>();
  private readonly aggregateKeyByFileId = new Map<string, string>();
  private readonly sealedTurnIds = new Set<string>();
  private readonly finalizationByTurnId = new Map<
    string,
    Promise<FileReviewTurnSnapshot | undefined>
  >();
  private readonly listeners = new Set<MutationJournalListener>();
  private readonly diffWorkerClient: DiffWorkerClientPort;
  private readonly maxBytes: number;
  private readonly contextLines: number;
  private nextRecordId = 0;
  private nextFileId = 0;
  private nextSequence = 0;
  private nextRequestId = 0;
  private disposed = false;

  constructor(options: MutationJournalOptions = {}) {
    this.diffWorkerClient = options.diffWorkerClient ?? new DiffWorkerClient();
    this.maxBytes = options.maxBytes ?? MAX_REVIEW_TEXT_BYTES;
    this.contextLines = options.contextLines ?? REVIEW_CONTEXT_LINES;
    if (options.onUpdated) this.listeners.add(options.onUpdated);
  }

  append(input: AppendMutationInput): MutationAppendResult {
    if (this.disposed) {
      throw new Error(`MutationJournal 已销毁，无法追加工具调用: ${input.toolCallId}`);
    }
    if (this.sealedTurnIds.has(input.turnId)) {
      throw new Error(`MutationJournal turn 已封口，无法追加工具调用: ${input.turnId}`);
    }

    const normalizedAbsolutePath = normalizeMutationAbsolutePath(input.absolutePath);
    const key = aggregateKey(input.ownerId, input.turnId, normalizedAbsolutePath);
    const recordId = `mutation-${++this.nextRecordId}`;
    // absolutePath 保留原始大小写用于展示和文件打开；归一化仅用于聚合键。
    const record: MutationRecord = {
      recordId,
      ownerId: input.ownerId,
      turnId: input.turnId,
      toolCallId: input.toolCallId,
      operation: input.operation,
      path: input.path,
      absolutePath: input.absolutePath,
      displayPath: input.displayPath,
      sequence: ++this.nextSequence,
      toolOutcome: input.toolOutcome,
    };

    this.records.push(record);
    this.recordsById.set(recordId, record);
    this.recordsByToolCallId.set(record.toolCallId, record);

    let entry = this.aggregateEntries.get(key);
    if (!entry) {
      const fileId = `mutation-file-${++this.nextFileId}`;
      entry = {
        ownerId: input.ownerId,
        aggregate: {
          fileId,
          turnId: input.turnId,
          path: input.path,
          absolutePath: input.absolutePath,
          displayPath: input.displayPath,
          recordIds: [recordId],
          firstRecordId: recordId,
          latestRecordId: recordId,
          baseline: input.before,
          latest: input.after,
          revision: 1,
          projection: { status: 'pending', revision: 1 },
        },
      };
      this.aggregateEntries.set(key, entry);
      this.aggregateKeyByFileId.set(fileId, key);
    } else {
      const aggregate = entry.aggregate;
      aggregate.recordIds.push(recordId);
      aggregate.latestRecordId = recordId;
      aggregate.latest = input.after;
      aggregate.revision += 1;
      aggregate.projection = { status: 'pending', revision: aggregate.revision };
    }

    this.aggregateKeyByRecordId.set(recordId, key);
    const result = { record, aggregate: entry.aggregate };
    this.publish({
      type: 'append',
      ownerId: input.ownerId,
      turnId: input.turnId,
      fileId: entry.aggregate.fileId,
      revision: entry.aggregate.revision,
    });
    this.scheduleProjection(entry.aggregate);
    return result;
  }

  getRecord(recordId: string): MutationRecord | undefined {
    return this.recordsById.get(recordId);
  }

  getRecordByToolCallId(toolCallId: string): MutationRecord | undefined {
    return this.recordsByToolCallId.get(toolCallId);
  }

  getRecords(): readonly MutationRecord[] {
    return this.records;
  }

  getAggregateByRecordId(recordId: string): TurnFileAggregate | undefined {
    const key = this.aggregateKeyByRecordId.get(recordId);
    return key ? this.aggregateEntries.get(key)?.aggregate : undefined;
  }

  getAggregateByFileId(fileId: string): TurnFileAggregate | undefined {
    const key = this.aggregateKeyByFileId.get(fileId);
    return key ? this.aggregateEntries.get(key)?.aggregate : undefined;
  }

  getAggregate(
    ownerId: string,
    turnId: string,
    absolutePath: string,
  ): TurnFileAggregate | undefined {
    return this.aggregateEntries.get(aggregateKey(ownerId, turnId, absolutePath))?.aggregate;
  }

  getTurnAggregates(turnId: string, ownerId?: string): TurnFileAggregate[] {
    const result: TurnFileAggregate[] = [];
    for (const entry of this.aggregateEntries.values()) {
      if (entry.aggregate.turnId !== turnId) continue;
      if (ownerId !== undefined && entry.ownerId !== ownerId) continue;
      result.push(entry.aggregate);
    }
    return result;
  }

  getAggregates(): TurnFileAggregate[] {
    return [...this.aggregateEntries.values()].map((entry) => entry.aggregate);
  }

  /**
   * 将 Journal 聚合投影为 host 消费的 FileReviewTurnSnapshot。
   * 这是 Journal→host 的单向适配：host 的 summary/panel/artifact 全部消费同一份
   * projection.document（DiffDocument），不重新 line diff、不读工作区文件。
   */
  toReviewTurnSnapshot(turnId: string): FileReviewTurnSnapshot | undefined {
    const aggregates = this.getTurnAggregates(turnId);
    if (aggregates.length === 0) {
      // 没有聚合但有 record（例如已 release）时仍返回 records
      const records = this.records.filter((record) => record.turnId === turnId);
      if (records.length === 0) return undefined;
      return {
        turnId,
        files: [],
        records: records.map(toReviewRecord),
        phase: this.sealedTurnIds.has(turnId) ? 'finalized' : 'active',
      };
    }

    const records = this.records.filter((record) => record.turnId === turnId);
    const sequenceByRecordId = new Map(records.map((record) => [record.recordId, record.sequence]));

    const files: FileReviewFile[] = aggregates
      .map((aggregate) => toReviewFile(aggregate, sequenceByRecordId))
      .sort((a, b) => (b.latestSequence ?? 0) - (a.latestSequence ?? 0));

    return {
      turnId,
      files,
      records: records.map(toReviewRecord),
      phase:
        this.sealedTurnIds.has(turnId) &&
        aggregates.every((aggregate) => aggregate.projection.status === 'settled')
          ? 'finalized'
          : 'active',
    };
  }

  isTurnSealed(turnId: string): boolean {
    return this.sealedTurnIds.has(turnId);
  }

  sealTurn(turnId: string): boolean {
    if (this.disposed) return false;
    const wasSealed = this.sealedTurnIds.has(turnId);
    this.sealedTurnIds.add(turnId);
    return !wasSealed;
  }

  /**
   * 封口并终态化一个 review turn。超时 revision 原子降级为 generation_failed，
   * 后续同 revision Worker 响应会被 setProjection 的 pending guard 丢弃。
   */
  finalizeTurn(
    turnId: string,
    options: FinalizeMutationTurnOptions = {},
  ): Promise<FileReviewTurnSnapshot | undefined> {
    const existing = this.finalizationByTurnId.get(turnId);
    if (existing) return existing;

    this.sealTurn(turnId);
    const finalization = this.finalizeSealedTurn(
      turnId,
      options.timeoutMs ?? DEFAULT_FINALIZE_TIMEOUT_MS,
    ).finally(() => {
      this.finalizationByTurnId.delete(turnId);
    });
    this.finalizationByTurnId.set(turnId, finalization);
    return finalization;
  }

  setProjectionSettled(fileId: string, revision: number, document: DiffDocument): boolean {
    return this.setProjection(fileId, revision, { status: 'settled', revision, document });
  }

  /** 释放完整 snapshot 字符串；settled DiffDocument 和轻量 metadata 保持可用。 */
  releaseSnapshots(turnId?: string, fileId?: string): boolean {
    let released = false;
    const releasedSnapshotSet = new Set<CapturedTextSnapshot>();

    for (const entry of this.aggregateEntries.values()) {
      const aggregate = entry.aggregate;
      if (turnId !== undefined && aggregate.turnId !== turnId) continue;
      if (fileId !== undefined && aggregate.fileId !== fileId) continue;

      releaseSnapshot(aggregate.baseline, 'content_released', releasedSnapshotSet);
      releaseSnapshot(aggregate.latest, 'content_released', releasedSnapshotSet);
      released = true;
    }

    return released;
  }

  releaseTurnSnapshots(turnId: string): boolean {
    return this.releaseSnapshots(turnId);
  }

  /**
   * 完整 artifact 已提交后驱逐一个 turn 的 runtime payload。
   * sealed identity 保留，确保任何迟到 capture 仍被拒绝。
   */
  evictTurn(turnId: string): boolean {
    if (this.disposed) return false;
    const entries = [...this.aggregateEntries.entries()].filter(
      ([, entry]) => entry.aggregate.turnId === turnId,
    );
    const records = this.records.filter((record) => record.turnId === turnId);
    if (entries.length === 0 && records.length === 0) return false;

    this.releaseTurnSnapshots(turnId);
    for (const [key, entry] of entries) {
      const aggregate = entry.aggregate;
      this.publish({
        type: 'release',
        ownerId: entry.ownerId,
        turnId,
        fileId: aggregate.fileId,
        revision: aggregate.revision,
      });
      this.aggregateEntries.delete(key);
      this.aggregateKeyByFileId.delete(aggregate.fileId);
      for (const recordId of aggregate.recordIds) {
        this.aggregateKeyByRecordId.delete(recordId);
      }
    }
    for (const record of records) {
      this.recordsById.delete(record.recordId);
      if (this.recordsByToolCallId.get(record.toolCallId)?.recordId === record.recordId) {
        this.recordsByToolCallId.delete(record.toolCallId);
      }
    }
    const retainedRecords = this.records.filter((record) => record.turnId !== turnId);
    this.records.splice(0, this.records.length, ...retainedRecords);
    return true;
  }

  onUpdated(listener: MutationJournalListener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onAggregateUpdated(listener: MutationJournalListener): () => void {
    return this.onUpdated(listener);
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.releaseSnapshots();
    this.diffWorkerClient.dispose();
  }

  // ---------- Worker 投影调度 ----------

  private scheduleProjection(aggregate: TurnFileAggregate): void {
    if (this.disposed) return;
    if (aggregate.projection.status !== 'pending') return;

    const requestId = `mutation-diff-${++this.nextRequestId}`;
    const listener: DiffWorkerResponseListener = (response) =>
      this.applyProjectionResponse(aggregate.fileId, response);

    try {
      this.diffWorkerClient.request(
        {
          requestId,
          ownerId: this.resolveOwnerIdForAggregate(aggregate),
          turnId: aggregate.turnId,
          fileId: aggregate.fileId,
          revision: aggregate.revision,
          filePath: aggregate.absolutePath,
          originalContent: aggregate.baseline.content,
          modifiedContent: aggregate.latest.content,
          unavailableReason:
            aggregate.baseline.unavailableReason ?? aggregate.latest.unavailableReason,
          maxBytes: this.maxBytes,
          contextLines: this.contextLines,
        },
        listener,
      );
    } catch (cause) {
      const error = new Error(
        `Mutation projection 调度失败: ${aggregate.absolutePath} (${aggregate.turnId}/${aggregate.fileId}, revision ${aggregate.revision})`,
        { cause },
      );
      this.applyProjectionResponse(aggregate.fileId, {
        requestId,
        fileId: aggregate.fileId,
        revision: aggregate.revision,
        status: 'error',
        reason: 'generation_failed',
        message: `${error.message}: ${getUnknownErrorMessage(cause)}`,
      });
    }
  }

  private applyProjectionResponse(fileId: string, response: DiffWorkerResponse): void {
    if (this.disposed) return;
    if (response.fileId !== fileId) return;

    if (response.status === 'settled') {
      this.setProjection(fileId, response.revision, {
        status: 'settled',
        revision: response.revision,
        document: response.document,
      });
    } else {
      this.setProjection(fileId, response.revision, {
        status: 'settled',
        revision: response.revision,
        document: createUnavailableDiffDocument(response.reason),
      });
    }
  }

  private resolveOwnerIdForAggregate(aggregate: TurnFileAggregate): string {
    const key = this.aggregateKeyByFileId.get(aggregate.fileId);
    const entry = key ? this.aggregateEntries.get(key) : undefined;
    return entry?.ownerId ?? aggregate.turnId;
  }

  private setProjection(fileId: string, revision: number, projection: MutationProjection): boolean {
    if (this.disposed) return false;
    const key = this.aggregateKeyByFileId.get(fileId);
    const entry = key ? this.aggregateEntries.get(key) : undefined;
    if (
      !entry ||
      entry.aggregate.revision !== revision ||
      entry.aggregate.projection.status !== 'pending'
    ) {
      return false;
    }
    entry.aggregate.projection = projection;
    this.publish({
      type: 'projection',
      ownerId: entry.ownerId,
      turnId: entry.aggregate.turnId,
      fileId,
      revision,
    });
    return true;
  }

  private async finalizeSealedTurn(
    turnId: string,
    timeoutMs: number,
  ): Promise<FileReviewTurnSnapshot | undefined> {
    const aggregates = this.getTurnAggregates(turnId);
    if (aggregates.length === 0) return this.toReviewTurnSnapshot(turnId);

    const settled = await this.waitForTurnSettlement(turnId, Math.max(0, timeoutMs));
    if (!settled) {
      for (const aggregate of this.getTurnAggregates(turnId)) {
        if (aggregate.projection.status !== 'pending') continue;
        this.setProjection(aggregate.fileId, aggregate.revision, {
          status: 'settled',
          revision: aggregate.revision,
          document: createUnavailableDiffDocument('generation_failed'),
        });
      }
    }
    return this.toReviewTurnSnapshot(turnId);
  }

  private waitForTurnSettlement(turnId: string, timeoutMs: number): Promise<boolean> {
    const isSettled = (): boolean =>
      this.getTurnAggregates(turnId).every(
        (aggregate) => aggregate.projection.status === 'settled',
      );
    if (isSettled()) return Promise.resolve(true);
    if (timeoutMs === 0) return Promise.resolve(false);

    return new Promise<boolean>((resolveWait) => {
      let completed = false;
      let unsubscribe = (): void => undefined;
      const complete = (settled: boolean): void => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        unsubscribe();
        resolveWait(settled);
      };
      unsubscribe = this.onUpdated((update) => {
        if (update.turnId === turnId && isSettled()) complete(true);
      });
      const timer = setTimeout(() => complete(false), timeoutMs);
      // 防止 projection 在初次检查和 listener 注册之间完成。
      if (isSettled()) complete(true);
    });
  }

  private publish(update: MutationJournalUpdate): void {
    if (this.disposed) return;
    for (const listener of this.listeners) {
      try {
        listener(update);
      } catch {
        // 观察者故障不能影响 append-only Journal。
      }
    }
  }
}

function releaseSnapshot(
  snapshot: CapturedTextSnapshot,
  reason: 'content_released',
  released: Set<CapturedTextSnapshot>,
): void {
  if (released.has(snapshot)) return;
  released.add(snapshot);
  if (snapshot.content !== null) {
    snapshot.content = null;
    snapshot.unavailableReason = reason;
  }
}

function getUnknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toReviewFile(
  aggregate: TurnFileAggregate,
  sequenceByRecordId: Map<string, number>,
): FileReviewFile {
  const projection = aggregate.projection;
  const document = projection.status === 'settled' ? projection.document : undefined;
  const unavailableReason = document?.unavailableReason;
  const projectionStatus: FileReviewProjectionStatus =
    projection.status === 'pending'
      ? 'pending'
      : document?.unavailableReason
        ? 'unavailable'
        : 'ready';

  return {
    absolutePath: aggregate.absolutePath,
    path: aggregate.path,
    displayPath: aggregate.displayPath,
    originalContent: aggregate.baseline.content,
    modifiedContent: aggregate.latest.content,
    document,
    fileId: aggregate.fileId,
    revision: aggregate.revision,
    projectionStatus,
    recordIds: [...aggregate.recordIds],
    latestRecordId: aggregate.latestRecordId,
    latestSequence: sequenceByRecordId.get(aggregate.latestRecordId) ?? 0,
    additions: document?.additions ?? 0,
    deletions: document?.deletions ?? 0,
    firstChangedLine: document?.firstChangedLine,
    unavailableReason,
  };
}

function toReviewRecord(record: MutationRecord): FileReviewRecord {
  return {
    recordId: record.recordId,
    turnId: record.turnId,
    toolCallId: record.toolCallId,
    operation: record.operation,
    path: record.path,
    absolutePath: record.absolutePath,
    displayPath: record.displayPath,
    sequence: record.sequence,
    toolOutcome: record.toolOutcome,
  };
}
