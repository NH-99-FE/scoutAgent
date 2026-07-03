// ============================================================
// Shared 协议基础契约：面板、资源、命令与会话树
// ============================================================

// ---------- Webview 面板 ----------

export type ScoutWebviewSurface = 'chat' | 'settings' | 'tree' | 'changes-review';

// ---------- 来源与工具信息 ----------

export type SourceScope = 'user' | 'project' | 'temporary';
export type SourceOrigin = 'package' | 'top-level';

export interface SourceInfo {
  path: string;
  source: string;
  scope: SourceScope;
  origin: SourceOrigin;
  baseDir?: string;
}

export interface ToolPresentationMetadata {
  /** 工具参数中代表路径的字段名；host 会把这些字段格式化为 display path。 */
  pathArguments?: readonly string[];
}

export interface ToolInfo {
  name: string;
  label?: string;
  description: string;
  parameters: unknown;
  active: boolean;
  presentation?: ToolPresentationMetadata;
  sourceInfo: SourceInfo;
}

// ---------- 命令与诊断 ----------
export type ScoutCommandSource = 'builtin' | 'extension' | 'prompt' | 'skill';

export interface ScoutCommandInfo {
  name: string;
  description?: string;
  source: ScoutCommandSource;
  sourceInfo: SourceInfo;
}

export type ScoutDiagnosticType = 'info' | 'warning' | 'error' | 'collision';

export interface ScoutDiagnostic {
  type: ScoutDiagnosticType;
  message: string;
  path?: string;
  collision?: unknown;
}

// ---------- 会话树 ----------

export type ScoutSessionTreeNodeKind =
  | 'user'
  | 'assistant'
  | 'bashExecution'
  | 'toolResult'
  | 'compaction'
  | 'branchSummary'
  | 'custom';

export type ScoutSessionTreeToolArgument =
  | string
  | number
  | boolean
  | null
  | ScoutSessionTreeToolArgument[]
  | { [key: string]: ScoutSessionTreeToolArgument };

export interface ScoutSessionTreeToolCall {
  id: string;
  name: string;
  arguments: Record<string, ScoutSessionTreeToolArgument>;
  truncated: boolean;
}

export interface ScoutSessionTreeNode {
  id: string;
  parentId: string | null;
  timestamp: string;
  type: string;
  kind?: ScoutSessionTreeNodeKind;
  role?: string;
  toolCall?: ScoutSessionTreeToolCall;
  stopReason?: string;
  errorMessage?: string;
  label?: string;
  labelTimestamp?: string;
  preview?: string;
  children: ScoutSessionTreeNode[];
}

export interface ScoutSessionListItem {
  id: string;
  path: string;
  cwd?: string;
  createdAt: string;
  modifiedAt?: string;
  name?: string;
  messageCount?: number;
  firstMessage?: string;
  parentSessionPath?: string;
  forkPointEntryId?: string;
  isCurrent?: boolean;
}

// ---------- 任务与文件提及 ----------

export type ScoutFileMentionKind = 'file' | 'directory';

export interface ScoutFileMentionItem {
  id: string;
  kind: ScoutFileMentionKind;
  path: string;
  label: string;
  description?: string;
}

export interface ScoutTaskItem {
  id: string;
  sessionId: string;
  sessionPath: string;
  title: string;
  cwd?: string;
  createdAt: string;
  modifiedAt?: string;
  parentSessionPath?: string;
  messageCount?: number;
  isCurrent?: boolean;
}

export type ScoutTaskHistoryPurpose = 'recent' | 'panel';
