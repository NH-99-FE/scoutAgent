// ============================================================
// Tool preview types — 工具预览领域类型
// 负责：定义 core preview service 与 host adapter 之间的稳定领域契约。
// ============================================================

import type {
  Edit,
  EditDiffError,
  EditDiffResult,
  WriteDiffBaseSnapshot,
} from '../tools/shared/edit-diff.ts';

// ---------- Agent message ----------

export type ToolPreviewPhase = 'message_start' | 'message_update' | 'message_end';

export interface ToolPreviewToolCallContent {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ToolPreviewAssistantContent =
  | ToolPreviewToolCallContent
  | { type: string; [key: string]: unknown };

export interface ToolPreviewAssistantMessage {
  role: string;
  content: ToolPreviewAssistantContent[];
}

export type ToolPreviewAgentEvent =
  | { type: 'agent_start' | 'agent_end' }
  | { type: ToolPreviewPhase; message: ToolPreviewAssistantMessage };

export type ToolPreviewMessageEvent = Extract<
  ToolPreviewAgentEvent,
  { message: ToolPreviewAssistantMessage }
>;

// ---------- Context ----------

export interface ToolPreviewToolIdentity {
  active: boolean;
  source: string;
  path: string;
}

export interface ToolPreviewContext {
  generation: number;
  sessionId: string;
  sessionFile?: string;
  cwd: string;
  tools: Partial<Record<string, ToolPreviewToolIdentity>>;
}

// ---------- Dependencies ----------

export type ComputeEditPreview = (
  path: string,
  edits: Edit[],
  cwd: string,
) => Promise<EditDiffResult | EditDiffError>;

export type ComputeWritePreview = (
  path: string,
  content: string,
  cwd: string,
) => Promise<EditDiffResult | EditDiffError>;

export type CaptureWritePreviewBase = (
  path: string,
  cwd: string,
) => Promise<WriteDiffBaseSnapshot | EditDiffError>;

// ---------- Preview model ----------

export interface ToolPreviewFileEdit {
  kind: 'file_edit';
  path: string;
  displayPath: string;
  diff?: string;
  additions: number;
  deletions: number;
  firstChangedLine?: number;
  error?: string;
}

export interface ToolPreviewUpdate {
  sessionId: string;
  sessionFile?: string;
  toolCallId: string;
  toolName: string;
  phase: 'progress' | 'final' | 'error';
  preview: ToolPreviewFileEdit;
}

export interface ToolPreviewServiceOptions {
  getPreviewContext: () => ToolPreviewContext;
  publishUpdate: (update: ToolPreviewUpdate) => void;
  computeEditPreview?: ComputeEditPreview;
  computeWritePreview?: ComputeWritePreview;
  captureWritePreviewBase?: CaptureWritePreviewBase;
  additionalHandlers?: readonly ToolPreviewHandler[];
  handlerOverrides?: readonly ToolPreviewHandler[];
  logError?: (message: string) => void;
}

// ---------- Parsed arguments ----------

export interface ParsedEditInput {
  path: string;
  edits: Edit[];
}

export interface ParsedWriteInput {
  path: string;
  content: string;
}

export interface WriteContentStats {
  hash: string;
  length: number;
  lines: number;
}

// ---------- Handler registry ----------

export interface ToolPreviewRequestSession {
  requestKey: string | undefined;
  latestRequestKey: string | undefined;
  startRequest(key: string): boolean;
  markLatestRequest(key: string): void;
  startProgress(key: string): boolean;
  ensureResource<T>(key: string, create: () => Promise<T>): Promise<T>;
  releaseResource(key: string): void;
  dispose(): void;
}

export interface ToolPreviewRequest {
  readonly key: string;
}

export interface ToolPreviewFinalRequest<T> {
  request: ToolPreviewRequest;
  compute: () => Promise<T>;
  createPreview: (result: T) => ToolPreviewFileEdit;
  createErrorPreview: (message: string) => ToolPreviewFileEdit;
  shouldPublish?: () => boolean;
  onErrorPublished?: (message: string) => void;
  onFinally?: () => void;
}

export interface ToolPreviewController {
  readonly context: ToolPreviewContext;
  readonly phase: ToolPreviewPhase;
  startRequest(argsKey: string): ToolPreviewRequest | undefined;
  trackLatestRequest(argsKey: string): ToolPreviewRequest;
  isCurrentRequest(request: ToolPreviewRequest): boolean;
  isLatestRequest(request: ToolPreviewRequest): boolean;
  publishProgress(progressKey: string, preview: ToolPreviewFileEdit): boolean;
  publishFinal(request: ToolPreviewRequest, preview: ToolPreviewFileEdit): boolean;
  publishError(request: ToolPreviewRequest, preview: ToolPreviewFileEdit): boolean;
  runFinalRequest<T>(input: ToolPreviewFinalRequest<T>): void;
  ensureResource<T>(key: string, create: () => Promise<T>): Promise<T>;
  releaseResource(key: string, request: ToolPreviewRequest): void;
}

export interface ToolPreviewHandlerInput {
  toolCall: ToolPreviewToolCallContent;
  controller: ToolPreviewController;
}

export interface ToolPreviewHandler {
  readonly toolName: string;
  handleToolCall(input: ToolPreviewHandlerInput): void;
}

export type { Edit, EditDiffError, EditDiffResult, WriteDiffBaseSnapshot };
