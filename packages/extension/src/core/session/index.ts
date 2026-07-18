// ============================================================
// Extension-local session subsystem
// 负责：会话树、JSONL 持久化与上下文构建
// ============================================================

export {
  CURRENT_SESSION_VERSION,
  SessionManager,
  assertValidSessionId,
  buildSessionContext,
  findMostRecentSession,
  getLatestCompactionEntry,
  loadEntriesFromFile,
  migrateSessionEntries,
  parseSessionEntries,
} from '../session-manager.ts';
export { createDefaultSessionExportFileName, readSessionFileInfo } from '../session-file.ts';
export { extractSessionTextContent } from './content-text.ts';
export type { DefaultSessionExportFileNameOptions } from '../session-file.ts';
export type { SessionTextContent, SessionTextContentPart } from './content-text.ts';
export type {
  BranchedSessionResult,
  BranchSummaryEntry,
  CompactionEntry,
  CustomEntry,
  CustomMessageEntry,
  FileEntry,
  JsonlSessionMetadata,
  LabelEntry,
  MessageEntry,
  ModelChangeEntry,
  NewSessionOptions,
  ReadonlySessionManager,
  SessionContext,
  SessionEntry,
  SessionHeader,
  SessionInfo,
  SessionMessageEntry,
  SessionTreeEntry,
  SessionTreeNode,
  ThinkingLevelChangeEntry,
} from '../session-manager.ts';
export type { SessionManager as Session } from '../session-manager.ts';
