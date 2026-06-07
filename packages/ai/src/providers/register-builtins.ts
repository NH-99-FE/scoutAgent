// ============================================================
// 注册内置 API provider
// 第一期：Anthropic Messages + OpenAI Chat Completions/Responses
// ============================================================

import { clearApiProviders, registerApiProvider } from '../api-registry';
import { streamAnthropic, streamSimpleAnthropic } from './anthropic';
import { streamOpenAICompletions, streamSimpleOpenAICompletions } from './openai-completions';
import { streamOpenAIResponses, streamSimpleOpenAIResponses } from './openai-responses';

export function registerBuiltInApiProviders(): void {
  registerApiProvider({
    api: 'anthropic-messages',
    stream: streamAnthropic,
    streamSimple: streamSimpleAnthropic,
  });

  registerApiProvider({
    api: 'openai-completions',
    stream: streamOpenAICompletions,
    streamSimple: streamSimpleOpenAICompletions,
  });

  registerApiProvider({
    api: 'openai-responses',
    stream: streamOpenAIResponses,
    streamSimple: streamSimpleOpenAIResponses,
  });
}

export function resetApiProviders(): void {
  clearApiProviders();
  registerBuiltInApiProviders();
}

// 导入时自动注册
registerBuiltInApiProviders();
