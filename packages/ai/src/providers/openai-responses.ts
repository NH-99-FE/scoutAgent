// ============================================================
// OpenAI Responses provider
// 面向 Scout 的 API key 简化版，行为对齐 Pi 的 Responses 事件协议
// ============================================================

import OpenAI from 'openai';
import type { ResponseCreateParamsStreaming } from 'openai/resources/responses/responses.js';
import { getEnvApiKey } from '../env-api-keys';
import { clampThinkingLevel } from '../models';
import type {
  AssistantMessage,
  CacheRetention,
  Context,
  Model,
  OpenAIResponsesCompat,
  SimpleStreamOptions,
  StreamFunction,
  StreamOptions,
  Usage,
} from '../types';
import { AssistantMessageEventStream } from '../event-stream';
import { clampOpenAIPromptCacheKey } from './openai-prompt-cache';
import {
  convertResponsesMessages,
  convertResponsesTools,
  processResponsesStream,
} from './openai-responses-shared';
import { buildBaseOptions } from './simple-options';

// ---------- 选项 ----------

export interface OpenAIResponsesOptions extends StreamOptions {
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  reasoningSummary?: 'auto' | 'concise' | 'detailed';
  serviceTier?: ResponseCreateParamsStreaming['service_tier'];
}

// ---------- 兼容性 ----------

type ResolvedCompat = Required<OpenAIResponsesCompat>;

const OPENAI_TOOL_CALL_PROVIDERS = new Set(['openai']);

function getCompat(model: Model<'openai-responses'>): ResolvedCompat {
  return {
    sendSessionIdHeader: model.compat?.sendSessionIdHeader ?? true,
    supportsLongCacheRetention: model.compat?.supportsLongCacheRetention ?? true,
  };
}

// ---------- 缓存保留 ----------

function resolveCacheRetention(cacheRetention?: CacheRetention): CacheRetention {
  if (cacheRetention) return cacheRetention;
  if (typeof process !== 'undefined' && process.env.PI_CACHE_RETENTION === 'long') return 'long';
  return 'short';
}

// ---------- 错误格式 ----------

function formatOpenAIResponsesError(error: unknown): string {
  if (error instanceof OpenAI.APIError) {
    const pieces = [
      error.status !== undefined ? `HTTP ${error.status}` : undefined,
      error.code ? `code=${error.code}` : undefined,
      error.type ? `type=${error.type}` : undefined,
      error.message,
    ].filter(Boolean);
    return pieces.join(' ');
  }
  return error instanceof Error ? error.message : JSON.stringify(error);
}

// ---------- 客户端创建 ----------

function createClient(
  model: Model<'openai-responses'>,
  apiKey: string,
  optionsHeaders?: Record<string, string>,
  sessionId?: string,
  compat: ResolvedCompat = getCompat(model),
): OpenAI {
  if (!apiKey) {
    throw new Error(`OpenAI API key required for model: ${model.provider}/${model.id}`);
  }

  const headers: Record<string, string> = { ...model.headers };
  if (sessionId) {
    if (compat.sendSessionIdHeader) {
      headers.session_id = sessionId;
    }
    headers['x-client-request-id'] = sessionId;
  }
  if (optionsHeaders) Object.assign(headers, optionsHeaders);

  return new OpenAI({
    apiKey,
    baseURL: model.baseUrl || undefined,
    dangerouslyAllowBrowser: true,
    defaultHeaders: headers,
  });
}

// ---------- Service tier 定价 ----------

function resolveServiceTier(
  responseServiceTier: ResponseCreateParamsStreaming['service_tier'] | undefined,
  requestServiceTier: ResponseCreateParamsStreaming['service_tier'] | undefined,
): ResponseCreateParamsStreaming['service_tier'] | undefined {
  if (
    responseServiceTier === 'default' &&
    (requestServiceTier === 'flex' || requestServiceTier === 'priority')
  ) {
    return requestServiceTier;
  }
  return responseServiceTier ?? requestServiceTier;
}

function getServiceTierCostMultiplier(
  model: Pick<Model<'openai-responses'>, 'id'>,
  serviceTier: ResponseCreateParamsStreaming['service_tier'] | undefined,
): number {
  switch (serviceTier) {
    case 'flex':
      return 0.5;
    case 'priority':
      return model.id === 'gpt-5.5' ? 2.5 : 2;
    default:
      return 1;
  }
}

function applyServiceTierPricing(
  usage: Usage,
  serviceTier: ResponseCreateParamsStreaming['service_tier'] | undefined,
  model: Pick<Model<'openai-responses'>, 'id'>,
): void {
  const multiplier = getServiceTierCostMultiplier(model, serviceTier);
  if (multiplier === 1) return;

  usage.cost.input *= multiplier;
  usage.cost.output *= multiplier;
  usage.cost.cacheRead *= multiplier;
  usage.cost.cacheWrite *= multiplier;
  usage.cost.total =
    usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}

// ---------- 参数构建 ----------

function buildParams(
  model: Model<'openai-responses'>,
  context: Context,
  options: OpenAIResponsesOptions | undefined,
  compat: ResolvedCompat,
  cacheRetention: CacheRetention = resolveCacheRetention(options?.cacheRetention),
): ResponseCreateParamsStreaming {
  const params: ResponseCreateParamsStreaming = {
    model: model.id,
    input: convertResponsesMessages(model, context, OPENAI_TOOL_CALL_PROVIDERS),
    stream: true,
    store: false,
    prompt_cache_key:
      (model.baseUrl?.includes('api.openai.com') && cacheRetention !== 'none') ||
      (cacheRetention === 'long' && compat.supportsLongCacheRetention)
        ? clampOpenAIPromptCacheKey(options?.sessionId)
        : undefined,
    prompt_cache_retention:
      cacheRetention === 'long' && compat.supportsLongCacheRetention ? '24h' : undefined,
  };

  if (options?.maxTokens) {
    params.max_output_tokens = options.maxTokens;
  }
  if (options?.temperature !== undefined) {
    params.temperature = options.temperature;
  }
  if (options?.serviceTier) {
    params.service_tier = options.serviceTier;
  }
  if (context.tools && context.tools.length > 0) {
    params.tools = convertResponsesTools(context.tools);
  }

  if (model.reasoning) {
    if (options?.reasoningEffort || options?.reasoningSummary) {
      const requestedEffort = options.reasoningEffort ?? 'medium';
      const effort = model.thinkingLevelMap?.[requestedEffort] ?? requestedEffort;
      params.reasoning = {
        effort: effort as NonNullable<ResponseCreateParamsStreaming['reasoning']>['effort'],
        summary: options.reasoningSummary ?? 'auto',
      };
      params.include = ['reasoning.encrypted_content'];
    } else if (model.thinkingLevelMap?.off !== null) {
      params.reasoning = {
        effort: (model.thinkingLevelMap?.off ?? 'none') as NonNullable<
          ResponseCreateParamsStreaming['reasoning']
        >['effort'],
      };
    }
  }

  return params;
}

// ---------- 主流式函数 ----------

export const streamOpenAIResponses: StreamFunction<'openai-responses', OpenAIResponsesOptions> = (
  model,
  context,
  options,
) => {
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
      if (nextParams !== undefined) {
        params = nextParams as ResponseCreateParamsStreaming;
      }

      const requestOptions = {
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
        maxRetries: options?.maxRetries ?? 0,
      };

      const { data: openaiStream, response } = await client.responses
        .create(params, requestOptions)
        .withResponse();
      await options?.onResponse?.(
        { status: response.status, headers: Object.fromEntries(response.headers.entries()) },
        model,
      );

      stream.push({ type: 'start', partial: output });
      await processResponsesStream(openaiStream, output, stream, model, {
        serviceTier: options?.serviceTier,
        resolveServiceTier,
        applyServiceTierPricing: (usage, serviceTier) =>
          applyServiceTierPricing(usage, serviceTier, model),
      });

      if (options?.signal?.aborted) throw new Error('Request was aborted');
      if (output.stopReason === 'aborted') throw new Error('Request was aborted');
      if (output.stopReason === 'error') {
        throw new Error(output.errorMessage || 'Provider returned an error stop reason');
      }

      stream.push({ type: 'done', reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      for (const block of output.content) {
        delete (block as { partialJson?: string }).partialJson;
      }
      output.stopReason = options?.signal?.aborted ? 'aborted' : 'error';
      output.errorMessage = formatOpenAIResponsesError(error);
      stream.push({ type: 'error', reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
};

// ---------- Simple stream ----------

export const streamSimpleOpenAIResponses: StreamFunction<
  'openai-responses',
  SimpleStreamOptions
> = (model, context, options) => {
  const apiKey = options?.apiKey || getEnvApiKey(model.provider);
  if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);

  const base = buildBaseOptions(model, options, apiKey);
  const clampedReasoning = options?.reasoning
    ? clampThinkingLevel(model, options.reasoning)
    : undefined;
  const reasoningEffort = clampedReasoning === 'off' ? undefined : clampedReasoning;

  return streamOpenAIResponses(model, context, {
    ...base,
    reasoningEffort,
  } satisfies OpenAIResponsesOptions);
};
