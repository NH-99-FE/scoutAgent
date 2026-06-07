// ============================================================
// @scout-agent/ai — 公开 API
// ============================================================

export type {
  KnownApi,
  Api,
  KnownProvider,
  Provider,
  Transport,
  ThinkingLevel,
  ModelThinkingLevel,
  ThinkingLevelMap,
  ThinkingBudgets,
  ProviderResponse,
  TextSignatureV1,
  TextContent,
  ThinkingContent,
  ImageContent,
  ToolCall,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  Message,
  Usage,
  StopReason,
  Tool,
  Context,
  CacheRetention,
  StreamOptions,
  ProviderStreamOptions,
  SimpleStreamOptions,
  StreamFunction,
  Model,
  AnthropicMessagesCompat,
  OpenAICompletionsCompat,
  OpenAIResponsesCompat,
  OpenAIThinkingFormat,
  OpenRouterRouting,
  VercelGatewayRouting,
  AssistantMessageEvent,
} from './types';

export { EventStream, createAssistantMessageEventStream } from './event-stream';
export { AssistantMessageEventStream } from './event-stream';
export {
  registerApiProvider,
  getApiProvider,
  getApiProviders,
  unregisterApiProviders,
  clearApiProviders,
} from './api-registry';
export { registerBuiltInApiProviders, resetApiProviders } from './providers/register-builtins';
export { stream, complete, streamSimple, completeSimple } from './stream';
export {
  getModel,
  getModels,
  getProviders,
  getDefaultModel,
  registerModel,
  registerModels,
  unregisterModels,
  clearModels,
  resetModels,
  calculateCost,
  getSupportedThinkingLevels,
  clampThinkingLevel,
  modelsAreEqual,
} from './models';
export { validateToolCall, validateToolArguments } from './validation';
export { getEnvApiKey, findEnvKeys } from './env-api-keys';
export { sanitizeSurrogates } from './utils/sanitize-unicode';
export { repairJson, parseJsonWithRepair, parseStreamingJson } from './utils/json-parse';
export {
  formatThrownValue,
  extractDiagnosticError,
  createAssistantMessageDiagnostic,
  appendAssistantMessageDiagnostic,
} from './utils/diagnostics';
export type { DiagnosticErrorInfo, AssistantMessageDiagnostic } from './utils/diagnostics';
export { isContextOverflow, getOverflowPatterns } from './utils/overflow';
export { transformMessages } from './providers/transform-messages';
export type { OpenAIResponsesOptions } from './providers/openai-responses';
