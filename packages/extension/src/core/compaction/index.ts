// ============================================================
// Extension-local compaction helpers
// 负责：会话压缩准备、摘要生成、分支摘要
// ============================================================

export {
  compact,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  estimateTokens,
  findCutPoint,
  findTurnStartIndex,
  getLastAssistantUsage,
  prepareCompaction,
  shouldCompact,
  calculateContextTokens,
} from './compaction.ts';
export { CompactionError } from './compaction.ts';
export type { CompactionDetails, CompactionErrorCode } from './compaction.ts';
export type { CompactionPreparation, CompactionResult, CompactionSettings } from './compaction.ts';

export {
  collectEntriesForBranchSummary,
  BranchSummaryError,
  generateBranchSummary,
  prepareBranchEntries,
} from './branch-summarization.ts';
export type {
  BranchPreparation,
  BranchSummaryErrorCode,
  BranchSummaryDetails,
  BranchSummaryResult,
  CollectEntriesResult,
  FileOperations,
  TreePreparation,
} from './branch-summarization.ts';
