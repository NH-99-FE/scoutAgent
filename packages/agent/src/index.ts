// ============================================================
// @scout-agent/agent — 公开 API
// ============================================================

// Core Agent
export * from './agent.ts';
// Loop functions
export * from './agent-loop.ts';
// Harness
export * from './harness/agent-harness.ts';
export {
  type BranchPreparation,
  type BranchSummaryDetails,
  type CollectEntriesResult,
  collectEntriesForBranchSummary,
  generateBranchSummary,
  prepareBranchEntries,
} from './harness/compaction/branch-summarization.ts';
export {
  type ContextUsageEstimate,
  calculateContextTokens,
  compact,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  estimateTokens,
  findCutPoint,
  findTurnStartIndex,
  generateSummary,
  getLastAssistantUsage,
  prepareCompaction,
  serializeConversation,
  shouldCompact,
} from './harness/compaction/compaction.ts';
export * from './harness/messages.ts';
export * from './harness/prompt-templates.ts';
export * from './harness/session/jsonl-repo.ts';
export * from './harness/session/memory-repo.ts';
export * from './harness/session/repo-utils.ts';
export * from './harness/session/session.ts';
export { uuidv7 } from './harness/session/uuid.ts';
export * from './harness/skill-metadata.ts';
export * from './harness/skills.ts';
export * from './harness/system-prompt.ts';
export * from './harness/env/nodejs.ts';
export * from './harness/types.ts';
export * from './harness/utils/shell-output.ts';
export * from './harness/utils/truncate.ts';
// Types
export * from './types.ts';
