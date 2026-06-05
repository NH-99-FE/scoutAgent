// ============================================================
// OpenAI Chat Completions provider
// 供应商差异统一为 AssistantMessageEvent，上层无感知
// ============================================================

import OpenAI from 'openai';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionChunk,
  ChatCompletionContentPart,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartText,
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions.js';
import { calculateCost, clampThinkingLevel } from '../models';
import { getEnvApiKey } from '../env-api-keys';
import { sanitizeSurrogates } from '../utils/sanitize-unicode';
import { parseStreamingJson } from '../utils/json-parse';
import { transformMessages } from './transform-messages';
import { clampOpenAIPromptCacheKey } from './openai-prompt-cache';
import type {
  AssistantMessage,
  CacheRetention,
  Context,
  ImageContent,
  Message,
  Model,
  OpenAICompletionsCompat,
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
import { buildBaseOptions } from './simple-options';

// ---------- 选项 ----------

export interface OpenAICompletionsOptions extends StreamOptions {
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
}

// ---------- 已解析的兼容性配置 ----------

type ResolvedCompat = Omit<Required<OpenAICompletionsCompat>, 'cacheControlFormat'> & {
  cacheControlFormat?: OpenAICompletionsCompat['cacheControlFormat'];
};

function getCompat(model: Model<'openai-completions'>): ResolvedCompat {
  const defaults: ResolvedCompat = {
    supportsStore: true,
    supportsDeveloperRole: true,
    supportsReasoningEffort: true,
    supportsUsageInStreaming: true,
    maxTokensField: 'max_completion_tokens',
    requiresToolResultName: false,
    requiresAssistantAfterToolResult: false,
    requiresThinkingAsText: false,
    requiresReasoningContentOnAssistantMessages: false,
    thinkingFormat: 'openai',
    openRouterRouting: {},
    vercelGatewayRouting: {},
    zaiToolStream: false,
    supportsStrictMode: true,
    supportsLongCacheRetention: true,
    sendSessionAffinityHeaders: false,
    cacheControlFormat: undefined,
  };
  if (!model.compat) return defaults;
  return { ...defaults, ...model.compat };
}

// ---------- 缓存保留 ----------

function resolveCacheRetention(cacheRetention?: CacheRetention): CacheRetention {
  if (cacheRetention) return cacheRetention;
  if (typeof process !== 'undefined' && process.env.PI_CACHE_RETENTION === 'long') return 'long';
  return 'short';
}

// ---------- 客户端创建 ----------

function createClient(
  model: Model<'openai-completions'>,
  apiKey: string,
  optionsHeaders?: Record<string, string>,
  sessionId?: string,
  compat: ResolvedCompat = getCompat(model),
) {
  const headers: Record<string, string | null> = { ...model.headers };

  if (sessionId && compat.sendSessionAffinityHeaders) {
    headers.session_id = sessionId;
    headers['x-client-request-id'] = sessionId;
    headers['x-session-affinity'] = sessionId;
  }

  if (optionsHeaders) Object.assign(headers, optionsHeaders);

  return new OpenAI({
    apiKey,
    baseURL: model.baseUrl || undefined,
    dangerouslyAllowBrowser: true,
    defaultHeaders: headers,
  });
}

// ---------- 内容类型守卫 ----------

function isTextContentBlock(block: { type: string }): block is TextContent {
  return block.type === 'text';
}
function isThinkingContentBlock(block: { type: string }): block is ThinkingContent {
  return block.type === 'thinking';
}
function isToolCallBlock(block: { type: string }): block is ToolCall {
  return block.type === 'toolCall';
}
function isImageContentBlock(block: { type: string }): block is ImageContent {
  return block.type === 'image';
}

// ---------- 消息转换 ----------

function hasToolHistory(messages: Message[]): boolean {
  for (const msg of messages) {
    if (msg.role === 'toolResult') return true;
    if (msg.role === 'assistant' && msg.content.some((b) => b.type === 'toolCall')) return true;
  }
  return false;
}

export function convertMessages(
  model: Model<'openai-completions'>,
  context: Context,
  compat: ResolvedCompat,
): ChatCompletionMessageParam[] {
  const params: ChatCompletionMessageParam[] = [];

  // 工具调用 ID 规范化 — 处理管道分隔 ID + 40 字符截断
  const normalizeToolCallId = (id: string): string => {
    // OpenAI Responses API 生成管道分隔 ID: {call_id}|{id}
    // 提取 call_id 部分并规范化
    if (id.includes('|')) {
      const [callId] = id.split('|');
      return callId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    }
    if (model.provider === 'openai') return id.length > 40 ? id.slice(0, 40) : id;
    return id;
  };

  const transformedMessages = transformMessages(context.messages, model, (id) =>
    normalizeToolCallId(id),
  );

  if (context.systemPrompt) {
    const useDeveloperRole = model.reasoning && compat.supportsDeveloperRole;
    params.push({
      role: useDeveloperRole ? 'developer' : 'system',
      content: sanitizeSurrogates(context.systemPrompt),
    });
  }

  for (let i = 0; i < transformedMessages.length; i++) {
    const msg = transformedMessages[i];

    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        params.push({ role: 'user', content: sanitizeSurrogates(msg.content) });
      } else {
        const content: ChatCompletionContentPart[] = msg.content.map((item) => {
          if (item.type === 'text')
            return {
              type: 'text' as const,
              text: sanitizeSurrogates(item.text),
            } satisfies ChatCompletionContentPartText;
          return {
            type: 'image_url' as const,
            image_url: { url: `data:${item.mimeType};base64,${item.data}` },
          } satisfies ChatCompletionContentPartImage;
        });
        if (content.length === 0) continue;
        params.push({ role: 'user', content });
      }
    } else if (msg.role === 'assistant') {
      const assistantMsg: ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: null,
      };

      const textParts = msg.content
        .filter(isTextContentBlock)
        .filter((b) => b.text.trim().length > 0);
      const thinkingBlocks = msg.content
        .filter(isThinkingContentBlock)
        .filter((b) => b.thinking.trim().length > 0);
      const toolCalls = msg.content.filter(isToolCallBlock);

      // 构建文本内容
      const text = textParts.map((b) => b.text).join('');
      if (thinkingBlocks.length > 0 && !compat.requiresThinkingAsText) {
        if (text.length > 0) assistantMsg.content = text;
        const signature = thinkingBlocks[0].thinkingSignature || 'reasoning_content';
        if (signature.length > 0) {
          (assistantMsg as any)[signature] = thinkingBlocks.map((b) => b.thinking).join('\n');
        }
      } else if (thinkingBlocks.length > 0 && compat.requiresThinkingAsText) {
        const thinkingText = thinkingBlocks.map((b) => b.thinking).join('\n\n');
        assistantMsg.content = [
          { type: 'text', text: thinkingText },
          ...textParts.map((b) => ({ type: 'text' as const, text: b.text })),
        ];
      } else if (text.length > 0) {
        assistantMsg.content = text;
      }

      // 工具调用
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }));

        // reasoning_details 写回 — 将 thoughtSignature 转换为 reasoning_details 供 o3/o4-mini 回放
        const reasoningDetails = toolCalls
          .filter((tc) => tc.thoughtSignature)
          .map((tc) => {
            try {
              return JSON.parse(tc.thoughtSignature!);
            } catch {
              return null;
            }
          })
          .filter(Boolean);
        if (reasoningDetails.length > 0) {
          (assistantMsg as any).reasoning_details = reasoningDetails;
        }
      }

      // DeepSeek 等要求 reasoning_content 字段存在
      if (
        compat.requiresReasoningContentOnAssistantMessages &&
        model.reasoning &&
        (assistantMsg as { reasoning_content?: string }).reasoning_content === undefined
      ) {
        (assistantMsg as { reasoning_content?: string }).reasoning_content = '';
      }

      // 跳过空的 assistant 消息
      const hasContent =
        assistantMsg.content !== null &&
        (typeof assistantMsg.content === 'string'
          ? assistantMsg.content.length > 0
          : (assistantMsg.content as any[]).length > 0);
      if (!hasContent && !assistantMsg.tool_calls) continue;

      params.push(assistantMsg);
    } else if (msg.role === 'toolResult') {
      const imageBlocks: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
      let j = i;
      for (; j < transformedMessages.length && transformedMessages[j].role === 'toolResult'; j++) {
        const toolMsg = transformedMessages[j] as ToolResultMessage;
        const textResult = toolMsg.content
          .filter(isTextContentBlock)
          .map((b) => b.text)
          .join('\n');
        const hasImages = toolMsg.content.some((c) => c.type === 'image');
        const hasText = textResult.length > 0;
        const toolResultMsg: ChatCompletionToolMessageParam = {
          role: 'tool',
          content: sanitizeSurrogates(hasText ? textResult : '(see attached image)'),
          tool_call_id: toolMsg.toolCallId,
        };
        if (compat.requiresToolResultName && toolMsg.toolName) {
          (toolResultMsg as any).name = toolMsg.toolName;
        }
        params.push(toolResultMsg);

        if (hasImages && model.input.includes('image')) {
          for (const block of toolMsg.content) {
            if (isImageContentBlock(block)) {
              imageBlocks.push({
                type: 'image_url',
                image_url: { url: `data:${block.mimeType};base64,${block.data}` },
              });
            }
          }
        }
      }
      i = j - 1;

      // 将工具结果中的图片作为用户消息转发，因为 tool result 不支持图片
      if (imageBlocks.length > 0) {
        params.push({
          role: 'user',
          content: [{ type: 'text', text: 'Attached image(s) from tool result:' }, ...imageBlocks],
        });
      }
      continue;
    }
  }

  return params;
}

// ---------- 工具转换 ----------

function convertTools(
  tools: Tool[],
  compat: ResolvedCompat,
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as any,
      ...(compat.supportsStrictMode !== false && { strict: false }),
    },
  }));
}

// ---------- 用量解析 ----------

function parseChunkUsage(
  rawUsage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  },
  model: Model<'openai-completions'>,
): AssistantMessage['usage'] {
  const promptTokens = rawUsage.prompt_tokens || 0;
  const cacheRead =
    rawUsage.prompt_tokens_details?.cached_tokens ?? rawUsage.prompt_cache_hit_tokens ?? 0;
  const cacheWrite = rawUsage.prompt_tokens_details?.cache_write_tokens ?? 0;
  const input = Math.max(0, promptTokens - cacheRead - cacheWrite);
  const output = rawUsage.completion_tokens || 0;
  const usage: AssistantMessage['usage'] = {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  calculateCost(model, usage);
  return usage;
}

// ---------- 停止原因映射 ----------

function mapStopReason(reason: string | null): { stopReason: StopReason; errorMessage?: string } {
  if (reason === null) return { stopReason: 'stop' };
  switch (reason) {
    case 'stop':
    case 'end':
      return { stopReason: 'stop' };
    case 'length':
      return { stopReason: 'length' };
    case 'function_call':
    case 'tool_calls':
      return { stopReason: 'toolUse' };
    case 'content_filter':
      return { stopReason: 'error', errorMessage: 'Provider finish_reason: content_filter' };
    case 'network_error':
      return { stopReason: 'error', errorMessage: 'Provider finish_reason: network_error' };
    default:
      return { stopReason: 'error', errorMessage: `Provider finish_reason: ${reason}` };
  }
}

// ---------- 构建参数 ----------

function buildParams(
  model: Model<'openai-completions'>,
  context: Context,
  options: OpenAICompletionsOptions | undefined,
  compat: ResolvedCompat,
  cacheRetention: CacheRetention = resolveCacheRetention(options?.cacheRetention),
): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
  const messages = convertMessages(model, context, compat);
  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
    model: model.id,
    messages,
    stream: true,
    prompt_cache_key:
      (model.baseUrl?.includes('api.openai.com') && cacheRetention !== 'none') ||
      (cacheRetention === 'long' && compat.supportsLongCacheRetention)
        ? clampOpenAIPromptCacheKey(options?.sessionId)
        : undefined,
    prompt_cache_retention:
      cacheRetention === 'long' && compat.supportsLongCacheRetention ? '24h' : undefined,
  };

  if (compat.supportsUsageInStreaming !== false) {
    (params as any).stream_options = { include_usage: true };
  }

  if (compat.supportsStore) {
    params.store = false;
  }

  if (options?.maxTokens) {
    if (compat.maxTokensField === 'max_tokens') {
      (params as any).max_tokens = options.maxTokens;
    } else {
      params.max_completion_tokens = options.maxTokens;
    }
  }

  if (options?.temperature !== undefined) {
    params.temperature = options.temperature;
  }

  if (context.tools && context.tools.length > 0) {
    params.tools = convertTools(context.tools, compat);
  } else if (hasToolHistory(context.messages)) {
    params.tools = [];
  }

  if (options?.toolChoice) {
    params.tool_choice = options.toolChoice;
  }

  // 思考/推理
  if (compat.thinkingFormat === 'deepseek' && model.reasoning) {
    (params as any).thinking = { type: options?.reasoningEffort ? 'enabled' : 'disabled' };
    if (options?.reasoningEffort) {
      (params as any).reasoning_effort =
        model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;
    }
  } else if (compat.thinkingFormat === 'openrouter' && model.reasoning) {
    const openRouterParams = params as typeof params & { reasoning?: { effort?: string } };
    if (options?.reasoningEffort) {
      openRouterParams.reasoning = {
        effort: model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort,
      };
    } else if (model.thinkingLevelMap?.off !== null) {
      openRouterParams.reasoning = { effort: model.thinkingLevelMap?.off ?? 'none' };
    }
  } else if (compat.thinkingFormat === 'together' && model.reasoning) {
    const togetherParams = params as Omit<typeof params, 'reasoning_effort'> & {
      reasoning?: { enabled: boolean };
      reasoning_effort?: string;
    };
    togetherParams.reasoning = { enabled: !!options?.reasoningEffort };
    if (options?.reasoningEffort && compat.supportsReasoningEffort) {
      togetherParams.reasoning_effort =
        model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;
    }
  } else if (options?.reasoningEffort && model.reasoning && compat.supportsReasoningEffort) {
    (params as any).reasoning_effort =
      model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;
  } else if (!options?.reasoningEffort && model.reasoning && compat.supportsReasoningEffort) {
    const offValue = model.thinkingLevelMap?.off;
    if (typeof offValue === 'string') {
      (params as any).reasoning_effort = offValue;
    }
  }

  return params;
}

// ---------- 主流式函数 ----------

export const streamOpenAICompletions: StreamFunction<
  'openai-completions',
  OpenAICompletionsOptions
> = (model, context, options) => {
  const stream = new AssistantMessageEventStream();

  (async () => {
    const output: AssistantMessage = {
      role: 'assistant',
      content: [],
      api: model.api,
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
      const apiKey = options?.apiKey ?? getEnvApiKey(model.provider) ?? '';
      const compat = getCompat(model);
      const cacheRetention = resolveCacheRetention(options?.cacheRetention);
      const cacheSessionId = cacheRetention === 'none' ? undefined : options?.sessionId;
      const client = createClient(model, apiKey, options?.headers, cacheSessionId, compat);
      let params = buildParams(model, context, options, compat, cacheRetention);

      const nextParams = await options?.onPayload?.(params, model);
      if (nextParams !== undefined)
        params = nextParams as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;

      const requestOptions = {
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
        maxRetries: options?.maxRetries ?? 0,
      };

      const { data: openaiStream, response } = await client.chat.completions
        .create(params, requestOptions)
        .withResponse();
      await options?.onResponse?.(
        { status: response.status, headers: Object.fromEntries(response.headers.entries()) },
        model,
      );
      stream.push({ type: 'start', partial: output });

      // 流式状态
      interface StreamingToolCallBlock extends ToolCall {
        partialArgs?: string;
        streamIndex?: number;
      }
      type StreamingBlock = TextContent | ThinkingContent | StreamingToolCallBlock;

      let textBlock: TextContent | null = null;
      let thinkingBlock: ThinkingContent | null = null;
      let hasFinishReason = false;
      const toolCallBlocksByIndex = new Map<number, StreamingToolCallBlock>();
      const toolCallBlocksById = new Map<string, StreamingToolCallBlock>();
      const blocks = output.content as StreamingBlock[];
      const getContentIndex = (block: StreamingBlock) => blocks.indexOf(block);

      const finishBlock = (block: StreamingBlock) => {
        const idx = getContentIndex(block);
        if (idx === -1) return;
        if (block.type === 'text') {
          stream.push({
            type: 'text_end',
            contentIndex: idx,
            content: block.text,
            partial: output,
          });
        } else if (block.type === 'thinking') {
          stream.push({
            type: 'thinking_end',
            contentIndex: idx,
            content: block.thinking,
            partial: output,
          });
        } else if (block.type === 'toolCall') {
          block.arguments = parseStreamingJson(block.partialArgs ?? '');
          delete block.partialArgs;
          delete block.streamIndex;
          stream.push({
            type: 'toolcall_end',
            contentIndex: idx,
            toolCall: block,
            partial: output,
          });
        }
      };

      const ensureTextBlock = () => {
        if (!textBlock) {
          textBlock = { type: 'text', text: '' };
          blocks.push(textBlock);
          stream.push({
            type: 'text_start',
            contentIndex: getContentIndex(textBlock),
            partial: output,
          });
        }
        return textBlock;
      };

      const ensureThinkingBlock = (signature: string) => {
        if (!thinkingBlock) {
          thinkingBlock = { type: 'thinking', thinking: '', thinkingSignature: signature };
          blocks.push(thinkingBlock);
          stream.push({
            type: 'thinking_start',
            contentIndex: getContentIndex(thinkingBlock),
            partial: output,
          });
        }
        return thinkingBlock;
      };

      const ensureToolCallBlock = (
        tc: NonNullable<ChatCompletionChunk.Choice.Delta['tool_calls']>[number],
      ) => {
        const streamIndex = typeof tc.index === 'number' ? tc.index : undefined;
        let block = streamIndex !== undefined ? toolCallBlocksByIndex.get(streamIndex) : undefined;
        if (!block && tc.id) block = toolCallBlocksById.get(tc.id);
        if (!block) {
          block = {
            type: 'toolCall',
            id: tc.id || '',
            name: tc.function?.name || '',
            arguments: {},
            partialArgs: '',
            streamIndex,
          };
          if (streamIndex !== undefined) toolCallBlocksByIndex.set(streamIndex, block);
          if (tc.id) toolCallBlocksById.set(tc.id, block);
          blocks.push(block);
          stream.push({
            type: 'toolcall_start',
            contentIndex: getContentIndex(block),
            partial: output,
          });
        }
        if (streamIndex !== undefined && block.streamIndex === undefined) {
          block.streamIndex = streamIndex;
          toolCallBlocksByIndex.set(streamIndex, block);
        }
        if (tc.id) {
          block.id = tc.id;
          toolCallBlocksById.set(tc.id, block);
        }
        if (tc.function?.name) block.name = tc.function.name;
        return block;
      };

      // 处理数据块
      for await (const chunk of openaiStream) {
        if (!chunk || typeof chunk !== 'object') continue;

        output.responseId ||= chunk.id;
        if (typeof chunk.model === 'string' && chunk.model.length > 0 && chunk.model !== model.id) {
          output.responseModel ||= chunk.model;
        }
        if (chunk.usage) output.usage = parseChunkUsage(chunk.usage, model);

        const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
        if (!choice) continue;

        // 从 choice 中回退获取用量
        if (!chunk.usage && (choice as any).usage) {
          output.usage = parseChunkUsage((choice as any).usage, model);
        }

        if (choice.finish_reason) {
          const result = mapStopReason(choice.finish_reason);
          output.stopReason = result.stopReason;
          if (result.errorMessage) output.errorMessage = result.errorMessage;
          hasFinishReason = true;
        }

        if (choice.delta) {
          // 文本内容
          if (choice.delta.content != null && choice.delta.content.length > 0) {
            const block = ensureTextBlock();
            block.text += choice.delta.content;
            stream.push({
              type: 'text_delta',
              contentIndex: getContentIndex(block),
              delta: choice.delta.content,
              partial: output,
            });
          }

          // 推理/思考内容
          const deltaFields = choice.delta as Record<string, unknown>;
          const reasoningFields = ['reasoning_content', 'reasoning', 'reasoning_text'];
          for (const field of reasoningFields) {
            const value = deltaFields[field];
            if (typeof value === 'string' && value.length > 0) {
              const block = ensureThinkingBlock(field);
              block.thinking += value;
              stream.push({
                type: 'thinking_delta',
                contentIndex: getContentIndex(block),
                delta: value,
                partial: output,
              });
              break; // 只使用第一个非空推理字段
            }
          }

          // 工具调用
          if (choice.delta.tool_calls) {
            for (const tc of choice.delta.tool_calls) {
              const block = ensureToolCallBlock(tc);
              let delta = '';
              if (tc.function?.arguments) {
                delta = tc.function.arguments;
                block.partialArgs = (block.partialArgs ?? '') + tc.function.arguments;
                block.arguments = parseStreamingJson(block.partialArgs);
              }
              stream.push({
                type: 'toolcall_delta',
                contentIndex: getContentIndex(block),
                delta,
                partial: output,
              });
            }
          }

          // 加密推理详情 — o3/o4-mini 的 reasoning_details
          const reasoningDetails = (choice.delta as any).reasoning_details;
          if (reasoningDetails && Array.isArray(reasoningDetails)) {
            for (const detail of reasoningDetails) {
              if (detail.type === 'reasoning.encrypted' && detail.id && detail.data) {
                const matchingToolCall = output.content.find(
                  (b) => b.type === 'toolCall' && b.id === detail.id,
                ) as ToolCall | undefined;
                if (matchingToolCall) {
                  matchingToolCall.thoughtSignature = JSON.stringify(detail);
                }
              }
            }
          }
        }
      }

      // 结束所有块
      for (const block of blocks) finishBlock(block);

      if (options?.signal?.aborted) throw new Error('Request was aborted');
      if (output.stopReason === 'aborted') throw new Error('Request was aborted');
      if (output.stopReason === 'error')
        throw new Error(output.errorMessage || 'Provider returned an error stop reason');
      if (!hasFinishReason) throw new Error('Stream ended without finish_reason');

      stream.push({ type: 'done', reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      for (const block of output.content) {
        delete (block as any).partialArgs;
        delete (block as any).streamIndex;
      }
      output.stopReason = options?.signal?.aborted ? 'aborted' : 'error';
      output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      stream.push({ type: 'error', reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
};

// ---------- Simple stream ----------

export const streamSimpleOpenAICompletions: StreamFunction<
  'openai-completions',
  SimpleStreamOptions
> = (model, context, options) => {
  const apiKey = options?.apiKey || getEnvApiKey(model.provider);
  if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);

  const base = buildBaseOptions(model, options, apiKey);
  const clampedReasoning = options?.reasoning
    ? clampThinkingLevel(model, options.reasoning)
    : undefined;
  const reasoningEffort = clampedReasoning === 'off' ? undefined : clampedReasoning;
  const toolChoice = (options as OpenAICompletionsOptions | undefined)?.toolChoice;

  return streamOpenAICompletions(model, context, {
    ...base,
    reasoningEffort,
    toolChoice,
  } satisfies OpenAICompletionsOptions);
};
