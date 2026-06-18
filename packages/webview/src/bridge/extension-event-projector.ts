// ============================================================
// Extension event projector — Extension broadcast event 到 UI store 的投影
// ============================================================

import type {
  ExtensionEventMessage,
  ScoutRuntimeExtensionEvent,
  ScoutRuntimeStateUpdateEvent,
} from '@scout-agent/shared';
import { useConfigStore } from '@/store/config-store';
import { useConversationStore } from '@/store/conversation-store';
import { useSessionStore } from '@/store/session-store';
import { useTaskStore } from '@/store/task-store';
import { useTreeStore } from '@/store/tree-store';
import { useUiStore } from '@/store/ui-store';

export function projectExtensionEvent(message: ExtensionEventMessage): void {
  if (message.type === 'runtime_state_update') {
    projectRuntimeState(message);
    return;
  }

  if (isRuntimeExtensionEvent(message)) {
    projectRuntimeEvent(message);
    return;
  }

  switch (message.type) {
    case 'state_update':
      useConversationStore.getState().actions.applyStateSnapshot(message.state);
      useSessionStore.getState().actions.applyState(message.state);
      useTreeStore.getState().actions.applyState(message.state);
      useUiStore.getState().actions.resolveOpenTask(message.state.sessionFile);
      useUiStore.getState().actions.setDiagnostics(message.state.diagnostics ?? []);
      break;
    case 'queue_update':
      useConversationStore.getState().actions.applyQueueState(message.queueState);
      break;
    case 'config_update':
      useConfigStore.getState().actions.setConfig(message.config);
      break;
    case 'commands_update':
      useConfigStore.getState().actions.setCommands(message.commands);
      break;
    case 'context_usage_update':
      useConversationStore.getState().actions.setContextUsage(message.contextUsage);
      break;
    case 'sessions_update':
      useSessionStore.getState().actions.setSessions(message.sessions);
      break;
    case 'task_history_update':
      projectTaskHistoryUpdate(message, undefined);
      break;
    case 'tree_update':
      useTreeStore.getState().actions.setTreeData(message.tree, message.leafId);
      break;
    case 'notification':
      useUiStore.getState().actions.setNotification(message);
      break;
    case 'thinking_level_changed':
      break;
  }
}

function isRuntimeExtensionEvent(
  message: ExtensionEventMessage,
): message is Exclude<ScoutRuntimeExtensionEvent, ScoutRuntimeStateUpdateEvent> {
  return (
    message.type === 'agent_event' ||
    message.type === 'auto_retry_start' ||
    message.type === 'auto_retry_end' ||
    message.type === 'compaction_start' ||
    message.type === 'compaction_end'
  );
}

function projectRuntimeEvent(
  message: Exclude<ScoutRuntimeExtensionEvent, ScoutRuntimeStateUpdateEvent>,
): void {
  useConversationStore
    .getState()
    .actions.applyRuntimeEvent(message.type === 'agent_event' ? message.event : message);
}

function projectRuntimeState(message: ScoutRuntimeStateUpdateEvent): void {
  useConversationStore.getState().actions.applyRuntimeState({
    isStreaming: message.isStreaming,
    busyState: message.busyState,
  });
}

export function projectTaskHistoryUpdate(
  message: Extract<ExtensionEventMessage, { type: 'task_history_update' }>,
  queryToken: string | undefined,
): void {
  if (message.purpose === 'recent') {
    useTaskStore.getState().actions.setRecentTasks(message.tasks);
    return;
  }
  if (!queryToken) return;
  useTaskStore.getState().actions.applyHistoryResult({
    query: message.query,
    queryToken,
    tasks: message.tasks,
    offset: message.offset,
    hasMore: message.hasMore,
    nextOffset: message.nextOffset,
  });
}

export const EXTENSION_EVENT_TYPES = new Set<string>([
  'state_update',
  'queue_update',
  'runtime_state_update',
  'agent_event',
  'config_update',
  'commands_update',
  'context_usage_update',
  'notification',
  'auto_retry_start',
  'auto_retry_end',
  'compaction_start',
  'compaction_end',
  'thinking_level_changed',
  'tree_update',
  'task_history_update',
  'sessions_update',
]);
