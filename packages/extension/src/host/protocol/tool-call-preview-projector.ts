// ============================================================
// Tool call preview projector — 工具预览协议适配
// 负责：把 core preview update 转成 shared Webview 协议事件。
// ============================================================

import type { ExtensionEventMessage, ScoutAgentEvent, ScoutContent } from '@scout-agent/shared';
import {
  ToolPreviewService,
  type CaptureWritePreviewBase,
  type ComputeEditPreview,
  type ComputeWritePreview,
  type ToolPreviewAgentEvent,
  type ToolPreviewAssistantContent,
  type ToolPreviewContext,
  type ToolPreviewUpdate,
} from '../../core/tool-preview/index.ts';
export type {
  CaptureWritePreviewBase,
  ComputeEditPreview,
  ComputeWritePreview,
  ToolPreviewContext as ToolCallPreviewContext,
  ToolPreviewToolIdentity as ToolCallPreviewToolIdentity,
} from '../../core/tool-preview/index.ts';
export {
  parseEditToolCallArguments,
  parseWriteToolCallArguments,
} from '../../core/tool-preview/index.ts';

// ---------- 类型 ----------

export interface ToolCallPreviewProjectorOptions {
  getPreviewContext: () => ToolPreviewContext;
  publishEvent: (message: ExtensionEventMessage) => void;
  computeEditPreview?: ComputeEditPreview;
  computeWritePreview?: ComputeWritePreview;
  captureWritePreviewBase?: CaptureWritePreviewBase;
  logError?: (message: string) => void;
}

// ---------- Projector ----------

export class ToolCallPreviewProjector {
  private readonly service: ToolPreviewService;

  constructor(options: ToolCallPreviewProjectorOptions) {
    this.service = new ToolPreviewService({
      getPreviewContext: options.getPreviewContext,
      publishUpdate: (update) => options.publishEvent(mapPreviewUpdateToProtocol(update)),
      computeEditPreview: options.computeEditPreview,
      computeWritePreview: options.computeWritePreview,
      captureWritePreviewBase: options.captureWritePreviewBase,
      logError: options.logError,
    });
  }

  handleAgentEvent(event: ScoutAgentEvent): void {
    const previewEvent = mapScoutAgentEventToToolPreviewEvent(event);
    if (!previewEvent) return;
    this.service.handleAgentEvent(previewEvent);
  }
}

function mapScoutAgentEventToToolPreviewEvent(
  event: ScoutAgentEvent,
): ToolPreviewAgentEvent | undefined {
  if (event.type === 'agent_start' || event.type === 'agent_end') return event;
  if (
    event.type !== 'message_start' &&
    event.type !== 'message_update' &&
    event.type !== 'message_end'
  ) {
    return undefined;
  }

  if (event.message.role !== 'assistant') return undefined;
  return {
    type: event.type,
    message: {
      role: event.message.role,
      content: event.message.content.map(mapScoutContentToToolPreviewContent),
    },
  };
}

function mapScoutContentToToolPreviewContent(content: ScoutContent): ToolPreviewAssistantContent {
  if (content.type === 'toolCall') {
    return {
      type: 'toolCall',
      id: content.id,
      name: content.name,
      arguments: content.arguments,
    };
  }

  return { type: content.type };
}

function mapPreviewUpdateToProtocol(update: ToolPreviewUpdate): ExtensionEventMessage {
  return {
    type: 'tool_call_preview_update',
    sessionId: update.sessionId,
    sessionFile: update.sessionFile,
    toolCallId: update.toolCallId,
    toolName: update.toolName,
    preview: update.preview,
  };
}
