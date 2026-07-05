// ============================================================
// Write tool preview handler — write 工具预览策略
// 负责：发布 streaming progress、复用写入前 baseline 并生成最终 diff。
// ============================================================

import { computeWriteDiffFromBase } from '../tools/shared/edit-diff.ts';
import { parseWriteToolCallArguments } from './argument-parsing.ts';
import {
  canPreviewBuiltinTool,
  collectWriteContentStats,
  createFileEditErrorPreview,
  createFileEditPreview,
  createWriteArgsKey,
  formatPreviewPath,
  resolvePreviewPath,
} from './preview-format.ts';
import type {
  CaptureWritePreviewBase,
  ComputeWritePreview,
  EditDiffError,
  EditDiffResult,
  ParsedWriteInput,
  ToolPreviewController,
  ToolPreviewHandler,
  ToolPreviewHandlerInput,
  WriteDiffBaseSnapshot,
} from './types.ts';

// ---------- Factory ----------

export function createWritePreviewHandler(options: {
  captureWritePreviewBase: CaptureWritePreviewBase;
  computeWritePreview?: ComputeWritePreview;
  logError?: (message: string) => void;
}): ToolPreviewHandler {
  return new WritePreviewHandler(
    options.captureWritePreviewBase,
    options.computeWritePreview,
    options.logError,
  );
}

// ---------- Handler ----------

class WritePreviewHandler implements ToolPreviewHandler {
  readonly toolName = 'write';
  private readonly captureWritePreviewBase: CaptureWritePreviewBase;
  private readonly computeWritePreview?: ComputeWritePreview;
  private readonly logError?: (message: string) => void;

  constructor(
    captureWritePreviewBase: CaptureWritePreviewBase,
    computeWritePreview?: ComputeWritePreview,
    logError?: (message: string) => void,
  ) {
    this.captureWritePreviewBase = captureWritePreviewBase;
    this.computeWritePreview = computeWritePreview;
    this.logError = logError;
  }

  handleToolCall({ toolCall, controller }: ToolPreviewHandlerInput): void {
    const previewContext = controller.context;
    if (!canPreviewBuiltinTool(previewContext, this.toolName)) return;

    const parsed = parseWriteToolCallArguments(toolCall.arguments);
    if (!parsed) return;

    const contentStats = collectWriteContentStats(parsed.content);
    const requestArgsKey = createWriteArgsKey(parsed, contentStats);
    controller.trackLatestRequest(requestArgsKey);

    const previewPath = resolvePreviewPath(parsed.path, previewContext.cwd);
    const displayPath = formatPreviewPath(parsed.path, previewContext.cwd);

    if (!this.computeWritePreview) {
      void this.ensureWriteBaseSnapshot(controller, parsed.path);
    }
    publishWriteProgressPreview(controller, {
      path: previewPath,
      displayPath,
      additions: contentStats.lines,
    });

    if (controller.phase !== 'message_end') return;
    const request = controller.startRequest(requestArgsKey);
    if (!request) return;

    controller.runFinalRequest({
      request,
      compute: () => this.computeWritePreviewResult(controller, parsed),
      createPreview: (result) => createFileEditPreview(previewPath, displayPath, result),
      createErrorPreview: (message) =>
        createFileEditErrorPreview(previewPath, displayPath, message),
      shouldPublish: () => controller.isLatestRequest(request),
      onErrorPublished: (message) => this.logError?.(`[scout] Write preview failed: ${message}`),
      onFinally: () => controller.releaseResource(createWriteBaseResourceKey(parsed.path), request),
    });
  }

  private async computeWritePreviewResult(
    controller: ToolPreviewController,
    parsed: ParsedWriteInput,
  ): Promise<EditDiffResult | EditDiffError> {
    if (this.computeWritePreview) {
      return this.computeWritePreview(parsed.path, parsed.content, controller.context.cwd);
    }

    const base = await this.ensureWriteBaseSnapshot(controller, parsed.path);
    if ('error' in base) return base;
    return computeWriteDiffFromBase(parsed.path, parsed.content, base);
  }

  private ensureWriteBaseSnapshot(
    controller: ToolPreviewController,
    path: string,
  ): Promise<WriteDiffBaseSnapshot | EditDiffError> {
    return controller.ensureResource(createWriteBaseResourceKey(path), () =>
      this.captureWritePreviewBase(path, controller.context.cwd),
    );
  }
}

// ---------- Helpers ----------

function createWriteBaseResourceKey(path: string): string {
  return `write-base:${path}`;
}

function publishWriteProgressPreview(
  controller: ToolPreviewController,
  input: {
    path: string;
    displayPath: string;
    additions: number;
  },
): void {
  controller.publishProgress(`${input.path}\n${input.additions}`, {
    kind: 'file_edit',
    path: input.path,
    displayPath: input.displayPath,
    additions: input.additions,
    deletions: 0,
  });
}
