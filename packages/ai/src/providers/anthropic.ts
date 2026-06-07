// ============================================================
// Anthropic Messages API provider
// 仅 API key 认证；无 OAuth/Copilot/Cloudflare
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import type {
  CacheControlEphemeral,
  ContentBlockParam,
  MessageCreateParamsStreaming,
  MessageParam,
  RawMessageStreamEvent,
  ThinkingConfigParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages.js';
import { calculateCost } from '../models';
import { getEnvApiKey } from '../env-api-keys';
import { sanitizeSurrogates } from '../utils/sanitize-unicode';
import { parseStreamingJson, parseJsonWithRepair } from '../utils/json-parse';
import { transformMessages } from './transform-messages';
import { adjustMaxTokensForThinking, buildBaseOptions } from './simple-options';
import type {
  AnthropicMessagesCompat,
  Api,
  AssistantMessage,
  CacheRetention,
  Context,
  ImageContent,
  Message,
  Model,
  SimpleStreamOptions,
  StopReason,
  StreamFunction,
  StreamOptions,
  TextContent,
  ThinkingContent,
  Tool,
  ToolCall,
  ToolResultMessage,
} from '../types';
import { AssistantMessageEventStream } from '../event-stream';

// ---------- Anthropic 特定选项 ----------

export type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type AnthropicThinkingDisplay = 'summarized' | 'omitted';

export interface AnthropicOptions extends StreamOptions {
  thinkingEnabled?: boolean;
  thinkingBudgetTokens?: number;
  effort?: AnthropicEffort;
  thinkingDisplay?: AnthropicThinkingDisplay;
  interleavedThinking?: boolean;
  toolChoice?: 'auto' | 'any' | 'none' | { type: 'tool'; name: string };
  client?: Anthropic;
}

type AnthropicImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

type StreamingOutputBlock = (
  | ThinkingContent
  | TextContent
  | (ToolCall & { partialJson?: string })
) & {
  index?: number;
};

interface StreamingOutputState {
  index?: number;
  partialJson?: string;
}

// ---------- Compat 辅助 ----------

function getAnthropicCompat(
  model: Model<'anthropic-messages'>,
): Required<Omit<AnthropicMessagesCompat, 'forceAdaptiveThinking'>> {
  return {
    supportsEagerToolInputStreaming: model.compat?.supportsEagerToolInputStreaming ?? true,
    supportsLongCacheRetention: model.compat?.supportsLongCacheRetention ?? true,
    sendSessionAffinityHeaders: model.compat?.sendSessionAffinityHeaders ?? false,
    supportsCacheControlOnTools: model.compat?.supportsCacheControlOnTools ?? true,
  };
}

// ---------- 工具调用 ID 规范化 ----------

function normalizeToolCallId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

// ---------- SSE 解码器 ----------

interface ServerSentEvent {
  event: string | null;
  data: string;
  raw: string[];
}

interface SseDecoderState {
  event: string | null;
  data: string[];
  raw: string[];
}

const ANTHROPIC_MESSAGE_EVENTS: ReadonlySet<string> = new Set([
  'message_start',
  'message_delta',
  'message_stop',
  'content_block_start',
  'content_block_delta',
  'content_block_stop',
]);

const FINE_GRAINED_TOOL_STREAMING_BETA = 'fine-grained-tool-streaming-2025-05-14';
const INTERLEAVED_THINKING_BETA = 'interleaved-thinking-2025-05-14';

function flushSseEvent(state: SseDecoderState): ServerSentEvent | null {
  if (!state.event && state.data.length === 0) return null;
  const event: ServerSentEvent = {
    event: state.event,
    data: state.data.join('\n'),
    raw: [...state.raw],
  };
  state.event = null;
  state.data = [];
  state.raw = [];
  return event;
}

function decodeSseLine(line: string, state: SseDecoderState): ServerSentEvent | null {
  if (line === '') return flushSseEvent(state);
  state.raw.push(line);
  if (line.startsWith(':')) return null;
  const delimiterIndex = line.indexOf(':');
  const fieldName = delimiterIndex === -1 ? line : line.slice(0, delimiterIndex);
  let value = delimiterIndex === -1 ? '' : line.slice(delimiterIndex + 1);
  if (value.startsWith(' ')) value = value.slice(1);
  if (fieldName === 'event') state.event = value;
  else if (fieldName === 'data') state.data.push(value);
  return null;
}

function nextLineBreakIndex(text: string): number {
  const cr = text.indexOf('\r');
  const nl = text.indexOf('\n');
  if (cr === -1) return nl;
  if (nl === -1) return cr;
  return Math.min(cr, nl);
}

function consumeLine(text: string): { line: string; rest: string } | null {
  const idx = nextLineBreakIndex(text);
  if (idx === -1) return null;
  let next = idx + 1;
  if (text[idx] === '\r' && text[next] === '\n') next += 1;
  return { line: text.slice(0, idx), rest: text.slice(next) };
}

async function* iterateSseMessages(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<ServerSentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const state: SseDecoderState = { event: null, data: [], raw: [] };
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) throw new Error('Request was aborted');
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let consumed = consumeLine(buffer);
      while (consumed) {
        buffer = consumed.rest;
        const event = decodeSseLine(consumed.line, state);
        if (event) yield event;
        consumed = consumeLine(buffer);
      }
    }
    buffer += decoder.decode();
    let consumed = consumeLine(buffer);
    while (consumed) {
      buffer = consumed.rest;
      const event = decodeSseLine(consumed.line, state);
      if (event) yield event;
      consumed = consumeLine(buffer);
    }
    if (buffer.length > 0) {
      const event = decodeSseLine(buffer, state);
      if (event) yield event;
    }
    const trailing = flushSseEvent(state);
    if (trailing) yield trailing;
  } finally {
    reader.releaseLock();
  }
}

async function* iterateAnthropicEvents(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<RawMessageStreamEvent> {
  if (!response.body)
    throw new Error('Attempted to iterate over an Anthropic response with no body');
  let sawStart = false;
  let sawEnd = false;
  for await (const sse of iterateSseMessages(response.body, signal)) {
    if (sse.event === 'error') throw new Error(sse.data);
    if (!ANTHROPIC_MESSAGE_EVENTS.has(sse.event ?? '')) continue;
    try {
      const event = parseJsonWithRepair<RawMessageStreamEvent>(sse.data);
      if (event.type === 'message_start') sawStart = true;
      else if (event.type === 'message_stop') sawEnd = true;
      yield event;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not parse Anthropic SSE event ${sse.event}: ${msg}; data=${sse.data}; raw=${sse.raw.join('\\n')}`,
        { cause: error },
      );
    }
  }
  if (sawStart && !sawEnd) throw new Error('Anthropic stream ended before message_stop');
}

// ---------- 缓存控制辅助 ----------

function resolveCacheRetention(cacheRetention?: CacheRetention): CacheRetention {
  if (cacheRetention) return cacheRetention;
  if (typeof process !== 'undefined' && process.env.PI_CACHE_RETENTION === 'long') return 'long';
  return 'short';
}

function getCacheControl(
  model: Model<'anthropic-messages'>,
  cacheRetention?: CacheRetention,
): { retention: CacheRetention; cacheControl?: CacheControlEphemeral } {
  const retention = resolveCacheRetention(cacheRetention);
  if (retention === 'none') return { retention, cacheControl: undefined };
  const ttl: CacheControlEphemeral['ttl'] =
    retention === 'long' && getAnthropicCompat(model).supportsLongCacheRetention ? '1h' : undefined;
  return { retention, cacheControl: { type: 'ephemeral', ...(ttl && { ttl }) } };
}

// ---------- 内容转换 ----------

function convertContentBlocks(
  content: (TextContent | ImageContent)[],
): string | ContentBlockParam[] {
  const hasImages = content.some((c) => c.type === 'image');
  if (!hasImages) return content.map((c) => sanitizeSurrogates((c as TextContent).text)).join('\n');
  const blocks = content.map((block): ContentBlockParam => {
    if (block.type === 'text')
      return { type: 'text' as const, text: sanitizeSurrogates(block.text) };
    return {
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: block.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: block.data,
      },
    };
  });
  if (!blocks.some((b) => b.type === 'text'))
    blocks.unshift({ type: 'text' as const, text: '(see attached image)' });
  return blocks;
}

// ---------- 消息转换 ----------

function convertMessages(
  messages: Message[],
  model: Model<'anthropic-messages'>,
  cacheControl?: CacheControlEphemeral,
): MessageParam[] {
  const params: MessageParam[] = [];
  const transformed = transformMessages(messages, model, normalizeToolCallId);

  for (let i = 0; i < transformed.length; i++) {
    const msg = transformed[i];
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        if (msg.content.trim().length > 0)
          params.push({ role: 'user', content: sanitizeSurrogates(msg.content) });
      } else {
        const blocks: ContentBlockParam[] = msg.content.map((item) => {
          if (item.type === 'text')
            return { type: 'text' as const, text: sanitizeSurrogates(item.text) };
          return {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: item.mimeType as AnthropicImageMediaType,
              data: item.data,
            },
          };
        });
        const filtered = blocks.filter((b) =>
          b.type === 'text' ? b.text.trim().length > 0 : true,
        );
        if (filtered.length === 0) continue;
        params.push({ role: 'user', content: filtered });
      }
    } else if (msg.role === 'assistant') {
      const blocks: ContentBlockParam[] = [];
      for (const block of msg.content) {
        if (block.type === 'text') {
          if (block.text.trim().length === 0) continue;
          blocks.push({ type: 'text' as const, text: sanitizeSurrogates(block.text) });
        } else if (block.type === 'thinking') {
          if (block.redacted) {
            blocks.push({ type: 'redacted_thinking', data: block.thinkingSignature! });
            continue;
          }
          if (block.thinking.trim().length === 0) continue;
          if (!block.thinkingSignature || block.thinkingSignature.trim().length === 0) {
            blocks.push({ type: 'text' as const, text: sanitizeSurrogates(block.thinking) });
          } else {
            blocks.push({
              type: 'thinking',
              thinking: sanitizeSurrogates(block.thinking),
              signature: block.thinkingSignature,
            });
          }
        } else if (block.type === 'toolCall') {
          blocks.push({
            type: 'tool_use' as const,
            id: block.id,
            name: block.name,
            input: block.arguments ?? {},
          });
        }
      }
      if (blocks.length === 0) continue;
      params.push({ role: 'assistant', content: blocks });
    } else if (msg.role === 'toolResult') {
      const toolResults: ContentBlockParam[] = [];
      toolResults.push({
        type: 'tool_result',
        tool_use_id: msg.toolCallId,
        content: convertContentBlocks(msg.content) as ToolResultBlockParam['content'],
        is_error: msg.isError,
      });
      let j = i + 1;
      while (j < transformed.length && transformed[j].role === 'toolResult') {
        const nextMsg = transformed[j] as ToolResultMessage;
        toolResults.push({
          type: 'tool_result',
          tool_use_id: nextMsg.toolCallId,
          content: convertContentBlocks(nextMsg.content) as ToolResultBlockParam['content'],
          is_error: nextMsg.isError,
        });
        j++;
      }
      i = j - 1;
      params.push({ role: 'user', content: toolResults });
    }
  }
  if (cacheControl && params.length > 0) {
    const last = params[params.length - 1];
    if (last.role === 'user') {
      if (Array.isArray(last.content)) {
        const lastBlock = last.content[last.content.length - 1];
        if (
          lastBlock &&
          (lastBlock.type === 'text' ||
            lastBlock.type === 'image' ||
            lastBlock.type === 'tool_result')
        ) {
          (lastBlock as { cache_control?: CacheControlEphemeral }).cache_control = cacheControl;
        }
      } else if (typeof last.content === 'string') {
        last.content = [{ type: 'text' as const, text: last.content, cache_control: cacheControl }];
      }
    }
  }
  return params;
}

// ---------- 工具转换 ----------

function convertTools(
  tools: Tool[],
  supportsEagerToolInputStreaming: boolean,
  cacheControl?: CacheControlEphemeral,
): Anthropic.Messages.Tool[] {
  if (!tools) return [];
  return tools.map((tool, index) => {
    const schema = tool.parameters as { properties?: unknown; required?: string[] };
    return {
      name: tool.name,
      description: tool.description,
      ...(supportsEagerToolInputStreaming ? { eager_input_streaming: true } : {}),
      input_schema: {
        type: 'object',
        properties: schema.properties ?? {},
        required: schema.required ?? [],
      },
      ...(cacheControl && index === tools.length - 1 ? { cache_control: cacheControl } : {}),
    };
  });
}

// ---------- 停止原因映射 ----------

function mapStopReason(reason: string): StopReason {
  switch (reason) {
    case 'end_turn':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'toolUse';
    case 'refusal':
      return 'error';
    case 'pause_turn':
      return 'stop';
    case 'stop_sequence':
      return 'stop';
    case 'sensitive':
      return 'error';
    default:
      throw new Error(`Unhandled stop reason: ${reason}`);
  }
}

// ---------- 客户端创建 ----------

function shouldUseFineGrainedToolStreamingBeta(
  model: Model<'anthropic-messages'>,
  context: Context,
): boolean {
  return !!context.tools?.length && !getAnthropicCompat(model).supportsEagerToolInputStreaming;
}

function createClient(
  model: Model<'anthropic-messages'>,
  apiKey: string,
  interleavedThinking: boolean,
  useFineGrainedToolStreamingBeta: boolean,
  optionsHeaders?: Record<string, string>,
  sessionId?: string,
): Anthropic {
  const betaFeatures: string[] = [];
  if (useFineGrainedToolStreamingBeta) betaFeatures.push(FINE_GRAINED_TOOL_STREAMING_BETA);
  if (interleavedThinking && model.compat?.forceAdaptiveThinking !== true) {
    betaFeatures.push(INTERLEAVED_THINKING_BETA);
  }

  const headers: Record<string, string | null> = {
    accept: 'application/json',
    'anthropic-dangerous-direct-browser-access': 'true',
    ...(betaFeatures.length > 0 ? { 'anthropic-beta': betaFeatures.join(',') } : {}),
    ...(sessionId && getAnthropicCompat(model).sendSessionAffinityHeaders
      ? { 'x-session-affinity': sessionId }
      : {}),
    ...model.headers,
    ...optionsHeaders,
  };

  return new Anthropic({
    apiKey,
    baseURL: model.baseUrl || undefined,
    dangerouslyAllowBrowser: true,
    defaultHeaders: headers,
  });
}

// ---------- 构建请求参数 ----------

function buildParams(
  model: Model<'anthropic-messages'>,
  context: Context,
  options?: AnthropicOptions,
): MessageCreateParamsStreaming {
  const { cacheControl } = getCacheControl(model, options?.cacheRetention);
  const params: MessageCreateParamsStreaming = {
    model: model.id,
    messages: convertMessages(context.messages, model, cacheControl),
    max_tokens: options?.maxTokens ?? model.maxTokens,
    stream: true,
  };

  if (context.systemPrompt) {
    params.system = [
      {
        type: 'text',
        text: sanitizeSurrogates(context.systemPrompt),
        ...(cacheControl ? { cache_control: cacheControl } : {}),
      },
    ];
  }

  if (options?.temperature !== undefined && !options?.thinkingEnabled) {
    params.temperature = options.temperature;
  }

  if (context.tools && context.tools.length > 0) {
    const compat = getAnthropicCompat(model);
    params.tools = convertTools(
      context.tools,
      compat.supportsEagerToolInputStreaming,
      compat.supportsCacheControlOnTools ? cacheControl : undefined,
    );
  }

  // 配置思考模式
  if (model.reasoning) {
    if (options?.thinkingEnabled) {
      const display: AnthropicThinkingDisplay = options.thinkingDisplay ?? 'summarized';
      if (model.compat?.forceAdaptiveThinking === true) {
        params.thinking = { type: 'adaptive', display } as ThinkingConfigParam;
        if (options.effort) {
          // The Anthropic SDK types can lag newly supported effort values such as "xhigh".
          params.output_config =
            options.effort === 'xhigh'
              ? ({ effort: options.effort } as unknown as NonNullable<
                  MessageCreateParamsStreaming['output_config']
                >)
              : { effort: options.effort };
        }
      } else {
        params.thinking = {
          type: 'enabled',
          budget_tokens: options.thinkingBudgetTokens || 1024,
          display,
        } as ThinkingConfigParam;
      }
    } else if (options?.thinkingEnabled === false) {
      params.thinking = { type: 'disabled' };
    }
  }

  if (options?.metadata) {
    const userId = options.metadata.user_id;
    if (typeof userId === 'string') params.metadata = { user_id: userId };
  }

  if (options?.toolChoice) {
    params.tool_choice =
      typeof options.toolChoice === 'string' ? { type: options.toolChoice } : options.toolChoice;
  }
  return params;
}

// ---------- 主流式函数 ----------

export const streamAnthropic: StreamFunction<'anthropic-messages', AnthropicOptions> = (
  model,
  context,
  options,
) => {
  const stream = new AssistantMessageEventStream();
  (async () => {
    const output: AssistantMessage = {
      role: 'assistant',
      content: [],
      api: model.api as Api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    };
    try {
      let client: Anthropic;
      if (options?.client) {
        client = options.client;
      } else {
        const apiKey = options?.apiKey ?? getEnvApiKey(model.provider) ?? '';
        const cacheRetention = options?.cacheRetention ?? resolveCacheRetention();
        const cacheSessionId = cacheRetention === 'none' ? undefined : options?.sessionId;
        client = createClient(
          model,
          apiKey,
          options?.interleavedThinking ?? true,
          shouldUseFineGrainedToolStreamingBeta(model, context),
          options?.headers,
          cacheSessionId,
        );
      }
      let params = buildParams(model, context, options);
      const nextParams = await options?.onPayload?.(params, model);
      if (nextParams !== undefined) params = nextParams as MessageCreateParamsStreaming;
      const requestOptions = {
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
        maxRetries: options?.maxRetries ?? 0,
      };
      const response = await client.messages
        .create({ ...params, stream: true }, requestOptions)
        .asResponse();
      await options?.onResponse?.(
        { status: response.status, headers: Object.fromEntries(response.headers.entries()) },
        model,
      );
      stream.push({ type: 'start', partial: output });
      const blocks = output.content as StreamingOutputBlock[];
      for await (const event of iterateAnthropicEvents(response, options?.signal)) {
        if (event.type === 'message_start') {
          output.responseId = event.message.id;
          output.usage.input = event.message.usage.input_tokens || 0;
          output.usage.output = event.message.usage.output_tokens || 0;
          output.usage.cacheRead = event.message.usage.cache_read_input_tokens || 0;
          output.usage.cacheWrite = event.message.usage.cache_creation_input_tokens || 0;
          output.usage.totalTokens =
            output.usage.input +
            output.usage.output +
            output.usage.cacheRead +
            output.usage.cacheWrite;
          calculateCost(model, output.usage);
        } else if (event.type === 'content_block_start') {
          if (event.content_block.type === 'text') {
            const block: StreamingOutputBlock = { type: 'text', text: '', index: event.index };
            output.content.push(block);
            stream.push({
              type: 'text_start',
              contentIndex: output.content.length - 1,
              partial: output,
            });
          } else if (event.content_block.type === 'thinking') {
            const block: StreamingOutputBlock = {
              type: 'thinking',
              thinking: '',
              thinkingSignature: '',
              index: event.index,
            };
            output.content.push(block);
            stream.push({
              type: 'thinking_start',
              contentIndex: output.content.length - 1,
              partial: output,
            });
          } else if (event.content_block.type === 'redacted_thinking') {
            const block: StreamingOutputBlock = {
              type: 'thinking',
              thinking: '[Reasoning redacted]',
              thinkingSignature: (event.content_block as { data: string }).data,
              redacted: true,
              index: event.index,
            };
            output.content.push(block);
            stream.push({
              type: 'thinking_start',
              contentIndex: output.content.length - 1,
              partial: output,
            });
          } else if (event.content_block.type === 'tool_use') {
            const block: StreamingOutputBlock = {
              type: 'toolCall',
              id: event.content_block.id,
              name: event.content_block.name,
              arguments: (event.content_block.input as Record<string, unknown>) ?? {},
              partialJson: '',
              index: event.index,
            };
            output.content.push(block);
            stream.push({
              type: 'toolcall_start',
              contentIndex: output.content.length - 1,
              partial: output,
            });
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            const index = blocks.findIndex((b) => b.index === event.index);
            const block = blocks[index];
            if (block && block.type === 'text') {
              block.text += event.delta.text;
              stream.push({
                type: 'text_delta',
                contentIndex: index,
                delta: event.delta.text,
                partial: output,
              });
            }
          } else if (event.delta.type === 'thinking_delta') {
            const index = blocks.findIndex((b) => b.index === event.index);
            const block = blocks[index];
            if (block && block.type === 'thinking') {
              block.thinking += event.delta.thinking;
              stream.push({
                type: 'thinking_delta',
                contentIndex: index,
                delta: event.delta.thinking,
                partial: output,
              });
            }
          } else if (event.delta.type === 'input_json_delta') {
            const index = blocks.findIndex((b) => b.index === event.index);
            const block = blocks[index];
            if (block && block.type === 'toolCall') {
              block.partialJson += event.delta.partial_json;
              block.arguments = parseStreamingJson(block.partialJson);
              stream.push({
                type: 'toolcall_delta',
                contentIndex: index,
                delta: event.delta.partial_json,
                partial: output,
              });
            }
          } else if (event.delta.type === 'signature_delta') {
            const index = blocks.findIndex((b) => b.index === event.index);
            const block = blocks[index];
            if (block && block.type === 'thinking') {
              block.thinkingSignature = block.thinkingSignature || '';
              block.thinkingSignature += event.delta.signature;
            }
          }
        } else if (event.type === 'content_block_stop') {
          const index = blocks.findIndex((b) => b.index === event.index);
          const block = blocks[index];
          if (block) {
            delete block.index;
            if (block.type === 'text')
              stream.push({
                type: 'text_end',
                contentIndex: index,
                content: block.text,
                partial: output,
              });
            else if (block.type === 'thinking')
              stream.push({
                type: 'thinking_end',
                contentIndex: index,
                content: block.thinking,
                partial: output,
              });
            else if (block.type === 'toolCall') {
              block.arguments = parseStreamingJson(block.partialJson);
              delete block.partialJson;
              stream.push({
                type: 'toolcall_end',
                contentIndex: index,
                toolCall: block,
                partial: output,
              });
            }
          }
        } else if (event.type === 'message_delta') {
          if (event.delta.stop_reason) output.stopReason = mapStopReason(event.delta.stop_reason);
          if (event.usage.input_tokens != null) output.usage.input = event.usage.input_tokens;
          if (event.usage.output_tokens != null) output.usage.output = event.usage.output_tokens;
          if (event.usage.cache_read_input_tokens != null)
            output.usage.cacheRead = event.usage.cache_read_input_tokens;
          if (event.usage.cache_creation_input_tokens != null)
            output.usage.cacheWrite = event.usage.cache_creation_input_tokens;
          output.usage.totalTokens =
            output.usage.input +
            output.usage.output +
            output.usage.cacheRead +
            output.usage.cacheWrite;
          calculateCost(model, output.usage);
        }
      }
      if (options?.signal?.aborted) throw new Error('Request was aborted');
      if (output.stopReason === 'aborted' || output.stopReason === 'error')
        throw new Error('An unknown error occurred');
      stream.push({ type: 'done', reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      for (const block of output.content) {
        delete (block as StreamingOutputState).index;
        delete (block as StreamingOutputState).partialJson;
      }
      output.stopReason = options?.signal?.aborted ? 'aborted' : 'error';
      output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      stream.push({ type: 'error', reason: output.stopReason, error: output });
      stream.end();
    }
  })();
  return stream;
};

// ---------- Simple stream（将 ThinkingLevel 映射为 Anthropic 选项）----------

function mapThinkingLevelToEffort(
  model: Model<'anthropic-messages'>,
  level: SimpleStreamOptions['reasoning'],
): AnthropicEffort {
  const mapped = level ? model.thinkingLevelMap?.[level] : undefined;
  if (typeof mapped === 'string') return mapped as AnthropicEffort;
  switch (level) {
    case 'minimal':
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    default:
      return 'high';
  }
}

export const streamSimpleAnthropic: StreamFunction<'anthropic-messages', SimpleStreamOptions> = (
  model,
  context,
  options,
) => {
  const apiKey = options?.apiKey || getEnvApiKey(model.provider);
  if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);

  const base = buildBaseOptions(model, options, apiKey);
  if (!options?.reasoning) {
    return streamAnthropic(model, context, {
      ...base,
      thinkingEnabled: false,
    } satisfies AnthropicOptions);
  }

  if (model.compat?.forceAdaptiveThinking === true) {
    const effort = mapThinkingLevelToEffort(model, options.reasoning);
    return streamAnthropic(model, context, {
      ...base,
      thinkingEnabled: true,
      effort,
    } satisfies AnthropicOptions);
  }

  const adjusted = adjustMaxTokensForThinking(
    base.maxTokens,
    model.maxTokens,
    options.reasoning,
    options.thinkingBudgets,
  );
  return streamAnthropic(model, context, {
    ...base,
    maxTokens: adjusted.maxTokens,
    thinkingEnabled: true,
    thinkingBudgetTokens: adjusted.thinkingBudget,
  } satisfies AnthropicOptions);
};
