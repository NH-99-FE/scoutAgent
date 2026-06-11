import type { Api, ImageContent, Model, SimpleStreamOptions, TextContent } from '@scout-agent/ai';
import type { AgentEvent, AgentMessage, AgentTool, QueueMode, ThinkingLevel } from '../index.ts';
import type { Session } from './session/session.ts';

/** 可失败操作的结果。预期失败以 `ok: false` 返回而非抛出。 */
export type Result<TValue, TError> = { ok: true; value: TValue } | { ok: false; error: TError };

/** 创建成功的 {@link Result}。 */
export function ok<TValue, TError>(value: TValue): Result<TValue, TError> {
  return { ok: true, value };
}

/** 创建失败的 {@link Result}。 */
export function err<TValue, TError>(error: TError): Result<TValue, TError> {
  return { ok: false, error };
}

/** 返回成功值或抛出失败错误。用于测试和显式适配器边界。 */
export function getOrThrow<TValue, TError>(result: Result<TValue, TError>): TValue {
  if (!result.ok) throw result.error;
  return result.value;
}

/** 返回成功值或 `undefined`。仅允许对象值以避免原始类型的真值陷阱。 */
export function getOrUndefined<TValue extends object, TError>(
  result: Result<TValue, TError>,
): TValue | undefined {
  return result.ok ? result.value : undefined;
}

/** 将未知抛出值归一化为 Error 实例，用作类型化错误 cause 之前。 */
export function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}

/**
 * 从 `SKILL.md` 文件加载或由应用提供的技能。
 *
 * `name`、`description` 和 `filePath` 以 agentskills.io 建议的 XML 格式块插入系统提示。
 * 使用 {@link formatSkillsForSystemPrompt} 生成规范兼容的系统提示块。
 */
export interface Skill {
  /** 用于查找和模型可见列表的稳定技能名称。 */
  name: string;
  /** 简短的模型可见描述，说明何时使用该技能。 */
  description: string;
  /** 完整的技能指令。 */
  content: string;
  /** 技能文件的绝对路径。用于模型可见的位置和解析相对引用。 */
  filePath: string;
  /** 将此技能从模型可见列表中排除，但仍允许应用显式调用。 */
  disableModelInvocation?: boolean;
}

/** 可格式化为提示的提示模板，用于显式调用。 */
export interface PromptTemplate {
  /** 用于查找或应用命令路由的稳定模板名称。 */
  name: string;
  /** 可选描述，用于命令列表或自动补全。 */
  description?: string;
  /** 模板内容。参数占位符由 `formatPromptTemplateInvocation` 格式化。 */
  content: string;
}

/** 显式调用方法和系统提示回调可访问的资源。 */
export interface AgentHarnessResources<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> {
  /** 可用于显式调用的提示模板。 */
  promptTemplates?: TPromptTemplate[];
  /** 模型和显式技能调用可用的技能。 */
  skills?: TSkill[];
}

/** Harness 拥有的 provider 请求选项，每个 turn 快照一次。运行态字段由 harness 覆盖。 */
export type AgentHarnessStreamOptions = Omit<
  Partial<SimpleStreamOptions>,
  'apiKey' | 'onPayload' | 'onResponse' | 'reasoning' | 'sessionId' | 'signal'
>;

/** provider 钩子返回的每次请求流式选项补丁。 */
export interface AgentHarnessStreamOptionsPatch extends Omit<
  Partial<AgentHarnessStreamOptions>,
  'headers' | 'metadata'
> {
  /** 请求头补丁。`undefined` 值删除键；显式 `headers: undefined` 清除所有头。 */
  headers?: Record<string, string | undefined>;
  /** 元数据补丁。`undefined` 值删除键；显式 `metadata: undefined` 清除所有元数据。 */
  metadata?: Record<string, unknown | undefined>;
}

/** {@link FileSystem} 寻址的文件系统对象类型。符号链接不会自动跟随。 */
export type FileKind = 'file' | 'directory' | 'symlink';

/** {@link FileSystem} 文件操作返回的稳定、后端无关的文件错误码。 */
export type FileErrorCode =
  | 'aborted'
  | 'not_found'
  | 'permission_denied'
  | 'not_directory'
  | 'is_directory'
  | 'invalid'
  | 'not_supported'
  | 'unknown';

/** {@link FileSystem} 文件操作返回的错误。 */
export class FileError extends Error {
  /** 后端无关的错误码。 */
  public code: FileErrorCode;
  /** 与失败关联的绝对寻址路径（如可用）。 */
  public path?: string;

  constructor(code: FileErrorCode, message: string, path?: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'FileError';
    this.code = code;
    this.path = path;
  }
}

/** {@link ExecutionEnv.exec} 返回的稳定、后端无关的执行错误码。 */
export type ExecutionErrorCode =
  | 'aborted'
  | 'timeout'
  | 'shell_unavailable'
  | 'spawn_error'
  | 'callback_error'
  | 'unknown';

/** {@link ExecutionEnv.exec} 返回的错误。 */
export class ExecutionError extends Error {
  /** 后端无关的错误码。 */
  public code: ExecutionErrorCode;

  constructor(code: ExecutionErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ExecutionError';
    this.code = code;
  }
}

/** 压缩辅助函数返回的稳定压缩错误码。 */
export type CompactionErrorCode =
  | 'aborted'
  | 'summarization_failed'
  | 'invalid_session'
  | 'unknown';

/** 压缩辅助函数返回的错误。 */
export class CompactionError extends Error {
  /** 后端无关的错误码。 */
  public code: CompactionErrorCode;

  constructor(code: CompactionErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'CompactionError';
    this.code = code;
  }
}

/** 分支摘要辅助函数返回的稳定错误码。 */
export type BranchSummaryErrorCode = 'aborted' | 'summarization_failed' | 'invalid_session';

/** 分支摘要辅助函数返回的错误。 */
export class BranchSummaryError extends Error {
  /** 后端无关的错误码。 */
  public code: BranchSummaryErrorCode;

  constructor(code: BranchSummaryErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'BranchSummaryError';
    this.code = code;
  }
}

export type SessionErrorCode =
  | 'not_found'
  | 'invalid_session'
  | 'invalid_entry'
  | 'invalid_fork_target'
  | 'storage'
  | 'unknown';

/** 会话存储、仓库和会话树操作抛出的错误。 */
export class SessionError extends Error {
  /** 会话子系统错误码。 */
  public code: SessionErrorCode;

  constructor(code: SessionErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SessionError';
    this.code = code;
  }
}

export type AgentHarnessErrorCode =
  | 'busy'
  | 'invalid_state'
  | 'invalid_argument'
  | 'session'
  | 'hook'
  | 'auth'
  | 'compaction'
  | 'branch_summary'
  | 'unknown';

/** 带有稳定顶级分类的公共 AgentHarness 失败。 */
export class AgentHarnessError extends Error {
  public code: AgentHarnessErrorCode;

  constructor(code: AgentHarnessErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AgentHarnessError';
    this.code = code;
  }
}

/** {@link FileSystem} 中一个文件系统对象的元数据。 */
export interface FileInfo {
  /** {@link path} 的基本名称。 */
  name: string;
  /** 执行环境中的绝对、语法归一化的寻址路径。符号链接不跟随。 */
  path: string;
  /** 对象类型。符号链接目标不跟随；请显式使用 {@link FileSystem.canonicalPath}。 */
  kind: FileKind;
  /** 寻址文件系统对象的字节大小。 */
  size: number;
  /** 修改时间，自 Unix 纪元以来的毫秒数。 */
  mtimeMs: number;
}

/** {@link Shell.exec} 的选项。 */
export interface ExecutionEnvExecOptions {
  /** 命令的工作目录。相对路径相对于 {@link ExecutionEnv.cwd} 解析。默认为 {@link ExecutionEnv.cwd}。 */
  cwd?: string;
  /** 命令的额外环境变量。值覆盖环境默认值。默认无覆盖。 */
  env?: Record<string, string>;
  /** 超时时间（秒）。命令超过此时长时实现应返回超时错误。默认无超时。 */
  timeout?: number;
  /** 用于终止命令的中止信号。默认无中止信号。 */
  abortSignal?: AbortSignal;
  /** 在产生 stdout 块时调用。 */
  onStdout?: (chunk: string) => void;
  /** 在产生 stderr 块时调用。 */
  onStderr?: (chunk: string) => void;
}

/**
 * Harness 使用的文件系统能力。
 *
 * 传入方法的路径可以是绝对路径或相对于 {@link cwd} 的路径。文件操作返回的路径是
 * 文件系统命名空间中的寻址路径，但不会通过符号链接规范化，除非由 {@link canonicalPath} 返回。
 *
 * 操作方法不得抛出异常或 reject。所有文件系统故障（包括意外的后端故障）
 * 必须编码在返回的 {@link Result} 中。实现必须保持此不变式。
 */
export interface FileSystem {
  /** 相对路径的当前工作目录。 */
  cwd: string;

  /** 返回绝对寻址路径，不要求路径存在且不解析符号链接。 */
  absolutePath(path: string, abortSignal?: AbortSignal): Promise<Result<string, FileError>>;
  /** 在文件系统命名空间中连接路径段，不要求结果存在。 */
  joinPath(parts: string[], abortSignal?: AbortSignal): Promise<Result<string, FileError>>;
  /** 读取 UTF-8 文本文件。 */
  readTextFile(path: string, abortSignal?: AbortSignal): Promise<Result<string, FileError>>;
  /** 读取 UTF-8 文本行。实现应在读取 `maxLines` 行后停止。 */
  readTextLines(
    path: string,
    options?: { maxLines?: number; abortSignal?: AbortSignal },
  ): Promise<Result<string[], FileError>>;
  /** 读取二进制文件。 */
  readBinaryFile(path: string, abortSignal?: AbortSignal): Promise<Result<Uint8Array, FileError>>;
  /** 创建或覆盖文件，支持时创建父目录。 */
  writeFile(
    path: string,
    content: string | Uint8Array,
    abortSignal?: AbortSignal,
  ): Promise<Result<void, FileError>>;
  /** 创建或追加文件，支持时创建父目录。 */
  appendFile(
    path: string,
    content: string | Uint8Array,
    abortSignal?: AbortSignal,
  ): Promise<Result<void, FileError>>;
  /** 返回寻址路径的元数据，不跟随符号链接。 */
  fileInfo(path: string, abortSignal?: AbortSignal): Promise<Result<FileInfo, FileError>>;
  /** 列出目录的直接子项，不跟随符号链接。 */
  listDir(path: string, abortSignal?: AbortSignal): Promise<Result<FileInfo[], FileError>>;
  /** 返回现有路径的规范路径，支持时解析符号链接。 */
  canonicalPath(path: string, abortSignal?: AbortSignal): Promise<Result<string, FileError>>;
  /** 路径不存在时返回 false。其他错误（如权限失败）返回 {@link FileError}。 */
  exists(path: string, abortSignal?: AbortSignal): Promise<Result<boolean, FileError>>;
  /** 创建目录。默认：`recursive: true`，无中止信号。 */
  createDir(
    path: string,
    options?: { recursive?: boolean; abortSignal?: AbortSignal },
  ): Promise<Result<void, FileError>>;
  /** 删除文件或目录。默认：`recursive: false`、`force: false`，无中止信号。 */
  remove(
    path: string,
    options?: { recursive?: boolean; force?: boolean; abortSignal?: AbortSignal },
  ): Promise<Result<void, FileError>>;
  /** 创建临时目录并返回其绝对路径。默认：`prefix: "tmp-"`，无中止信号。 */
  createTempDir(prefix?: string, abortSignal?: AbortSignal): Promise<Result<string, FileError>>;
  /** 创建临时文件并返回其绝对路径。默认：`prefix: ""`、`suffix: ""`，无中止信号。 */
  createTempFile(options?: {
    prefix?: string;
    suffix?: string;
    abortSignal?: AbortSignal;
  }): Promise<Result<string, FileError>>;

  /** 释放文件系统资源。必须尽力执行且不得抛出异常或 reject。 */
  cleanup(): Promise<void>;
}

/** Harness 使用的 Shell 执行能力。 */
export interface Shell {
  /** 在 {@link FileSystem.cwd} 中执行 shell 命令，除非提供 `options.cwd`。 */
  exec(
    command: string,
    options?: ExecutionEnvExecOptions,
  ): Promise<Result<{ stdout: string; stderr: string; exitCode: number }, ExecutionError>>;
  /** 释放 Shell 资源。必须尽力执行且不得抛出异常或 reject。 */
  cleanup(): Promise<void>;
}

/** Harness 使用的文件系统和进程执行环境。 */
export interface ExecutionEnv extends FileSystem, Shell {}

export interface SessionTreeEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface MessageEntry extends SessionTreeEntryBase {
  type: 'message';
  message: AgentMessage;
}

export interface ThinkingLevelChangeEntry extends SessionTreeEntryBase {
  type: 'thinking_level_change';
  thinkingLevel: string;
}

export interface ModelChangeEntry extends SessionTreeEntryBase {
  type: 'model_change';
  provider: string;
  modelId: string;
}

export interface CompactionEntry<T = unknown> extends SessionTreeEntryBase {
  type: 'compaction';
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: T;
  fromHook?: boolean;
}

export interface BranchSummaryEntry<T = unknown> extends SessionTreeEntryBase {
  type: 'branch_summary';
  fromId: string;
  summary: string;
  details?: T;
  fromHook?: boolean;
}

export interface CustomEntry<T = unknown> extends SessionTreeEntryBase {
  type: 'custom';
  customType: string;
  data?: T;
}

export interface CustomMessageEntry<T = unknown> extends SessionTreeEntryBase {
  type: 'custom_message';
  customType: string;
  content: string | (TextContent | ImageContent)[];
  details?: T;
  display: boolean;
}

export interface LabelEntry extends SessionTreeEntryBase {
  type: 'label';
  targetId: string;
  label: string | undefined;
}

export interface SessionInfoEntry extends SessionTreeEntryBase {
  type: 'session_info'; // 遗留名称，保留以兼容
  name?: string;
}

export interface LeafEntry extends SessionTreeEntryBase {
  type: 'leaf';
  targetId: string | null;
}

export type SessionTreeEntry =
  | MessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry
  | CustomMessageEntry
  | LabelEntry
  | SessionInfoEntry
  | LeafEntry;

export interface SessionContext {
  messages: AgentMessage[];
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
}

export interface SessionMetadata {
  id: string;
  createdAt: string;
}

export interface JsonlSessionMetadata extends SessionMetadata {
  cwd: string;
  path: string;
  parentSessionPath?: string;
}

export interface SessionStorage<TMetadata extends SessionMetadata = SessionMetadata> {
  getMetadata(): Promise<TMetadata>;
  getLeafId(): Promise<string | null>;
  /** 持久化记录活跃会话树叶子节点的条目。 */
  setLeafId(leafId: string | null): Promise<void>;
  createEntryId(): Promise<string>;
  appendEntry(entry: SessionTreeEntry): Promise<void>;
  getEntry(id: string): Promise<SessionTreeEntry | undefined>;
  findEntries<TType extends SessionTreeEntry['type']>(
    type: TType,
  ): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>>;
  getLabel(id: string): Promise<string | undefined>;
  getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]>;
  getEntries(): Promise<SessionTreeEntry[]>;
}

export type { Session } from './session/session.ts';

export interface SessionCreateOptions {
  id?: string;
}

export interface SessionForkOptions {
  entryId?: string;
  position?: 'before' | 'at';
  id?: string;
}

export interface SessionRepo<
  TMetadata extends SessionMetadata = SessionMetadata,
  TCreateOptions extends SessionCreateOptions = SessionCreateOptions,
  TListOptions = void,
> {
  create(options: TCreateOptions): Promise<Session<TMetadata>>;
  open(metadata: TMetadata): Promise<Session<TMetadata>>;
  list(options?: TListOptions): Promise<TMetadata[]>;
  delete(metadata: TMetadata): Promise<void>;
  fork(
    source: TMetadata,
    options: SessionForkOptions & TCreateOptions,
  ): Promise<Session<TMetadata>>;
}

export interface JsonlSessionCreateOptions extends SessionCreateOptions {
  cwd: string;
  parentSessionPath?: string;
}

export interface JsonlSessionListOptions {
  cwd?: string;
}

export type JsonlSessionRepoApi = SessionRepo<
  JsonlSessionMetadata,
  JsonlSessionCreateOptions,
  JsonlSessionListOptions
>;

export type AgentHarnessPhase = 'idle' | 'turn' | 'compaction' | 'branch_summary' | 'retry';

export type PendingSessionWrite = SessionTreeEntry extends infer TEntry
  ? TEntry extends SessionTreeEntry
    ? Omit<TEntry, 'id' | 'parentId' | 'timestamp'>
    : never
  : never;

export interface QueueUpdateEvent {
  type: 'queue_update';
  steer: AgentMessage[];
  followUp: AgentMessage[];
  nextTurn: AgentMessage[];
}

export interface SavePointEvent {
  type: 'save_point';
  hadPendingMutations: boolean;
}

export interface AbortEvent {
  type: 'abort';
  clearedSteer: AgentMessage[];
  clearedFollowUp: AgentMessage[];
}

export interface SettledEvent {
  type: 'settled';
  nextTurnCount: number;
}

export interface BeforeAgentStartEvent<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> {
  type: 'before_agent_start';
  prompt: string;
  images?: ImageContent[];
  systemPrompt: string;
  resources: AgentHarnessResources<TSkill, TPromptTemplate>;
}

export interface ContextEvent {
  type: 'context';
  messages: AgentMessage[];
}

export interface BeforeProviderRequestEvent {
  type: 'before_provider_request';
  model: Model<Api>;
  sessionId: string;
  streamOptions: AgentHarnessStreamOptions;
}

export interface BeforeProviderPayloadEvent {
  type: 'before_provider_payload';
  model: Model<Api>;
  payload: unknown;
}

export interface AfterProviderResponseEvent {
  type: 'after_provider_response';
  status: number;
  headers: Record<string, string>;
}

export interface ToolCallEvent {
  type: 'tool_call';
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: 'tool_result';
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  content: Array<TextContent | ImageContent>;
  details: unknown;
  isError: boolean;
}

export interface SessionBeforeCompactEvent {
  type: 'session_before_compact';
  preparation: CompactionPreparation;
  branchEntries: SessionTreeEntry[];
  customInstructions?: string;
  signal: AbortSignal;
}

export interface SessionCompactEvent {
  type: 'session_compact';
  compactionEntry: CompactionEntry;
  fromHook: boolean;
}

export interface SessionBeforeTreeEvent {
  type: 'session_before_tree';
  preparation: TreePreparation;
  signal: AbortSignal;
}

export interface SessionTreeEvent {
  type: 'session_tree';
  newLeafId: string | null;
  oldLeafId: string | null;
  summaryEntry?: BranchSummaryEntry;
  fromHook?: boolean;
}

export interface ModelSelectEvent {
  type: 'model_select';
  model: Model<Api>;
  previousModel: Model<Api> | undefined;
  source: 'set' | 'restore';
}

export interface ThinkingLevelSelectEvent {
  type: 'thinking_level_select';
  level: ThinkingLevel;
  previousLevel: ThinkingLevel;
}

export interface ResourcesUpdateEvent<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> {
  type: 'resources_update';
  resources: AgentHarnessResources<TSkill, TPromptTemplate>;
  previousResources: AgentHarnessResources<TSkill, TPromptTemplate>;
}

export type AgentHarnessOwnEvent<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> =
  | QueueUpdateEvent
  | SavePointEvent
  | AbortEvent
  | SettledEvent
  | BeforeAgentStartEvent<TSkill, TPromptTemplate>
  | ContextEvent
  | BeforeProviderRequestEvent
  | BeforeProviderPayloadEvent
  | AfterProviderResponseEvent
  | ToolCallEvent
  | ToolResultEvent
  | SessionBeforeCompactEvent
  | SessionCompactEvent
  | SessionBeforeTreeEvent
  | SessionTreeEvent
  | ModelSelectEvent
  | ThinkingLevelSelectEvent
  | ResourcesUpdateEvent<TSkill, TPromptTemplate>;

export type AgentHarnessEvent<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> = AgentEvent | AgentHarnessOwnEvent<TSkill, TPromptTemplate>;

export interface BeforeAgentStartResult {
  messages?: AgentMessage[];
  systemPrompt?: string;
}

export interface ContextResult {
  messages: AgentMessage[];
}

export interface BeforeProviderRequestResult {
  streamOptions?: AgentHarnessStreamOptionsPatch;
}

export interface BeforeProviderPayloadResult {
  payload: unknown;
}

export interface MessageEndResult {
  message?: AgentMessage;
}

export interface ToolCallResult {
  block?: boolean;
  reason?: string;
}

export interface ToolResultPatch {
  content?: Array<TextContent | ImageContent>;
  details?: unknown;
  isError?: boolean;
  terminate?: boolean;
}

export interface SessionBeforeCompactResult {
  cancel?: boolean;
  compaction?: CompactResult;
}

export interface SessionBeforeTreeResult {
  cancel?: boolean;
  summary?: { summary: string; details?: unknown };
  customInstructions?: string;
  replaceInstructions?: boolean;
  label?: string;
}

export type AgentHarnessEventResultMap = {
  message_end: MessageEndResult | undefined;
  before_agent_start: BeforeAgentStartResult | undefined;
  context: ContextResult | undefined;
  before_provider_request: BeforeProviderRequestResult | undefined;
  before_provider_payload: BeforeProviderPayloadResult | undefined;
  after_provider_response: undefined;
  tool_call: ToolCallResult | undefined;
  tool_result: ToolResultPatch | undefined;
  session_before_compact: SessionBeforeCompactResult | undefined;
  session_compact: undefined;
  session_before_tree: SessionBeforeTreeResult | undefined;
  session_tree: undefined;
  model_select: undefined;
  thinking_level_select: undefined;
  resources_update: undefined;
  queue_update: undefined;
  save_point: undefined;
  abort: undefined;
  settled: undefined;
};

export interface AgentHarnessPromptOptions {
  images?: ImageContent[];
}

export interface AbortResult {
  clearedSteer: AgentMessage[];
  clearedFollowUp: AgentMessage[];
}

export interface CompactResult {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
}

export interface NavigateTreeResult {
  cancelled: boolean;
  editorText?: string;
  summaryEntry?: BranchSummaryEntry;
}

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export interface CompactionPreparation {
  firstKeptEntryId: string;
  messagesToSummarize: AgentMessage[];
  turnPrefixMessages: AgentMessage[];
  isSplitTurn: boolean;
  tokensBefore: number;
  previousSummary?: string;
  fileOps: FileOperations;
  settings: CompactionSettings;
}

export interface FileOperations {
  read: Set<string>;
  written: Set<string>;
  edited: Set<string>;
}

export interface TreePreparation {
  targetId: string;
  oldLeafId: string | null;
  commonAncestorId: string | null;
  entriesToSummarize: SessionTreeEntry[];
  userWantsSummary: boolean;
  customInstructions?: string;
  replaceInstructions?: boolean;
  label?: string;
}

export interface GenerateBranchSummaryOptions {
  model: Model<Api>;
  apiKey: string;
  headers?: Record<string, string>;
  signal: AbortSignal;
  customInstructions?: string;
  replaceInstructions?: boolean;
  reserveTokens?: number;
}

export interface BranchSummaryResult {
  summary: string;
  readFiles: string[];
  modifiedFiles: string[];
}

export interface AgentHarnessOptions<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
  TTool extends AgentTool = AgentTool,
> {
  env: ExecutionEnv;
  session: Session;
  tools?: TTool[];
  /**
   * 显式调用方法和系统提示回调可访问的具体资源。
   * 应用负责加载/重载资源，并应调用 `setResources()` 更新值。
   */
  resources?: AgentHarnessResources<TSkill, TPromptTemplate>;
  systemPrompt?:
    | string
    | ((context: {
        env: ExecutionEnv;
        session: Session;
        model: Model<Api>;
        thinkingLevel: ThinkingLevel;
        activeTools: TTool[];
        resources: AgentHarnessResources<TSkill, TPromptTemplate>;
      }) => string | Promise<string>);
  getApiKeyAndHeaders?: (
    model: Model<Api>,
  ) => Promise<{ apiKey: string; headers?: Record<string, string> } | undefined>;
  /** 精选的流式/provider 请求选项。在 turn 开始时快照。 */
  streamOptions?: AgentHarnessStreamOptions;
  model: Model<Api>;
  thinkingLevel?: ThinkingLevel;
  activeToolNames?: string[];
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
}

export type { AgentHarness } from './agent-harness.ts';
