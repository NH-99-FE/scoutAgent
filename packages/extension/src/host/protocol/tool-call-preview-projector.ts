// ============================================================
// Tool call preview projector — 工具调用预览事件投影
// 负责：从 assistant 流式 toolCall 中提取只读预览，不改变工具执行语义。
// ============================================================

import type {
  ExtensionEventMessage,
  ScoutAgentEvent,
  ScoutFileEditPreview,
  ScoutMessage,
  ScoutToolCallContent,
} from '@scout-agent/shared';
import {
  computeEditsDiff,
  type Edit,
  type EditDiffError,
  type EditDiffResult,
} from '../../core/tools/shared/edit-diff.ts';

// ---------- 类型 ----------

export type ComputeEditPreview = (
  path: string,
  edits: Edit[],
  cwd: string,
) => Promise<EditDiffResult | EditDiffError>;

export interface ToolCallPreviewToolIdentity {
  active: boolean;
  source: string;
  path: string;
}

export interface ToolCallPreviewContext {
  generation: number;
  sessionId: string;
  sessionFile?: string;
  cwd: string;
  editTool?: ToolCallPreviewToolIdentity;
}

export interface ToolCallPreviewProjectorOptions {
  getPreviewContext: () => ToolCallPreviewContext;
  publishEvent: (message: ExtensionEventMessage) => void;
  computeEditPreview?: ComputeEditPreview;
  logError?: (message: string) => void;
}

interface ParsedEditInput {
  path: string;
  edits: Edit[];
}

// ---------- Projector ----------

export class ToolCallPreviewProjector {
  private readonly getPreviewContext: () => ToolCallPreviewContext;
  private readonly publishEvent: (message: ExtensionEventMessage) => void;
  private readonly computeEditPreview: ComputeEditPreview;
  private readonly logError?: (message: string) => void;
  private readonly requestedKeysByToolCallId = new Map<string, string>();
  private runVersion = 0;

  constructor(options: ToolCallPreviewProjectorOptions) {
    this.getPreviewContext = options.getPreviewContext;
    this.publishEvent = options.publishEvent;
    this.computeEditPreview = options.computeEditPreview ?? computeEditsDiff;
    this.logError = options.logError;
  }

  handleAgentEvent(event: ScoutAgentEvent): void {
    if (event.type === 'agent_start' || event.type === 'agent_end') {
      this.reset();
      return;
    }

    if (
      event.type !== 'message_start' &&
      event.type !== 'message_update' &&
      event.type !== 'message_end'
    ) {
      return;
    }

    this.projectMessage(event.message);
  }

  private reset(): void {
    this.runVersion += 1;
    this.requestedKeysByToolCallId.clear();
  }

  private projectMessage(message: ScoutMessage): void {
    if (message.role !== 'assistant') return;

    for (const content of message.content) {
      if (content.type !== 'toolCall' || content.name !== 'edit') continue;
      this.projectEditToolCall(content);
    }
  }

  private projectEditToolCall(toolCall: ScoutToolCallContent): void {
    const previewContext = this.getPreviewContext();
    if (!canPreviewBuiltinEdit(previewContext)) return;

    const parsed = parseEditToolCallArguments(toolCall.arguments);
    if (!parsed) return;

    const argsKey = createArgsKey(parsed);
    const contextKey = createEditPreviewContextKey(previewContext);
    const requestKey = `${contextKey}\n${argsKey}`;
    if (this.requestedKeysByToolCallId.get(toolCall.id) === requestKey) return;

    const runVersion = this.runVersion;
    this.requestedKeysByToolCallId.set(toolCall.id, requestKey);

    void this.computeEditPreview(parsed.path, parsed.edits, previewContext.cwd)
      .then((result) => {
        if (
          this.runVersion !== runVersion ||
          this.requestedKeysByToolCallId.get(toolCall.id) !== requestKey ||
          createEditPreviewContextKey(this.getPreviewContext()) !== contextKey
        ) {
          return;
        }

        this.publishEvent({
          type: 'tool_call_preview_update',
          sessionId: previewContext.sessionId,
          sessionFile: previewContext.sessionFile,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          preview: createFileEditPreview(parsed.path, result),
        });
      })
      .catch((error: unknown) => {
        if (
          this.runVersion !== runVersion ||
          this.requestedKeysByToolCallId.get(toolCall.id) !== requestKey ||
          createEditPreviewContextKey(this.getPreviewContext()) !== contextKey
        ) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        this.logError?.(`[scout] Edit preview failed: ${message}`);
        this.publishEvent({
          type: 'tool_call_preview_update',
          sessionId: previewContext.sessionId,
          sessionFile: previewContext.sessionFile,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          preview: {
            kind: 'file_edit',
            path: parsed.path,
            additions: 0,
            deletions: 0,
            error: message,
          },
        });
      });
  }
}

function canPreviewBuiltinEdit(context: ToolCallPreviewContext): boolean {
  return (
    context.sessionId.trim().length > 0 &&
    context.editTool?.active === true &&
    context.editTool.source === 'builtin' &&
    context.editTool.path === '<builtin:edit>'
  );
}

function createEditPreviewContextKey(context: ToolCallPreviewContext): string {
  const editTool = context.editTool;
  return [
    String(context.generation),
    context.sessionId,
    context.sessionFile ?? '',
    context.cwd,
    editTool?.active ? 'active' : 'inactive',
    editTool?.source ?? '',
    editTool?.path ?? '',
  ].join('\u0000');
}

// ---------- 参数解析 ----------

export function parseEditToolCallArguments(
  args: Record<string, unknown>,
): ParsedEditInput | undefined {
  const path = typeof args.path === 'string' ? args.path.trim() : '';
  if (!path) return undefined;

  const edits = parseEditArray(args.edits);
  if (typeof args.oldText === 'string' && typeof args.newText === 'string') {
    edits.push({ oldText: args.oldText, newText: args.newText });
  }

  return edits.length > 0 ? { path, edits } : undefined;
}

function parseEditArray(value: unknown): Edit[] {
  const parsedValue = typeof value === 'string' ? parseJsonArray(value) : value;
  if (!Array.isArray(parsedValue)) return [];

  const edits: Edit[] = [];
  for (const item of parsedValue) {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    if (typeof record.oldText !== 'string' || typeof record.newText !== 'string') return [];
    edits.push({ oldText: record.oldText, newText: record.newText });
  }
  return edits;
}

function parseJsonArray(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function createArgsKey(input: ParsedEditInput): string {
  return JSON.stringify(input);
}

// ---------- Preview ----------

function createFileEditPreview(
  path: string,
  result: EditDiffResult | EditDiffError,
): ScoutFileEditPreview {
  if ('error' in result) {
    return {
      kind: 'file_edit',
      path,
      additions: 0,
      deletions: 0,
      error: result.error,
    };
  }

  const stats = countDiffStats(result.diff);
  return {
    kind: 'file_edit',
    path,
    diff: result.diff,
    additions: stats.additions,
    deletions: stats.deletions,
    firstChangedLine: result.firstChangedLine,
  };
}

function countDiffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }

  return { additions, deletions };
}
