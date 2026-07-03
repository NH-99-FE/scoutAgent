// ============================================================
// Tool preview service — 工具调用预测预览核心服务
// 负责：注册工具预览策略、分发 assistant toolCall、管理 per-tool-call 生命周期。
// ============================================================

import { captureWriteDiffBase, computeEditsDiff } from '../tools/shared/edit-diff.ts';
import { createDefaultToolPreviewHandlers } from './default-preview-handlers.ts';
import { ToolCallPreviewSession } from './tool-call-preview-session.ts';
import { DefaultToolPreviewController } from './tool-preview-controller.ts';
import type {
  ToolPreviewAgentEvent,
  ToolPreviewAssistantContent,
  ToolPreviewAssistantMessage,
  ToolPreviewContext,
  ToolPreviewHandler,
  ToolPreviewMessageEvent,
  ToolPreviewPhase,
  ToolPreviewRequestSession,
  ToolPreviewServiceOptions,
  ToolPreviewToolCallContent,
  ToolPreviewUpdate,
} from './types.ts';

// ---------- Service ----------

export class ToolPreviewService {
  private readonly getPreviewContext: () => ToolPreviewContext;
  private readonly publishUpdate: (update: ToolPreviewUpdate) => void;
  private readonly handlersByToolName: ReadonlyMap<string, ToolPreviewHandler>;
  private readonly sessionsByToolCallId = new Map<string, ToolCallPreviewSession>();
  private runVersion = 0;

  constructor(options: ToolPreviewServiceOptions) {
    this.getPreviewContext = options.getPreviewContext;
    this.publishUpdate = options.publishUpdate;
    this.handlersByToolName = createToolPreviewHandlerRegistry(
      createDefaultToolPreviewHandlers({
        computeEditPreview: options.computeEditPreview ?? computeEditsDiff,
        computeWritePreview: options.computeWritePreview,
        captureWritePreviewBase: options.captureWritePreviewBase ?? captureWriteDiffBase,
        logError: options.logError,
      }),
      {
        additionalHandlers: options.additionalHandlers,
        handlerOverrides: options.handlerOverrides,
      },
    );
  }

  handleAgentEvent(event: ToolPreviewAgentEvent): void {
    if (!isToolPreviewMessageEvent(event)) {
      this.reset();
      return;
    }

    this.projectMessage(event.message, event.type);
  }

  dispose(): void {
    this.reset();
  }

  private reset(): void {
    this.runVersion += 1;
    for (const session of this.sessionsByToolCallId.values()) {
      session.dispose();
    }
    this.sessionsByToolCallId.clear();
  }

  private projectMessage(message: ToolPreviewAssistantMessage, phase: ToolPreviewPhase): void {
    if (message.role !== 'assistant') return;

    for (const content of message.content) {
      if (!isToolCallContent(content)) continue;
      const handler = this.handlersByToolName.get(content.name);
      if (!handler) continue;
      const context = this.getPreviewContext();
      const controller = new DefaultToolPreviewController({
        context,
        getPreviewContext: () => this.getPreviewContext(),
        getRunVersion: () => this.runVersion,
        getSession: () => this.getSession(content.id),
        phase,
        publishUpdate: (update) => this.publishUpdate(update),
        runVersion: this.runVersion,
        toolCall: content,
        toolName: handler.toolName,
      });
      handler.handleToolCall({ toolCall: content, controller });
    }
  }

  private getSession(toolCallId: string): ToolPreviewRequestSession {
    const existing = this.sessionsByToolCallId.get(toolCallId);
    if (existing) return existing;
    const session = new ToolCallPreviewSession();
    this.sessionsByToolCallId.set(toolCallId, session);
    return session;
  }
}

// ---------- Message guards ----------

function isToolPreviewMessageEvent(event: ToolPreviewAgentEvent): event is ToolPreviewMessageEvent {
  return (
    event.type === 'message_start' ||
    event.type === 'message_update' ||
    event.type === 'message_end'
  );
}

function isToolCallContent(
  content: ToolPreviewAssistantContent,
): content is ToolPreviewToolCallContent {
  return (
    content.type === 'toolCall' &&
    typeof content.id === 'string' &&
    typeof content.name === 'string' &&
    Boolean(content.arguments) &&
    typeof content.arguments === 'object'
  );
}

// ---------- Registry ----------

function createToolPreviewHandlerRegistry(
  defaultHandlers: readonly ToolPreviewHandler[],
  options: {
    additionalHandlers?: readonly ToolPreviewHandler[];
    handlerOverrides?: readonly ToolPreviewHandler[];
  } = {},
): ReadonlyMap<string, ToolPreviewHandler> {
  const registry = new Map<string, ToolPreviewHandler>();
  const sources = new Map<string, string>();

  for (const handler of defaultHandlers) {
    const toolName = validateToolPreviewHandler(handler, 'default');
    if (registry.has(toolName)) {
      throw new Error(`工具预览 default handler 注册失败: 重复的工具名 ${toolName}`);
    }
    registry.set(toolName, handler);
    sources.set(toolName, 'default');
  }

  for (const handler of options.additionalHandlers ?? []) {
    const toolName = validateToolPreviewHandler(handler, 'additional');
    const existingSource = sources.get(toolName);
    if (existingSource) {
      throw new Error(
        `工具预览 additional handler 注册失败: 工具名 ${toolName} 已由 ${existingSource} 注册，请使用 handlerOverrides 显式替换`,
      );
    }
    registry.set(toolName, handler);
    sources.set(toolName, 'additional');
  }

  const overrideNames = new Set<string>();
  for (const handler of options.handlerOverrides ?? []) {
    const toolName = validateToolPreviewHandler(handler, 'override');
    if (overrideNames.has(toolName)) {
      throw new Error(`工具预览 override handler 注册失败: 重复的工具名 ${toolName}`);
    }
    overrideNames.add(toolName);
    registry.set(toolName, handler);
    sources.set(toolName, 'override');
  }

  return registry;
}

function validateToolPreviewHandler(handler: ToolPreviewHandler, source: string): string {
  const toolName = handler.toolName.trim();
  if (!toolName) {
    throw new Error(`工具预览 ${source} handler 注册失败: toolName 不能为空`);
  }
  return toolName;
}
