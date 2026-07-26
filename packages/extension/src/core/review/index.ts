// ============================================================
// Review core barrel
// 负责：统一导出文件审查的 canonical document、runtime store 与投影工具。
// ============================================================

export {
  DIFF_DOCUMENT_VERSION,
  MAX_REVIEW_DIFF_ROWS,
  REVIEW_CONTEXT_LINES,
  createDiffContentFingerprint,
  createDiffDocument,
  createUnavailableDiffDocument,
  isSameDiffContentFingerprint,
  projectDiffDocumentRows,
  projectDiffDocumentSummary,
} from './diff-document.ts';
export type {
  CreateDiffDocumentOptions,
  DiffContentFingerprint,
  DiffDisplayRow,
  DiffDocument,
  DiffDocumentSummary,
  DiffUnavailableReason,
  DiffHunk,
  DiffLine,
  ProjectDiffDocumentRowsOptions,
} from './diff-document.ts';
export { DiffWorkerClient, createDiffWorkerTaskKey } from './diff-worker/diff-worker-client.ts';
export type {
  DiffWorkerClientOptions,
  DiffWorkerClientPort,
  DiffWorkerFactory,
  DiffWorkerResponseListener,
  DiffWorkerTransport,
} from './diff-worker/diff-worker-client.ts';
export type { DiffWorkerRequest, DiffWorkerResponse } from './diff-worker/diff-worker-protocol.ts';
export { runDiffWorkerRequest } from './diff-worker/diff-worker-runtime.ts';
export type {
  FileReviewFile,
  FileReviewOperation,
  FileReviewProjectionListener,
  FileReviewProjectionStatus,
  FileReviewProjectionUpdate,
  FileReviewRecord,
  FileReviewTurnSnapshot,
  FileReviewUnavailableReason,
} from './file-review.ts';
export {
  FILE_REVIEW_ARTIFACT_CUSTOM_TYPE,
  FILE_REVIEW_ARTIFACT_V1_VERSION,
  FILE_REVIEW_ARTIFACT_VERSION,
  MAX_REVIEW_ARTIFACT_BYTES,
  MAX_REVIEW_ARTIFACT_FILES,
  MAX_REVIEW_ARTIFACT_ROWS,
  collectCurrentBranchFileReviewArtifacts,
  collectFileReviewArtifacts,
  createFileReviewArtifact,
  decodeFileReviewArtifact,
  isFileReviewArtifact,
  isFileReviewArtifactV1,
  prepareFileReviewArtifactForSession,
} from './file-review-artifact.ts';
export type {
  BoundedFileReviewArtifactResult,
  FileReviewArtifact,
  FileReviewArtifactFile,
  FileReviewArtifactIndex,
  FileReviewArtifactLimitOptions,
  FileReviewArtifactRecord,
  FileReviewArtifactV1,
  FileReviewArtifactV1File,
  FileReviewArtifactV1Record,
} from './file-review-artifact.ts';
export { FileReviewExtensionController } from './file-review-extension.ts';
export type {
  FileReviewExtensionControllerOptions,
  FileReviewUpdatedListener,
} from './file-review-extension.ts';
export { normalizeReviewLineEndings, splitReviewLines } from './review-text.ts';
export {
  addReviewRowTokens,
  applyReviewTokenDiff,
  createReviewIntralineRanges,
  createReviewLineTokens,
  detectReviewLanguage,
} from './review-syntax-tokens.ts';
export type { ReviewTokenizableRow, ReviewTokenRange } from './review-syntax-tokens.ts';

export {
  captureStringSnapshot,
  captureTextSnapshot,
  createUnavailableSnapshot,
  normalizeCapturedReviewText,
} from './mutation-capture-context.ts';
export type {
  CapturedTextSnapshot,
  MutationCaptureScope,
  MutationCaptureState,
  MutationOperation,
  SnapshotUnavailableReason,
} from './mutation-capture-context.ts';
export { MutationCaptureCoordinator } from './mutation-capture-coordinator.ts';
export type {
  MutationCaptureCoordinatorOptions,
  MutationCaptureCoordinatorPort,
  MutationCaptureStateSnapshot,
} from './mutation-capture-coordinator.ts';
export { MutationJournal, normalizeMutationAbsolutePath } from './mutation-journal.ts';
export type {
  AppendMutationInput,
  FinalizeMutationTurnOptions,
  MutationAppendResult,
  MutationJournalListener,
  MutationJournalOptions,
  MutationJournalUpdate,
  MutationProjection,
  MutationRecord,
  TurnFileAggregate,
  MutationToolOutcome,
} from './mutation-journal.ts';
export { withEditReviewCapture } from './review-edit-operations.ts';
export { withWriteReviewCapture } from './review-write-operations.ts';
export { createLocalReviewSnapshotProvider, isErrnoCode } from './review-snapshot-provider.ts';
export type {
  ReviewBaselineResult,
  ReviewFileHandle,
  ReviewSnapshotProvider,
  ReviewSnapshotProviderOptions,
} from './review-snapshot-provider.ts';
