// ============================================================
// Mutation Capture 协调器 — 用 AsyncLocalStorage 捕获真实 Operations 突变
// ============================================================

import { AsyncLocalStorage } from 'node:async_hooks';
import type { MutationCaptureScope, MutationCaptureState } from './mutation-capture-context.ts';
import {
  captureStringSnapshot,
  captureTextSnapshot,
  createUnavailableSnapshot,
} from './mutation-capture-context.ts';
import type { MutationAppendResult, MutationJournal } from './mutation-journal.ts';
import type { ReviewBaselineResult } from './review-snapshot-provider.ts';

// ---------- 依赖 ----------

export interface MutationCaptureCoordinatorOptions {
  journal?: MutationJournal;
  /** 在 run 开始时读取一次；后续 turn 切换不会影响当前 mutation。 */
  getTurnId?: () => string | undefined;
  /** 没有 Journal 时可用于非阻断诊断。 */
  onMutation?: (result: MutationAppendResult) => void;
  onCaptureError?: (error: unknown) => void;
}

export interface MutationCaptureCoordinatorPort {
  run<T>(scope: MutationCaptureScope, execute: () => Promise<T>): Promise<T>;
  captureBefore(buffer: Buffer): void;
  captureMissingBefore(): void;
  captureUnavailableBefore(): void;
  captureAfter(content: string): void;
  markWriteCommitted(): void;
  captureBeforeFrom(read: () => Promise<ReviewBaselineResult>): Promise<void>;
  getCurrentAbsolutePath?(): string | undefined;
}

interface InternalState extends MutationCaptureState {
  beforeCapture?: Promise<void>;
}

// ---------- 协调器 ----------

export class MutationCaptureCoordinator implements MutationCaptureCoordinatorPort {
  private readonly options: MutationCaptureCoordinatorOptions;
  private readonly storage: AsyncLocalStorage<InternalState>;

  constructor(options: MutationCaptureCoordinatorOptions = {}) {
    this.options = options;
    this.storage = new AsyncLocalStorage<InternalState>();
  }

  async run<T>(scope: MutationCaptureScope, execute: () => Promise<T>): Promise<T> {
    // turnId 必须在进入异步作用域前冻结，不能在 writeFile 返回后再查询。
    let turnId = `untracked:${scope.ownerId}`;
    try {
      turnId = this.options.getTurnId?.() ?? turnId;
    } catch (error) {
      this.reportCaptureError(error);
    }
    const state: InternalState = {
      scope,
      turnId,
      writeCommitted: false,
    };

    return this.storage.run(state, async () => {
      try {
        const result = await execute();
        this.publish(state, 'success');
        return result;
      } catch (error) {
        if (state.writeCommitted) {
          this.publish(state, 'error_after_write');
        }
        throw error;
      }
    });
  }

  captureBefore(buffer: Buffer): void {
    const state = this.getState();
    if (!state || state.before) return;
    state.before = captureTextSnapshot(buffer);
  }

  captureMissingBefore(): void {
    const state = this.getState();
    if (!state || state.before) return;
    // 新文件的 null baseline 没有 unavailableReason，供 Journal 区分 create 与读取失败。
    state.before = { content: null, byteLength: 0 };
  }

  captureUnavailableBefore(): void {
    const state = this.getState();
    if (!state || state.before) return;
    state.before = createUnavailableSnapshot('original_unavailable');
  }

  captureAfter(content: string): void {
    const state = this.getState();
    if (!state) return;
    state.after = captureStringSnapshot(content);
  }

  markWriteCommitted(): void {
    const state = this.getState();
    if (state) state.writeCommitted = true;
  }

  /**
   * 在同一 scope 内以 promise 作为闸门，保证首次 mkdir 只触发一次 baseline 读取。
   * provider 失败只转成 unavailable，不会阻断 Pi 工具的后续 mkdir/write。
   */
  async captureBeforeFrom(read: () => Promise<ReviewBaselineResult>): Promise<void> {
    const state = this.getState();
    if (!state) return;
    if (state.before) return;
    if (!state.beforeCapture) {
      state.beforeCapture = (async () => {
        try {
          const result = await read();
          if (result.kind === 'missing') {
            this.captureMissingBefore();
          } else if (result.kind === 'captured') {
            state.before = result.snapshot;
          } else {
            state.before = {
              content: null,
              byteLength: 0,
              unavailableReason: result.reason,
            };
          }
        } catch (error) {
          this.reportCaptureError(error);
          this.captureUnavailableBefore();
        }
      })();
    }
    await state.beforeCapture;
  }

  getCurrentAbsolutePath(): string | undefined {
    return this.getState()?.scope.absolutePath;
  }

  private getState(): InternalState | undefined {
    return this.storage.getStore();
  }

  private publish(state: InternalState, toolOutcome: 'success' | 'error_after_write'): void {
    if (!state.writeCommitted || !state.before || !state.after) return;
    const turnId = state.turnId;
    if (!turnId) return;

    try {
      const result = this.options.journal?.append({
        ownerId: state.scope.ownerId,
        turnId,
        toolCallId: state.scope.toolCallId,
        operation: state.scope.operation,
        path: state.scope.path,
        absolutePath: state.scope.absolutePath,
        displayPath: state.scope.displayPath,
        before: state.before,
        after: state.after,
        toolOutcome,
      });
      if (result) this.options.onMutation?.(result);
    } catch (error) {
      // Journal 是观察路径，不能改变文件工具已经返回的成功或原始异常。
      this.reportCaptureError(error);
    }
  }

  private reportCaptureError(error: unknown): void {
    try {
      this.options.onCaptureError?.(error);
    } catch {
      // 诊断回调也不得影响 Pi 工具。
    }
  }
}

export type MutationCaptureStateSnapshot = MutationCaptureState & {
  turnId: string;
};
