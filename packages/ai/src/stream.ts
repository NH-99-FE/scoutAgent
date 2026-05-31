// ============================================================
// 流式调用入口
// ============================================================

// 副作用：注册内置 provider
import './providers/register-builtins';

import { getApiProvider } from './api-registry';
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
  StreamOptions,
} from './types';

function resolveApiProvider(api: Api) {
  const provider = getApiProvider(api);
  if (!provider) throw new Error(`未注册的 API provider: ${api}`);
  return provider;
}

export function stream<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: StreamOptions,
): AssistantMessageEventStream {
  const provider = resolveApiProvider(model.api);
  return provider.stream(model, context, options);
}

export async function complete<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: StreamOptions,
): Promise<AssistantMessage> {
  return stream(model, context, options).result();
}

export function streamSimple<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const provider = resolveApiProvider(model.api);
  return provider.streamSimple(model, context, options);
}

export async function completeSimple<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
  return streamSimple(model, context, options).result();
}
