// ============================================================
// Tool preview controller — handler 生命周期控制器
// 负责：封装 tool preview request 去重、stale 判断与发布协议。
// ============================================================

import { createToolPreviewContextKey } from './preview-format.ts';
import type {
  ToolPreviewContext,
  ToolPreviewController,
  ToolPreviewFileEdit,
  ToolPreviewFinalRequest,
  ToolPreviewPhase,
  ToolPreviewRequest,
  ToolPreviewRequestSession,
  ToolPreviewToolCallContent,
  ToolPreviewUpdate,
} from './types.ts';

// ---------- 类型 ----------

export interface ToolPreviewControllerOptions {
  context: ToolPreviewContext;
  getPreviewContext: () => ToolPreviewContext;
  getRunVersion: () => number;
  getSession: () => ToolPreviewRequestSession;
  phase: ToolPreviewPhase;
  publishUpdate: (update: ToolPreviewUpdate) => void;
  runVersion: number;
  toolCall: ToolPreviewToolCallContent;
  toolName: string;
}

// ---------- Controller ----------

export class DefaultToolPreviewController implements ToolPreviewController {
  readonly context: ToolPreviewContext;
  readonly phase: ToolPreviewPhase;
  private readonly contextKey: string;
  private readonly getPreviewContext: () => ToolPreviewContext;
  private readonly getRunVersion: () => number;
  private readonly getSession: () => ToolPreviewRequestSession;
  private readonly publishUpdate: (update: ToolPreviewUpdate) => void;
  private readonly runVersion: number;
  private readonly toolCall: ToolPreviewToolCallContent;
  private readonly toolName: string;
  private session: ToolPreviewRequestSession | undefined;

  constructor(options: ToolPreviewControllerOptions) {
    this.context = options.context;
    this.phase = options.phase;
    this.contextKey = createToolPreviewContextKey(options.context, options.toolName);
    this.getPreviewContext = options.getPreviewContext;
    this.getRunVersion = options.getRunVersion;
    this.getSession = options.getSession;
    this.publishUpdate = options.publishUpdate;
    this.runVersion = options.runVersion;
    this.toolCall = options.toolCall;
    this.toolName = options.toolName;
  }

  startRequest(argsKey: string): ToolPreviewRequest | undefined {
    const request = this.createRequest(argsKey);
    if (!this.requestSession().startRequest(request.key)) return undefined;
    return request;
  }

  trackLatestRequest(argsKey: string): ToolPreviewRequest {
    const request = this.createRequest(argsKey);
    this.requestSession().markLatestRequest(request.key);
    return request;
  }

  isCurrentRequest(request: ToolPreviewRequest): boolean {
    return this.isCurrentContext() && this.requestSession().requestKey === request.key;
  }

  isLatestRequest(request: ToolPreviewRequest): boolean {
    return this.requestSession().latestRequestKey === request.key;
  }

  publishProgress(progressKey: string, preview: ToolPreviewFileEdit): boolean {
    if (!this.isCurrentContext()) return false;
    const key = `${this.contextKey}\n${progressKey}`;
    if (!this.requestSession().startProgress(key)) return false;
    this.publish('progress', preview);
    return true;
  }

  publishFinal(request: ToolPreviewRequest, preview: ToolPreviewFileEdit): boolean {
    if (!this.isCurrentRequest(request)) return false;
    this.publish('final', preview);
    return true;
  }

  publishError(request: ToolPreviewRequest, preview: ToolPreviewFileEdit): boolean {
    if (!this.isCurrentRequest(request)) return false;
    this.publish('error', preview);
    return true;
  }

  runFinalRequest<T>(input: ToolPreviewFinalRequest<T>): void {
    void input
      .compute()
      .then((result) => {
        if (!this.shouldPublishFinalRequest(input)) return;
        this.publishFinal(input.request, input.createPreview(result));
      })
      .catch((error: unknown) => {
        if (!this.shouldPublishFinalRequest(input)) return;
        const message = error instanceof Error ? error.message : String(error);
        const published = this.publishError(input.request, input.createErrorPreview(message));
        if (published) input.onErrorPublished?.(message);
      })
      .finally(() => {
        input.onFinally?.();
      });
  }

  ensureResource<T>(key: string, create: () => Promise<T>): Promise<T> {
    return this.requestSession().ensureResource(this.createResourceKey(key), create);
  }

  releaseResource(key: string, request: ToolPreviewRequest): void {
    if (this.requestSession().requestKey !== request.key) return;
    this.requestSession().releaseResource(this.createResourceKey(key));
  }

  private createRequest(argsKey: string): ToolPreviewRequest {
    return { key: `${this.contextKey}\n${argsKey}` };
  }

  private createResourceKey(key: string): string {
    return `${this.contextKey}\nresource:${key}`;
  }

  private requestSession(): ToolPreviewRequestSession {
    this.session ??= this.getSession();
    return this.session;
  }

  private isCurrentContext(): boolean {
    return (
      this.getRunVersion() === this.runVersion &&
      createToolPreviewContextKey(this.getPreviewContext(), this.toolName) === this.contextKey
    );
  }

  private shouldPublishFinalRequest<T>(input: ToolPreviewFinalRequest<T>): boolean {
    return (input.shouldPublish?.() ?? true) && this.isCurrentRequest(input.request);
  }

  private publish(phase: ToolPreviewUpdate['phase'], preview: ToolPreviewFileEdit): void {
    this.publishUpdate({
      sessionId: this.context.sessionId,
      sessionFile: this.context.sessionFile,
      toolCallId: this.toolCall.id,
      toolName: this.toolCall.name,
      phase,
      preview,
    });
  }
}
