// ============================================================
// Extension core barrel
// 负责：导出与 Pi coding-agent core 对齐的核心运行态模块。
// ============================================================

export { AgentSession, type AgentSessionEvent, type NavigateTreeResult } from './agent-session.ts';
export {
  AgentSessionRuntime,
  createAgentSessionRuntime,
  type AgentSessionReplacementResult,
  type AgentSessionRuntimeDiagnostic,
  type CreateAgentSessionRuntimeFactory,
  type CreateAgentSessionRuntimeOptions,
  type CreateAgentSessionRuntimeResult,
} from './agent-session-runtime.ts';
export {
  MissingSessionCwdError,
  assertSessionCwdExists,
  formatMissingSessionCwdError,
  getMissingSessionCwdIssue,
  isPathInsideOrEqual,
  resolveSessionCwdPolicy,
  type SessionCwdIssue,
  type SessionCwdPolicyDecision,
  type SessionCwdPolicyInput,
} from './session-cwd.ts';
export {
  createAgentSessionFromServices,
  createAgentSessionServices,
  type AgentSessionServices,
  type CreateAgentSessionFromServicesOptions,
  type CreateAgentSessionServicesOptions,
} from './agent-session-services.ts';
export {
  SessionManager as CoreSessionManager,
  buildSessionContext,
  type JsonlSessionMetadata,
  type Session,
} from './session/index.ts';
export {
  readSessionFileInfo,
  copySessionFileIntoSessionDir,
  type SessionFileInfo,
} from './session-file.ts';
export { ScoutResourceLoader, loadProjectContextFiles } from './resource-loader.ts';
export { buildSystemPrompt } from './system-prompt.ts';
export {
  DEFAULT_REASONING_THINKING_LEVEL,
  normalizeThinkingLevelForModel,
  normalizeThinkingLevelForModelSwitch,
} from './thinking-level.ts';
export { loadSkills, formatSkillsForPrompt, type Skill } from './skills.ts';
export { createSyntheticSourceInfo, type SourceInfo } from './source-info.ts';
export type { CoreDisposable, CoreLogger } from './logger.ts';
export type {
  BranchSummarySettings,
  ProviderRetrySettings,
  RetrySettings,
  ScoutCoreConfig,
  ScoutStreamOptions,
} from './config.ts';
export {
  ScoutModelRegistry,
  type AvailableModel,
  type ScoutModelRegistryOptions,
} from './model-registry.ts';
export { ScoutModelResolver, type ModelResolution } from './model-resolver.ts';
export * from './compaction/index.ts';
export * from './extensions/index.ts';
export * from './tools/index.ts';
