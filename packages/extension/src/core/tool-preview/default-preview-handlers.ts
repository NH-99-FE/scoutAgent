// ============================================================
// Default preview handlers — 内置工具预览策略注册
// 负责：组装 edit/write 默认 handler，供 ToolPreviewService 注册。
// ============================================================

import { createEditPreviewHandler } from './edit-preview-handler.ts';
import { createWritePreviewHandler } from './write-preview-handler.ts';
import type {
  CaptureWritePreviewBase,
  ComputeEditPreview,
  ComputeWritePreview,
  ToolPreviewHandler,
} from './types.ts';

// ---------- Factory ----------

export function createDefaultToolPreviewHandlers(options: {
  computeEditPreview: ComputeEditPreview;
  captureWritePreviewBase: CaptureWritePreviewBase;
  computeWritePreview?: ComputeWritePreview;
  logError?: (message: string) => void;
}): ToolPreviewHandler[] {
  return [
    createEditPreviewHandler({
      computeEditPreview: options.computeEditPreview,
      logError: options.logError,
    }),
    createWritePreviewHandler({
      captureWritePreviewBase: options.captureWritePreviewBase,
      computeWritePreview: options.computeWritePreview,
      logError: options.logError,
    }),
  ];
}
