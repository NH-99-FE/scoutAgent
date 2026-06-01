// ============================================================
// @scout-agent/extension/extensions — 公开 API
// ============================================================

export { createEventBus, type EventBus, type EventBusController } from './event-bus.ts';
export type {
  ScoutToolDefinition,
  ScoutExtensionEventType,
  BeforeAgentStartEvent,
  ContextEvent,
  ToolCallEvent,
  ToolResultEvent,
  BeforeProviderRequestEvent,
  BeforeProviderPayloadEvent,
  SessionBeforeCompactEvent,
  SessionShutdownEvent,
  ScoutExtensionEvent,
  BeforeAgentStartEventResult,
  ContextEventResult,
  ToolCallEventResult,
  ToolResultEventResult,
  BeforeProviderRequestEventResult,
  SessionBeforeCompactResult,
  SessionBeforeTreeEvent,
  SessionBeforeTreeResult,
  SessionBeforeForkEvent,
  SessionBeforeForkResult,
  SessionBeforeSwitchEvent,
  SessionBeforeSwitchResult,
  SessionStartEvent,
  ScoutExtensionContext,
  ScoutExtensionRuntime,
  ScoutExtension,
  RegisteredTool,
  ScoutExtensionError,
  ScoutHandlerFn,
  ScoutExtensionAPI,
  ScoutExtensionFactory,
  LoadExtensionsResult,
  ScoutExtensionActions,
  ScoutExtensionContextActions,
} from './types.ts';
export { wrapRegisteredTool, wrapRegisteredTools } from './wrapper.ts';
export {
  createExtensionRuntime,
  loadExtensionFromFactory,
  loadExtensions,
  discoverAndLoadExtensions,
} from './loader.ts';
export { ScoutExtensionRunner, type ScoutExtensionErrorListener } from './runner.ts';
