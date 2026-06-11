// ============================================================
// 注册内置 API provider
// 内置 provider 延迟加载，加载失败通过 stream error 事件返回。
// Scout 范围：Anthropic Messages + OpenAI Chat Completions/Responses。
// ============================================================

import { clearApiProviders, registerApiProvider } from '../api-registry';
import { AssistantMessageEventStream } from '../event-stream';
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Model,
  SimpleStreamOptions,
  StreamFunction,
  StreamOptions,
} from '../types';
import type { AnthropicOptions } from './anthropic';
import type { OpenAICompletionsOptions } from './openai-completions';
import type { OpenAIResponsesOptions } from './openai-responses';

interface LazyProviderModule<
  TApi extends Api,
  TOptions extends StreamOptions,
  TSimpleOptions extends SimpleStreamOptions,
> {
  stream: StreamFunction<TApi, TOptions>;
  streamSimple: StreamFunction<TApi, TSimpleOptions>;
}

interface AnthropicProviderModule {
  streamAnthropic: StreamFunction<'anthropic-messages', AnthropicOptions>;
  streamSimpleAnthropic: StreamFunction<'anthropic-messages', SimpleStreamOptions>;
}

interface OpenAICompletionsProviderModule {
  streamOpenAICompletions: StreamFunction<'openai-completions', OpenAICompletionsOptions>;
  streamSimpleOpenAICompletions: StreamFunction<'openai-completions', SimpleStreamOptions>;
}

interface OpenAIResponsesProviderModule {
  streamOpenAIResponses: StreamFunction<'openai-responses', OpenAIResponsesOptions>;
  streamSimpleOpenAIResponses: StreamFunction<'openai-responses', SimpleStreamOptions>;
}

let anthropicProviderModulePromise:
  | Promise<LazyProviderModule<'anthropic-messages', AnthropicOptions, SimpleStreamOptions>>
  | undefined;
let openAICompletionsProviderModulePromise:
  | Promise<LazyProviderModule<'openai-completions', OpenAICompletionsOptions, SimpleStreamOptions>>
  | undefined;
let openAIResponsesProviderModulePromise:
  | Promise<LazyProviderModule<'openai-responses', OpenAIResponsesOptions, SimpleStreamOptions>>
  | undefined;

function forwardStream<TApi extends Api>(
  target: AssistantMessageEventStream,
  source: AsyncIterable<AssistantMessageEvent>,
  model: Model<TApi>,
): void {
  (async () => {
    for await (const event of source) {
      target.push(event);
    }
    target.end();
  })().catch((error) => {
    pushLazyLoadError(target, model, error);
  });
}

function createLazyLoadErrorMessage<TApi extends Api>(
  model: Pick<Model<TApi>, 'api' | 'provider' | 'id'>,
  error: unknown,
): AssistantMessage {
  return {
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
    stopReason: 'error',
    errorMessage: error instanceof Error ? error.message : String(error),
    timestamp: Date.now(),
  };
}

function pushLazyLoadError<TApi extends Api>(
  stream: AssistantMessageEventStream,
  model: Model<TApi>,
  error: unknown,
): void {
  const message = createLazyLoadErrorMessage(model, error);
  stream.push({ type: 'error', reason: 'error', error: message });
  stream.end(message);
}

function createLazyStream<
  TApi extends Api,
  TOptions extends StreamOptions,
  TSimpleOptions extends SimpleStreamOptions,
>(
  loadModule: () => Promise<LazyProviderModule<TApi, TOptions, TSimpleOptions>>,
): StreamFunction<TApi, TOptions> {
  return (model, context, options) => {
    const outer = new AssistantMessageEventStream();

    loadModule()
      .then((module) => {
        let inner: AssistantMessageEventStream;
        try {
          inner = module.stream(model, context, options);
        } catch (error) {
          pushLazyLoadError(outer, model, error);
          return;
        }
        forwardStream(outer, inner, model);
      })
      .catch((error) => {
        pushLazyLoadError(outer, model, error);
      });

    return outer;
  };
}

function createLazySimpleStream<
  TApi extends Api,
  TOptions extends StreamOptions,
  TSimpleOptions extends SimpleStreamOptions,
>(
  loadModule: () => Promise<LazyProviderModule<TApi, TOptions, TSimpleOptions>>,
): StreamFunction<TApi, TSimpleOptions> {
  return (model, context, options) => {
    const outer = new AssistantMessageEventStream();

    loadModule()
      .then((module) => {
        let inner: AssistantMessageEventStream;
        try {
          inner = module.streamSimple(model, context, options);
        } catch (error) {
          pushLazyLoadError(outer, model, error);
          return;
        }
        forwardStream(outer, inner, model);
      })
      .catch((error) => {
        pushLazyLoadError(outer, model, error);
      });

    return outer;
  };
}

function loadAnthropicProviderModule(): Promise<
  LazyProviderModule<'anthropic-messages', AnthropicOptions, SimpleStreamOptions>
> {
  anthropicProviderModulePromise ||= import('./anthropic').then((module) => {
    const provider = module as AnthropicProviderModule;
    return {
      stream: provider.streamAnthropic,
      streamSimple: provider.streamSimpleAnthropic,
    };
  });
  return anthropicProviderModulePromise;
}

function loadOpenAICompletionsProviderModule(): Promise<
  LazyProviderModule<'openai-completions', OpenAICompletionsOptions, SimpleStreamOptions>
> {
  openAICompletionsProviderModulePromise ||= import('./openai-completions').then((module) => {
    const provider = module as OpenAICompletionsProviderModule;
    return {
      stream: provider.streamOpenAICompletions,
      streamSimple: provider.streamSimpleOpenAICompletions,
    };
  });
  return openAICompletionsProviderModulePromise;
}

function loadOpenAIResponsesProviderModule(): Promise<
  LazyProviderModule<'openai-responses', OpenAIResponsesOptions, SimpleStreamOptions>
> {
  openAIResponsesProviderModulePromise ||= import('./openai-responses').then((module) => {
    const provider = module as OpenAIResponsesProviderModule;
    return {
      stream: provider.streamOpenAIResponses,
      streamSimple: provider.streamSimpleOpenAIResponses,
    };
  });
  return openAIResponsesProviderModulePromise;
}

export function registerBuiltInApiProviders(): void {
  registerApiProvider({
    api: 'anthropic-messages',
    stream: createLazyStream(loadAnthropicProviderModule),
    streamSimple: createLazySimpleStream(loadAnthropicProviderModule),
  });

  registerApiProvider({
    api: 'openai-completions',
    stream: createLazyStream(loadOpenAICompletionsProviderModule),
    streamSimple: createLazySimpleStream(loadOpenAICompletionsProviderModule),
  });

  registerApiProvider({
    api: 'openai-responses',
    stream: createLazyStream(loadOpenAIResponsesProviderModule),
    streamSimple: createLazySimpleStream(loadOpenAIResponsesProviderModule),
  });
}

export function resetApiProviders(): void {
  clearApiProviders();
  registerBuiltInApiProviders();
}

// 导入时自动注册
registerBuiltInApiProviders();
