// ============================================================
// File review built-in extension
// 负责：在工具 mutation 提交点采集事实，并在 agent_end 精确封口、终态化和单次持久化。
// ============================================================

import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScoutFileChangeDetails } from '@scout-agent/shared';
import type {
  ScoutExtensionAPI,
  ScoutExtensionFactory,
  ToolResultEvent,
  ToolResultEventResult,
} from '../extensions/types.ts';
import {
  REVIEW_ARTIFACT_CUSTOM_TYPE,
  createReviewArtifactSummary,
  persistReviewArtifact,
} from './review-artifact.ts';
import { ReviewArtifactStore } from './review-artifact-store.ts';
import type { FileReviewProjectionUpdate, FileReviewTurnSnapshot } from './file-review.ts';
import { MutationCaptureCoordinator } from './mutation-capture-coordinator.ts';
import {
  MutationJournal,
  type ExactMutationDiffInput,
  type MutationJournalOptions,
  type MutationJournalUpdate,
} from './mutation-journal.ts';

// ---------- 类型 ----------

export type FileReviewUpdatedListener = (
  review: FileReviewTurnSnapshot,
  projectionUpdate?: FileReviewProjectionUpdate,
) => void;

export interface FileReviewExtensionControllerOptions {
  sessionId: string;
  agentDir?: string;
  artifactStore?: ReviewArtifactStore;
  journal?: MutationJournal;
  journalOptions?: MutationJournalOptions;
  finalizeTimeoutMs?: number;
  onUpdated?: FileReviewUpdatedListener;
  onDiagnostic?: (message: string, error?: unknown) => void;
}

const DEFAULT_FINALIZE_TIMEOUT_MS = 2_000;

// ---------- 控制器 ----------

/**
 * Review 的唯一运行态 owner。
 *
 * AgentSession 只借用 mutationCapture 包裹内置文件工具；run 边界、Worker 投影、
 * tool_result 装饰和 session entry 持久化全部由扩展事件驱动。
 */
export class FileReviewExtensionController {
  readonly mutationCapture: MutationCaptureCoordinator;
  readonly ownerId = `file-review:${randomUUID()}`;

  private readonly sessionId: string;
  private readonly journal: MutationJournal;
  private readonly finalizeTimeoutMs: number;
  private readonly artifactStore: ReviewArtifactStore;
  private onDiagnostic?: (message: string, error?: unknown) => void;
  private readonly pendingTurnIds = new Set<string>();
  private readonly committedTurnIds = new Set<string>();
  private readonly commitByTurnId = new Map<string, Promise<void>>();
  private readonly unsubscribeJournal: () => void;
  private appendEntry?: ScoutExtensionAPI['appendEntry'];
  private activeTurnId: string | undefined;
  private onUpdated?: FileReviewUpdatedListener;
  private disposed = false;

  constructor(options: FileReviewExtensionControllerOptions) {
    this.sessionId = options.sessionId;
    // 提供构造到首次 agent_start 之间的安全 owner；正常运行会在 agent_start 立即替换。
    this.activeTurnId = `${this.sessionId}:run-${randomUUID()}`;
    this.journal = options.journal ?? new MutationJournal(options.journalOptions);
    this.finalizeTimeoutMs = options.finalizeTimeoutMs ?? DEFAULT_FINALIZE_TIMEOUT_MS;
    this.artifactStore =
      options.artifactStore ??
      new ReviewArtifactStore({
        agentDir: options.agentDir ?? join(tmpdir(), 'scout-agent-review-tests'),
      });
    this.onUpdated = options.onUpdated;
    this.onDiagnostic = options.onDiagnostic;
    this.unsubscribeJournal = this.journal.onUpdated((update) => this.handleJournalUpdate(update));
    this.mutationCapture = new MutationCaptureCoordinator({
      journal: this.journal,
      getTurnId: () => this.activeTurnId,
      onCaptureError: (error) =>
        this.reportDiagnostic('File review mutation capture failed', error),
    });
  }

  createFactory(): ScoutExtensionFactory {
    return (api) => {
      this.appendEntry = api.appendEntry;
      api.on('agent_start', async () => {
        this.startRun();
      });
      api.on('tool_result', async (event) => this.decorateToolResult(event as ToolResultEvent));
      api.on('agent_end', async () => {
        await this.finalizeActiveRun();
      });
      api.on('session_shutdown', async () => {
        await this.finalizeActiveRun();
        await this.flushPendingArtifacts();
      });
    };
  }

  setUpdatedListener(listener: FileReviewUpdatedListener | undefined): void {
    this.onUpdated = listener;
  }

  setDiagnosticListener(listener: ((message: string, error?: unknown) => void) | undefined): void {
    this.onDiagnostic = listener;
  }

  getReviewTurn(turnId: string): FileReviewTurnSnapshot | undefined {
    return this.journal.toReviewTurnSnapshot(turnId);
  }

  computeExactDiff(input: ExactMutationDiffInput) {
    return this.journal.computeExact(input);
  }

  /** @internal 供 review 单元测试检查 canonical Journal。 */
  getJournal(): MutationJournal {
    return this.journal;
  }

  /** @internal 供 host/test 解析同一全局 CAS。 */
  getArtifactStore(): ReviewArtifactStore {
    return this.artifactStore;
  }

  /** 等待并重试已封口但尚未写入 session tree 的 review artifact。 */
  async flushPendingArtifacts(): Promise<void> {
    if (this.disposed) return;
    for (const turnId of [...this.pendingTurnIds]) {
      await this.commitTurn(turnId);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeJournal();
    this.journal.dispose();
    this.pendingTurnIds.clear();
    this.commitByTurnId.clear();
    this.appendEntry = undefined;
    this.activeTurnId = undefined;
  }

  // ---------- 扩展事件 ----------

  private startRun(): void {
    if (this.disposed) return;
    this.activeTurnId = `${this.sessionId}:run-${randomUUID()}`;
  }

  private decorateToolResult(event: ToolResultEvent): ToolResultEventResult | undefined {
    const record = this.journal.getRecordByToolCallId(event.toolCallId);
    if (!record) return undefined;
    const aggregate = this.journal.getAggregateByRecordId(record.recordId);
    if (!aggregate) return undefined;

    const projection = aggregate.projection;
    const status =
      projection.status === 'pending'
        ? 'pending'
        : projection.document.unavailableReason
          ? 'unavailable'
          : 'ready';
    const details: ScoutFileChangeDetails = {
      kind: 'file_change',
      path: record.absolutePath,
      displayPath: record.displayPath,
      review: {
        turnId: record.turnId,
        recordId: record.recordId,
        fileId: record.fileId,
        revision: record.revision,
        status,
      },
      toolOutcome: record.toolOutcome,
    };
    return { details };
  }

  private async finalizeActiveRun(): Promise<void> {
    const turnId = this.activeTurnId;
    if (!turnId) return;

    // 先同步封口并清除 active pointer；即使 finalization 等待 Worker，
    // 后续 run 也只会拥有新的 turnId，不可能被旧 agent_end 误封口。
    this.activeTurnId = undefined;
    this.journal.sealTurn(turnId);
    await this.commitTurn(turnId);
  }

  private commitTurn(turnId: string): Promise<void> {
    if (this.committedTurnIds.has(turnId)) return Promise.resolve();
    const existing = this.commitByTurnId.get(turnId);
    if (existing) return existing;

    const commit = this.createAndAppendArtifact(turnId).finally(() => {
      this.commitByTurnId.delete(turnId);
    });
    this.commitByTurnId.set(turnId, commit);
    return commit;
  }

  private async createAndAppendArtifact(turnId: string): Promise<void> {
    const review = await this.journal.finalizeTurn(turnId, {
      timeoutMs: this.finalizeTimeoutMs,
    });
    if (!review || review.records.length === 0) {
      this.pendingTurnIds.delete(turnId);
      return;
    }

    const persisted = await persistReviewArtifact(
      this.artifactStore,
      this.sessionId,
      review,
      createReviewArtifactSummary(review),
    );
    if (!this.appendEntry) {
      throw new Error(`File review extension 尚未绑定 appendEntry: ${turnId}`);
    }
    await this.appendEntry(REVIEW_ARTIFACT_CUSTOM_TYPE, persisted.ref);

    this.committedTurnIds.add(turnId);
    this.pendingTurnIds.delete(turnId);
    this.journal.evictTurn(turnId);
  }

  // ---------- Journal 投影 ----------

  private handleJournalUpdate(update: MutationJournalUpdate): void {
    if (update.type === 'release') return;
    if (update.type === 'append') this.pendingTurnIds.add(update.turnId);

    const review = this.journal.toReviewTurnSnapshot(update.turnId);
    if (!review || !this.onUpdated) return;
    const file = review.files.find(
      (candidate) =>
        candidate.fileId === update.fileId &&
        candidate.revision === update.revision &&
        candidate.projectionStatus !== 'pending',
    );
    const projectionUpdate: FileReviewProjectionUpdate | undefined =
      update.type === 'projection' && file?.fileId
        ? {
            ownerId: update.ownerId,
            turnId: update.turnId,
            fileId: file.fileId,
            revision: update.revision,
            status: file.projectionStatus === 'ready' ? 'ready' : 'unavailable',
          }
        : undefined;
    try {
      this.onUpdated(review, projectionUpdate);
    } catch (error) {
      this.reportDiagnostic('File review update listener failed', error);
    }
  }

  private reportDiagnostic(message: string, error?: unknown): void {
    try {
      this.onDiagnostic?.(message, error);
    } catch {
      // Review 诊断不能影响工具或 session 生命周期。
    }
  }
}
