// ============================================================
// Protocol response projector — request-scoped payload 到 UI store 的投影
// ============================================================

import type {
  ScoutCommandResult,
  ScoutProtocolResponsePayload,
  ScoutTaskHistoryResult,
  ScoutWebviewState,
} from '@scout-agent/shared';
import { useConfigStore } from '@/store/config-store';
import { HOME_COMPOSER_SESSION_ID, useComposerStore } from '@/store/composer-store';
import { useConversationStore } from '@/store/conversation-store';
import { useSessionStore } from '@/store/session-store';
import { useTaskStore } from '@/store/task-store';
import { useTreeStore } from '@/store/tree-store';
import { useUiStore } from '@/store/ui-store';

export function projectProtocolResponsePayload(
  payload: ScoutProtocolResponsePayload,
  queryToken?: string,
): void {
  switch (payload.type) {
    case 'bootstrap_result':
      useConfigStore.getState().actions.setConfig(payload.config);
      useConfigStore.getState().actions.setCommands(payload.commands);
      applyStateSnapshotToStores(payload.state);
      if (payload.sessions) {
        useSessionStore.getState().actions.setSessions(payload.sessions);
      }
      if (payload.recentTasks) {
        useTaskStore.getState().actions.setRecentTasks(payload.recentTasks);
      }
      if (payload.tree) {
        useTreeStore.getState().actions.setTreeData(payload.tree.nodes, payload.tree.leafId);
      }
      break;
    case 'state_result':
      applyStateSnapshotToStores(payload.state);
      break;
    case 'config_result':
      useConfigStore.getState().actions.setConfig(payload.config);
      break;
    case 'commands_result':
      useConfigStore.getState().actions.setCommands(payload.commands);
      break;
    case 'context_usage_result':
      useConversationStore.getState().actions.setContextUsage(payload.contextUsage);
      break;
    case 'sessions_result':
      useSessionStore.getState().actions.setSessions(payload.sessions);
      break;
    case 'tree_result':
      useTreeStore.getState().actions.setTreeData(payload.tree, payload.leafId);
      break;
    case 'task_history_result':
      projectTaskHistoryResult(payload, queryToken);
      break;
    case 'file_mentions_result':
      break;
    default:
      projectCommandResult(payload);
      break;
  }
}

export function projectTaskHistoryResult(
  message: ScoutTaskHistoryResult,
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

function applyStateSnapshotToStores(state: ScoutWebviewState): void {
  useConversationStore.getState().actions.applyStateSnapshot(state);
  useSessionStore.getState().actions.applyState(state);
  useTreeStore.getState().actions.applyState(state);
  useUiStore.getState().actions.resolveOpenTask(state.sessionFile);
  useUiStore.getState().actions.setDiagnostics(state.diagnostics ?? []);
}

function projectCommandResult(message: ScoutCommandResult): void {
  if (message.type === 'open_task_result') {
    if (!message.success) {
      useUiStore.getState().actions.completeOpenTask(message.success);
      useUiStore.getState().actions.setNotification({
        type: 'notification',
        level: 'error',
        message: message.error ?? 'Open task failed',
      });
    }
    return;
  }

  if (message.type === 'new_session_result') {
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
    return;
  }

  if (message.type === 'navigate_tree_result') {
    useTreeStore.getState().actions.setEditorText(message.editorText);
    if (!message.success) {
      useUiStore.getState().actions.setNotification({
        type: 'notification',
        level: 'error',
        message: message.error ?? 'Tree navigation failed',
      });
    }
    return;
  }

  if (message.type === 'import_session_result' && !message.success && message.error === 'cancelled') {
    return;
  }

  if (!message.success) {
    useUiStore.getState().actions.setNotification({
      type: 'notification',
      level: 'error',
      message: message.error ?? 'Request failed',
    });
  }
}
