// ============================================================
// Conversation Transcript Rows — 可滚动 transcript 行合成
// ============================================================

import type { ScoutBusyState, ScoutExtensionUIRequest } from '@scout-agent/shared';
import type { ConversationRow } from './conversation-view-model';
import {
  CONVERSATION_EXTENSION_REQUESTS_MESSAGE_ID,
  getRuntimeStatusMessageId,
} from './conversation-message-ids';

export type ConversationTranscriptRow =
  | ConversationRow
  | ConversationExtensionRequestsTranscriptRow
  | ConversationRuntimeStatusTranscriptRow;

export type ConversationTranscriptAddon = ConversationExtensionRequestsTranscriptRow;

export interface ConversationExtensionRequestsTranscriptRow {
  type: 'extension_requests';
  key: string;
  requests: ScoutExtensionUIRequest[];
}

export interface ConversationRuntimeStatusTranscriptRow {
  type: 'runtime_status';
  key: string;
  statusKind: ScoutBusyState['kind'];
  label: string;
  detail: string;
}

export function createConversationTranscriptRows({
  addons = [],
  busyState,
  rows,
}: {
  addons?: ConversationTranscriptAddon[];
  busyState: ScoutBusyState;
  rows: ConversationRow[];
}): ConversationTranscriptRow[] {
  const transcriptRows: ConversationTranscriptRow[] = [...rows, ...addons];

  const runtimeStatus = createRuntimeStatusTranscriptRow(busyState);
  if (runtimeStatus) {
    transcriptRows.push(runtimeStatus);
  }

  return transcriptRows;
}

export function createExtensionRequestsTranscriptAddon(
  requests: ScoutExtensionUIRequest[],
): ConversationExtensionRequestsTranscriptRow | null {
  if (requests.length === 0) return null;
  return {
    type: 'extension_requests',
    key: CONVERSATION_EXTENSION_REQUESTS_MESSAGE_ID,
    requests,
  };
}

function createRuntimeStatusTranscriptRow(
  busyState: ScoutBusyState,
): ConversationRuntimeStatusTranscriptRow | null {
  if (busyState.kind === 'retry') {
    const attempt =
      busyState.attempt !== undefined && busyState.maxAttempts !== undefined
        ? `${busyState.attempt}/${busyState.maxAttempts}`
        : '';
    const key = [
      'retry',
      busyState.attempt ?? '',
      busyState.maxAttempts ?? '',
      busyState.reason ?? '',
    ].join(':');

    return {
      type: 'runtime_status',
      key: getRuntimeStatusMessageId(key),
      statusKind: busyState.kind,
      label: attempt ? `正在重试 ${attempt}` : '正在重试',
      detail: busyState.reason ?? '',
    };
  }

  return null;
}
