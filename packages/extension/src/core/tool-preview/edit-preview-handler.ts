// ============================================================
// Edit tool preview handler — edit 工具预览策略
// 负责：解析 edit 参数并发布最终 diff 预览。
// ============================================================

import { parseEditToolCallArguments } from './argument-parsing.ts';
import {
  canPreviewBuiltinTool,
  createEditArgsKey,
  createFileEditErrorPreview,
  createFileEditPreview,
  formatPreviewPath,
} from './preview-format.ts';
import type { ComputeEditPreview, ToolPreviewHandler, ToolPreviewHandlerInput } from './types.ts';

// ---------- Factory ----------

export function createEditPreviewHandler(options: {
  computeEditPreview: ComputeEditPreview;
  logError?: (message: string) => void;
}): ToolPreviewHandler {
  return new EditPreviewHandler(options.computeEditPreview, options.logError);
}

// ---------- Handler ----------

class EditPreviewHandler implements ToolPreviewHandler {
  readonly toolName = 'edit';
  private readonly computeEditPreview: ComputeEditPreview;
  private readonly logError?: (message: string) => void;

  constructor(computeEditPreview: ComputeEditPreview, logError?: (message: string) => void) {
    this.computeEditPreview = computeEditPreview;
    this.logError = logError;
  }

  handleToolCall({ toolCall, controller }: ToolPreviewHandlerInput): void {
    const previewContext = controller.context;
    if (!canPreviewBuiltinTool(previewContext, this.toolName)) return;

    const parsed = parseEditToolCallArguments(toolCall.arguments);
    if (!parsed) return;

    const request = controller.startRequest(createEditArgsKey(parsed));
    if (!request) return;

    const displayPath = formatPreviewPath(parsed.path, previewContext.cwd);

    controller.runFinalRequest({
      request,
      compute: () => this.computeEditPreview(parsed.path, parsed.edits, previewContext.cwd),
      createPreview: (result) => createFileEditPreview(parsed.path, displayPath, result),
      createErrorPreview: (message) =>
        createFileEditErrorPreview(parsed.path, displayPath, message),
      onErrorPublished: (message) => this.logError?.(`[scout] Edit preview failed: ${message}`),
    });
  }
}
