// ============================================================
// Extension Message Router — Extension → Webview 消息分发
// ============================================================

import type { ExtensionEventMessage, ExtensionMessage } from '@scout-agent/shared';
import { useConfigStore } from '@/store/config-store';
import { HOME_COMPOSER_SESSION_ID, useComposerStore } from '@/store/composer-store';
import { useConversationStore } from '@/store/conversation-store';
import { useSessionStore } from '@/store/session-store';
import { useTaskStore } from '@/store/task-store';
import { useTreeStore } from '@/store/tree-store';
import { useUiStore } from '@/store/ui-store';
import { routeProtocolResponse } from './transport-client';

export function routeExtensionMessage(message: ExtensionMessage): void {
  if (message.type === 'protocol_response') {
    routeProtocolResponse(message);
    return;
  }
  routeExtensionEventMessage(message);
}

export function routeExtensionEventMessage(message: ExtensionEventMessage): void {
  switch (message.type) {
    case 'state_update':
      useConversationStore.getState().actions.applyState(message.state);
      useSessionStore.getState().actions.applyState(message.state);
      useTreeStore.getState().actions.applyState(message.state);
      useUiStore.getState().actions.resolveOpenTask(message.state.sessionFile);
      useUiStore.getState().actions.setDiagnostics(message.state.diagnostics ?? []);
      break;
    case 'queue_update':
      useConversationStore.getState().actions.applyQueueState(message.queueState);
      break;
    case 'agent_event':
      useConversationStore.getState().actions.applyAgentEvent(message.event);
      break;
    case 'config_update':
      useConfigStore.getState().actions.setConfig(message.config);
      break;
    case 'commands_data':
      useConfigStore.getState().actions.setCommands(message.commands);
      break;
    case 'context_usage_update':
      useConversationStore.getState().actions.setContextUsage(message.contextUsage);
      break;
    case 'sessions_data':
      useSessionStore.getState().actions.setSessions(message.sessions);
      break;
    case 'task_history_data':
      routeTaskHistoryData(message, undefined);
      break;
    case 'tree_data':
      useTreeStore.getState().actions.setTreeData(message.tree, message.leafId);
      break;
    case 'navigate_tree_result':
      useTreeStore.getState().actions.setEditorText(message.editorText);
      if (!message.success) {
        useUiStore.getState().actions.setNotification({
          type: 'notification',
          level: 'error',
          message: message.error ?? 'Tree navigation failed',
        });
      }
      break;
    case 'notification':
      useUiStore.getState().actions.setNotification(message);
      break;
    case 'auto_retry_start':
      useConversationStore.getState().actions.setBusyState(
        {
          kind: 'retry',
          label: 'Retrying',
          cancellable: true,
          attempt: message.attempt,
          maxAttempts: message.maxAttempts,
          reason: message.errorMessage,
        },
        true,
      );
      break;
    case 'compaction_start':
      useConversationStore.getState().actions.setBusyState(
        {
          kind: 'compaction',
          label: 'Compacting',
          cancellable: true,
          reason: message.reason,
        },
        true,
      );
      break;
    case 'auto_retry_end':
      useConversationStore
        .getState()
        .actions.setBusyState({ kind: 'idle', cancellable: false }, false);
      break;
    case 'compaction_end':
      if (message.willRetry) {
        useConversationStore.getState().actions.setBusyState(
          {
            kind: 'retry',
            label: 'Retrying',
            cancellable: true,
            reason: message.reason,
          },
          true,
        );
      } else {
        useConversationStore
          .getState()
          .actions.setBusyState({ kind: 'idle', cancellable: false }, false);
      }
      break;
    case 'open_task_result':
      if (!message.success) {
        useUiStore.getState().actions.completeOpenTask(message.success);
        useUiStore.getState().actions.setNotification({
          type: 'notification',
          level: 'error',
          message: message.error ?? 'Open task failed',
        });
      }
      break;
    case 'new_session_result':
      useUiStore.getState().actions.completeNewSessionRequest(message.success);
      if (message.success) {
        useComposerStore.getState().actions.discardPendingDraft(HOME_COMPOSER_SESSION_ID);
        useComposerStore.getState().actions.clearDraft(HOME_COMPOSER_SESSION_ID);
      } else {
        useComposerStore.getState().actions.restorePendingDraft(HOME_COMPOSER_SESSION_ID);
        useUiStore.getState().actions.setNotification({
          type: 'notification',
          level: 'error',
          message: message.error ?? 'New session failed',
        });
      }
      break;
    case 'thinking_level_changed':
    case 'fork_result':
    case 'file_mentions_data':
    case 'open_settings_panel_result':
    case 'open_tree_panel_result':
    case 'restore_session_result':
    case 'import_session_result':
    case 'export_session_result':
    case 'label_result':
    case 'set_session_name_result':
    case 'reload_result':
    case 'delete_session_result':
      break;
  }
}

export function routeTaskHistoryData(
  message: Extract<ExtensionEventMessage, { type: 'task_history_data' }>,
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

export function startExtensionMessageRouter(): () => void {
  const handler = (event: MessageEvent<ExtensionMessage>) => {
    routeExtensionMessage(event.data);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
