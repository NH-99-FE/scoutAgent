// ============================================================
// AI 层类型定义
// 统一抽象：不同供应商的差异被封装在 provider 实现里
// 上层只看 Message / Tool / AssistantMessageEvent / streamSimple()
// ============================================================

import type { TSchema } from 'typebox';
import type { AssistantMessageDiagnostic } from './utils/diagnostics';
import type { AssistantMessageEventStream } from './event-stream';

export type { AssistantMessageEventStream } from './event-stream';

// ---------- API / Provider ----------
// 已知的 API 协议和供应商，扩展时往这里加

export type KnownApi = 'anthropic-messages' | 'openai-completions';

export type Api = KnownApi | (string & {});

export type KnownProvider = 'anthropic' | 'openai';

export type Provider = KnownProvider | string;

// ---------- 传输方式 ----------

export type Transport = 'sse' | 'websocket' | 'websocket-cached' | 'auto';

// ---------- 推理/思考 ----------

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type ModelThinkingLevel = 'off' | ThinkingLevel;
export type ThinkingLevelMap = Partial<Record<ModelThinkingLevel, string | null>>;

/** 各推理等级的 token 预算（仅适用于按 token 计费的 provider） */
export interface ThinkingBudgets {
  minimal?: number;
  low?: number;
  medium?: number;
  high?: number;
}

// ---------- 响应封装 ----------

export interface ProviderResponse {
  status: number;
  headers: Record<string, string>;
}

// ---------- 流选项 ----------

export type CacheRetention = 'none' | 'short' | 'long';

export interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  apiKey?: string;
  /** 首选传输方式，仅对支持多种传输的 provider 有效 */
  transport?: Transport;
  /** Prompt 缓存保留偏好，默认 "short" */
  cacheRetention?: CacheRetention;
  /** 可选的会话标识符，用于基于会话的缓存 */
  sessionId?: string;
  /** 可选回调，在发送请求前检查或替换 provider 载荷 */
  onPayload?: (
    payload: unknown,
    model: Model<Api>,
  ) => unknown | undefined | Promise<unknown | undefined>;
  /** 可选回调，在收到 HTTP 响应后调用 */
  onResponse?: (response: ProviderResponse, model: Model<Api>) => void | Promise<void>;
  /** 可选的自定义 HTTP 请求头 */
  headers?: Record<string, string>;
  /** HTTP 请求超时（毫秒） */
  timeoutMs?: number;
  /** WebSocket 连接超时（毫秒） */
  websocketConnectTimeoutMs?: number;
  /** 最大重试次数，默认 2 */
  maxRetries?: number;
  /** 最大重试延迟（毫秒），默认 60000 */
  maxRetryDelayMs?: number;
  /** 可选的请求元数据 */
  metadata?: Record<string, unknown>;
}

export type ProviderStreamOptions = StreamOptions & Record<string, unknown>;

export interface SimpleStreamOptions extends StreamOptions {
  reasoning?: ThinkingLevel;
  /** 自定义各推理等级的 token 预算（仅适用于按 token 计费的 provider） */
  thinkingBudgets?: ThinkingBudgets;
}

// ---------- 流函数 ----------

export type StreamFunction<
  TApi extends Api = Api,
  TOptions extends StreamOptions = StreamOptions,
> = (model: Model<TApi>, context: Context, options?: TOptions) => AssistantMessageEventStream;

// ---------- 文本签名 ----------

export interface TextSignatureV1 {
  v: 1;
  id: string;
  phase?: 'commentary' | 'final_answer';
}

// ---------- 内容类型 ----------

export interface TextContent {
  type: 'text';
  text: string;
  /** 文本签名，如 OpenAI Responses API 的消息元数据（旧版 id 字符串或 TextSignatureV1 JSON） */
  textSignature?: string;
}

export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
  /** 推理签名字段，如 OpenAI Responses API 的 reasoning item ID */
  thinkingSignature?: string;
  /** 为 true 时表示思考内容被安全过滤器遮蔽 */
  redacted?: boolean;
}

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface ToolCall {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, any>;
  /** 加密推理签名，用于复用思考上下文（如 o3/o4-mini 的 reasoning_details） */
  thoughtSignature?: string;
}

// ---------- 消息 ----------

export interface UserMessage {
  role: 'user';
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

export interface AssistantMessage {
  role: 'assistant';
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;
  provider: Provider;
  model: string;
  /** 实际响应的模型，当与请求不同时填充（如 OpenRouter 自动路由） */
  responseModel?: string;
  /** 供应商返回的响应/消息标识符 */
  responseId?: string;
  /** 供应商/运行时的诊断信息，用于故障和恢复追踪 */
  diagnostics?: AssistantMessageDiagnostic[];
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number;
}

export interface ToolResultMessage<TDetails = any> {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: TDetails;
  isError: boolean;
  timestamp: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

// ---------- 用量统计 ----------

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

// ---------- 停止原因 ----------

export type StopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';

// ---------- 工具 ----------

export interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;
}

// ---------- 上下文 ----------

export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

// ---------- 事件协议 ----------

export type AssistantMessageEvent =
  | { type: 'start'; partial: AssistantMessage }
  | { type: 'text_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'text_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'text_end'; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: 'thinking_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'thinking_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'thinking_end'; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: 'toolcall_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'toolcall_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'toolcall_end'; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | {
      type: 'done';
      reason: Extract<StopReason, 'stop' | 'length' | 'toolUse'>;
      message: AssistantMessage;
    }
  | { type: 'error'; reason: Extract<StopReason, 'aborted' | 'error'>; error: AssistantMessage };

// ---------- Anthropic 兼容性 ----------

export interface AnthropicMessagesCompat {
  supportsEagerToolInputStreaming?: boolean;
  supportsLongCacheRetention?: boolean;
  sendSessionAffinityHeaders?: boolean;
  supportsCacheControlOnTools?: boolean;
  forceAdaptiveThinking?: boolean;
}

// ---------- OpenAI 兼容性 ----------

export type OpenAIThinkingFormat =
  | 'openai'
  | 'deepseek'
  | 'openrouter'
  | 'together'
  | 'zai'
  | 'qwen'
  | 'qwen-chat-template';

export interface OpenAICompletionsCompat {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  supportsUsageInStreaming?: boolean;
  maxTokensField?: 'max_completion_tokens' | 'max_tokens';
  requiresToolResultName?: boolean;
  requiresAssistantAfterToolResult?: boolean;
  requiresThinkingAsText?: boolean;
  requiresReasoningContentOnAssistantMessages?: boolean;
  thinkingFormat?: OpenAIThinkingFormat;
  openRouterRouting?: OpenRouterRouting;
  vercelGatewayRouting?: VercelGatewayRouting;
  zaiToolStream?: boolean;
  supportsStrictMode?: boolean;
  cacheControlFormat?: 'anthropic';
  sendSessionAffinityHeaders?: boolean;
  supportsLongCacheRetention?: boolean;
}

/** OpenAI Responses API 兼容性配置 */
export interface OpenAIResponsesCompat {
  sendSessionIdHeader?: boolean;
  supportsLongCacheRetention?: boolean;
}

/** OpenRouter 供应商路由偏好 */
export interface OpenRouterRouting {
  allow_fallbacks?: boolean;
  require_parameters?: boolean;
  data_collection?: 'deny' | 'allow';
  zdr?: boolean;
  enforce_distillable_text?: boolean;
  order?: string[];
  only?: string[];
  ignore?: string[];
  quantizations?: string[];
  sort?: string | { by?: string; partition?: string | null };
  max_price?: {
    prompt?: number | string;
    completion?: number | string;
    image?: number | string;
    audio?: number | string;
    request?: number | string;
  };
  preferred_min_throughput?: number | { p50?: number; p75?: number; p90?: number; p99?: number };
  preferred_max_latency?: number | { p50?: number; p75?: number; p90?: number; p99?: number };
}

/** Vercel AI Gateway 路由偏好 */
export interface VercelGatewayRouting {
  only?: string[];
  order?: string[];
}

// ---------- 模型 ----------

export interface Model<TApi extends Api> {
  id: string;
  name: string;
  api: TApi;
  provider: Provider;
  baseUrl: string;
  reasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  input: ('text' | 'image')[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
  /** 兼容性覆盖，未设置时使用默认值 */
  compat?: TApi extends 'openai-completions'
    ? OpenAICompletionsCompat
    : TApi extends 'openai-responses'
      ? OpenAIResponsesCompat
      : TApi extends 'anthropic-messages'
        ? AnthropicMessagesCompat
        : never;
}
