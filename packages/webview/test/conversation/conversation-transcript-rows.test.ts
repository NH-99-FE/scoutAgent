import { describe, expect, it } from 'vitest';
import type { ScoutBusyState, ScoutExtensionUIRequest } from '@scout-agent/shared';

import {
  createConversationTranscriptRows,
  createExtensionRequestsTranscriptAddon,
} from '@/features/conversation/render-model/conversation-transcript-rows';
import { createConversationTranscriptProjector } from '@/features/conversation/render-model/conversation-transcript-projector';
import type { ConversationRow } from '@/features/conversation/render-model/conversation-view-model';

const IDLE_BUSY_STATE: ScoutBusyState = { kind: 'idle', cancellable: false };

const SYSTEM_ROW: ConversationRow = {
  type: 'system',
  key: 'system-1',
  title: 'System',
  text: 'hello',
  tone: 'default',
  defaultOpen: true,
};

describe('createConversationTranscriptRows', () => {
  it('appends extension request addons before runtime status rows', () => {
    const request: ScoutExtensionUIRequest = {
      type: 'extension_ui_request',
      id: 'approval-1',
      method: 'confirm',
      title: 'Approve command',
      message: 'Proceed?',
    };
    const extensionRequestsAddon = createExtensionRequestsTranscriptAddon([request]);
    expect(extensionRequestsAddon).not.toBeNull();

    const rows = createConversationTranscriptRows({
      addons: extensionRequestsAddon ? [extensionRequestsAddon] : [],
      busyState: {
        kind: 'retry',
        label: 'Retrying',
        cancellable: true,
        attempt: 2,
        maxAttempts: 3,
        reason: 'rate limit',
      },
      rows: [SYSTEM_ROW],
    });

    expect(rows.map((row) => row.type)).toEqual(['system', 'extension_requests', 'runtime_status']);
    expect(rows[1]).toMatchObject({
      key: 'conversation-extension-requests',
      requests: [request],
    });
    expect(rows[2]).toMatchObject({
      key: 'runtime-status:retry:2:3:rate limit',
      label: '正在重试 2/3',
      detail: 'rate limit',
    });
  });

  it('does not append runtime status rows while idle', () => {
    const rows = createConversationTranscriptRows({
      busyState: IDLE_BUSY_STATE,
      rows: [SYSTEM_ROW],
    });

    expect(rows).toEqual([SYSTEM_ROW]);
  });

  it('does not create extension request addons for empty request lists', () => {
    expect(createExtensionRequestsTranscriptAddon([])).toBeNull();
  });
});

describe('createConversationTranscriptProjector', () => {
  it('reuses unchanged base rows and stable runtime status rows across projections', () => {
    const projector = createConversationTranscriptProjector();
    const busyState: ScoutBusyState = {
      kind: 'retry',
      label: 'Retrying',
      cancellable: true,
      attempt: 2,
      maxAttempts: 3,
      reason: 'rate limit',
    };

    const firstRows = projector.project({
      busyState,
      rows: [SYSTEM_ROW],
    });
    const nextRows = projector.project({
      busyState: { ...busyState },
      rows: [SYSTEM_ROW],
    });

    expect(nextRows).toBe(firstRows);
    expect(nextRows[0]).toBe(firstRows[0]);
    expect(nextRows[1]).toBe(firstRows[1]);
  });

  it('invalidates runtime status rows when display fields change', () => {
    const projector = createConversationTranscriptProjector();

    const firstRows = projector.project({
      busyState: {
        kind: 'retry',
        label: 'Retrying',
        cancellable: true,
        attempt: 2,
        maxAttempts: 3,
        reason: 'rate limit',
      },
      rows: [SYSTEM_ROW],
    });
    const nextRows = projector.project({
      busyState: {
        kind: 'retry',
        label: 'Retrying',
        cancellable: true,
        attempt: 3,
        maxAttempts: 3,
        reason: 'rate limit',
      },
      rows: [SYSTEM_ROW],
    });

    expect(nextRows).not.toBe(firstRows);
    expect(nextRows[0]).toBe(firstRows[0]);
    expect(nextRows[1]).not.toBe(firstRows[1]);
    expect(nextRows[1]).toMatchObject({ label: '正在重试 3/3' });
  });
});
