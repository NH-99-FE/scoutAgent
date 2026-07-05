import { describe, expect, it, vi } from 'vitest';
import type { FileReviewTurnSnapshot } from '../../../../src/core/review/file-review.ts';
import type { FileReviewArtifact } from '../../../../src/host/review/file-review-artifact.ts';
import { UiProtocolService } from '../../../../src/host/protocol/services/ui-service.ts';

function makeReviewSnapshot(turnId: string, recordId: string): FileReviewTurnSnapshot {
  return {
    turnId,
    records: [
      {
        recordId,
        turnId,
        toolCallId: 'tool-1',
        operation: 'edit',
        path: 'src/app.ts',
        absolutePath: '/workspace/src/app.ts',
        sequence: 1,
      },
    ],
    files: [
      {
        absolutePath: '/workspace/src/app.ts',
        path: 'src/app.ts',
        originalContent: 'old\n',
        modifiedContent: 'new\n',
        recordIds: [recordId],
        latestRecordId: recordId,
        latestSequence: 1,
        additions: 1,
        deletions: 1,
      },
    ],
  };
}

function makeReviewArtifact(turnId: string, recordId: string): FileReviewArtifact {
  return {
    version: 1,
    sessionId: 'session-1',
    turnId,
    createdAt: '2026-01-01T00:00:00.000Z',
    records: [
      {
        recordId,
        turnId,
        toolCallId: 'tool-1',
        operation: 'edit',
        path: 'src/app.ts',
        absolutePath: '/workspace/src/app.ts',
        sequence: 1,
      },
    ],
    files: [
      {
        absolutePath: '/workspace/src/app.ts',
        path: 'src/app.ts',
        recordIds: [recordId],
        latestRecordId: recordId,
        latestSequence: 1,
        additions: 1,
        deletions: 1,
        rows: [
          { type: 'removed', oldLineNumber: 1, text: 'old' },
          { type: 'added', newLineNumber: 1, text: 'new' },
        ],
      },
    ],
  };
}

describe('UiProtocolService', () => {
  it('responds with builtin and extension commands', () => {
    const publishEvent = vi.fn();
    const respond = vi.fn();
    const service = new UiProtocolService({
      getExtensionCommands: () => [
        {
          name: 'custom',
          description: 'Custom command',
          source: 'extension',
          sourceInfo: {
            path: '/workspace/.scout/extension.ts',
            source: 'custom',
            scope: 'project',
            origin: 'top-level',
          },
        },
      ],
      publishEvent,
    });

    service.requestCommands(respond);

    const response = respond.mock.calls[0]?.[0];
    expect(response).toMatchObject({ type: 'commands_result' });
    expect(response.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'tree', source: 'builtin' }),
        expect.objectContaining({ name: 'compact', source: 'builtin' }),
        expect.objectContaining({ name: 'custom', source: 'extension' }),
      ]),
    );
    expect(response.commands).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'settings', source: 'builtin' })]),
    );
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('responds when opening registered panels succeeds', async () => {
    const openSettingsPanel = vi.fn(async () => undefined);
    const openTreePanel = vi.fn(async () => undefined);
    const service = new UiProtocolService({
      getExtensionCommands: () => [],
      publishEvent: vi.fn(),
      openSettingsPanel,
      openTreePanel,
    });
    const respond = vi.fn();

    await service.openSettingsPanel(respond);
    await service.openTreePanel(respond);

    expect(openSettingsPanel).toHaveBeenCalledTimes(1);
    expect(openTreePanel).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith({
      type: 'open_settings_panel_result',
      success: true,
    });
    expect(respond).toHaveBeenCalledWith({
      type: 'open_tree_panel_result',
      success: true,
    });
  });

  it('returns an error when a panel is not registered', async () => {
    const service = new UiProtocolService({
      getExtensionCommands: () => [],
      publishEvent: vi.fn(),
    });
    const respond = vi.fn();

    await service.openSettingsPanel(respond);
    await service.openTreePanel(respond);

    expect(respond).toHaveBeenCalledWith({
      type: 'open_settings_panel_result',
      success: false,
      error: 'Settings panel is not registered',
    });
    expect(respond).toHaveBeenCalledWith({
      type: 'open_tree_panel_result',
      success: false,
      error: 'Tree panel is not registered',
    });
  });

  it('opens a persisted artifact when the requested runtime review is unavailable', async () => {
    const artifact = makeReviewArtifact('turn-1', 'review-1');
    const openChangesReviewPanel = vi.fn(async () => undefined);
    const respond = vi.fn();
    const service = new UiProtocolService({
      getExtensionCommands: () => [],
      publishEvent: vi.fn(),
      getChangesReview: () => undefined,
      getChangesReviewArtifact: () => artifact,
      openChangesReviewPanel,
    });

    await service.openChangesReview(
      {
        type: 'open_changes_review',
        turnId: 'turn-1',
        recordId: 'review-1',
      },
      respond,
    );

    expect(openChangesReviewPanel).toHaveBeenCalledWith(artifact, {
      allowCurrentFileContextExpansion: false,
      recordId: 'review-1',
    });
    expect(respond).toHaveBeenCalledWith({
      type: 'open_changes_review_result',
      success: true,
    });
  });

  it('prefers a persisted artifact over the requested runtime review', async () => {
    const requestedReview = makeReviewSnapshot('turn-1', 'review-1');
    const artifact = makeReviewArtifact('turn-1', 'review-1');
    const openChangesReviewPanel = vi.fn(async () => undefined);
    const respond = vi.fn();
    const service = new UiProtocolService({
      getExtensionCommands: () => [],
      publishEvent: vi.fn(),
      getChangesReview: () => requestedReview,
      getChangesReviewArtifact: () => artifact,
      canExpandChangesReviewContext: () => true,
      openChangesReviewPanel,
    });

    await service.openChangesReview(
      {
        type: 'open_changes_review',
        turnId: 'turn-1',
        recordId: 'review-1',
      },
      respond,
    );

    expect(openChangesReviewPanel).toHaveBeenCalledWith(artifact, {
      allowCurrentFileContextExpansion: true,
      recordId: 'review-1',
    });
    expect(respond).toHaveBeenCalledWith({
      type: 'open_changes_review_result',
      success: true,
    });
  });

  it('does not open released runtime review snapshots when no artifact is available', async () => {
    const releasedReview = {
      ...makeReviewSnapshot('turn-1', 'review-1'),
      contentReleased: true,
    };
    const openChangesReviewPanel = vi.fn(async () => undefined);
    const respond = vi.fn();
    const service = new UiProtocolService({
      getExtensionCommands: () => [],
      publishEvent: vi.fn(),
      getChangesReview: () => releasedReview,
      getChangesReviewArtifact: () => undefined,
      openChangesReviewPanel,
    });

    await service.openChangesReview(
      {
        type: 'open_changes_review',
        turnId: 'turn-1',
        recordId: 'review-1',
      },
      respond,
    );

    expect(openChangesReviewPanel).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith({
      type: 'open_changes_review_result',
      success: false,
      error: 'Changes are no longer available',
    });
  });

  it('returns unavailable when the requested record is absent from the review', async () => {
    const artifact = makeReviewArtifact('turn-1', 'review-2');
    const openChangesReviewPanel = vi.fn(async () => undefined);
    const respond = vi.fn();
    const service = new UiProtocolService({
      getExtensionCommands: () => [],
      publishEvent: vi.fn(),
      getChangesReview: () => undefined,
      getChangesReviewArtifact: () => artifact,
      openChangesReviewPanel,
    });

    await service.openChangesReview(
      {
        type: 'open_changes_review',
        turnId: 'turn-1',
        recordId: 'review-1',
      },
      respond,
    );

    expect(openChangesReviewPanel).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith({
      type: 'open_changes_review_result',
      success: false,
      error: 'Changes are no longer available',
    });
  });

  it('opens the current changes review panel with the active landed review', async () => {
    const activeReview = makeReviewSnapshot('turn-1', 'review-1');
    const openCurrentChangesReviewPanel = vi.fn(async () => undefined);
    const respond = vi.fn();
    const service = new UiProtocolService({
      getExtensionCommands: () => [],
      publishEvent: vi.fn(),
      getCurrentChangesReview: () => activeReview,
      getCurrentCwd: () => '/workspace',
      getCurrentSessionId: () => 'session-1',
      openCurrentChangesReviewPanel,
    });

    await service.openCurrentChangesReview(respond);

    expect(openCurrentChangesReviewPanel).toHaveBeenCalledWith(activeReview, {
      cwd: '/workspace',
      sessionId: 'session-1',
    });
    expect(respond).toHaveBeenCalledWith({
      type: 'open_current_changes_review_result',
      success: true,
    });
  });

  it('opens the current changes review panel in pending state before files land', async () => {
    const openCurrentChangesReviewPanel = vi.fn(async () => undefined);
    const respond = vi.fn();
    const service = new UiProtocolService({
      getExtensionCommands: () => [],
      publishEvent: vi.fn(),
      getCurrentCwd: () => '/workspace',
      getCurrentSessionId: () => 'session-1',
      openCurrentChangesReviewPanel,
    });

    await service.openCurrentChangesReview(respond);

    expect(openCurrentChangesReviewPanel).toHaveBeenCalledWith(undefined, {
      cwd: '/workspace',
      sessionId: 'session-1',
    });
    expect(respond).toHaveBeenCalledWith({
      type: 'open_current_changes_review_result',
      success: true,
    });
  });

  it('resolves extension confirm requests from webview responses', async () => {
    const publishEvent = vi.fn();
    const service = new UiProtocolService({
      getExtensionCommands: () => [],
      publishEvent,
    });
    const ui = service.createExtensionUIContext();

    const result = ui.confirm('Dangerous command', 'rm -rf tmp');
    const request = publishEvent.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      type: 'extension_ui_request',
      method: 'confirm',
      title: 'Dangerous command',
      message: 'rm -rf tmp',
    });

    service.extensionUIResponse({
      type: 'extension_ui_response',
      id: request.id,
      action: 'confirm',
    });

    await expect(result).resolves.toBe(true);
    expect(publishEvent).toHaveBeenLastCalledWith({
      type: 'extension_ui_request_closed',
      id: request.id,
      reason: 'responded',
    });
  });

  it('resolves extension select and input requests from webview responses', async () => {
    const publishEvent = vi.fn();
    const service = new UiProtocolService({
      getExtensionCommands: () => [],
      publishEvent,
    });
    const ui = service.createExtensionUIContext();

    const selected = ui.select('Choose', ['Yes', 'No'], {
      body: { kind: 'text', text: 'Pick one' },
      variant: 'danger',
    });
    const selectRequest = publishEvent.mock.calls[0]?.[0];
    expect(selectRequest).toMatchObject({
      type: 'extension_ui_request',
      body: { kind: 'text', text: 'Pick one' },
      method: 'select',
      options: ['Yes', 'No'],
      title: 'Choose',
      variant: 'danger',
    });
    service.extensionUIResponse({
      type: 'extension_ui_response',
      id: selectRequest.id,
      action: 'select',
      value: 'Yes',
    });
    await expect(selected).resolves.toBe('Yes');

    const input = ui.input('Name', 'placeholder');
    const inputRequest = publishEvent.mock.calls.at(-1)?.[0];
    service.extensionUIResponse({
      type: 'extension_ui_response',
      id: inputRequest.id,
      action: 'input',
      value: 'Scout',
    });
    await expect(input).resolves.toBe('Scout');
  });

  it('exposes pending extension UI requests for bootstrap snapshots', async () => {
    const publishEvent = vi.fn();
    const service = new UiProtocolService({
      getExtensionCommands: () => [],
      publishEvent,
    });
    const ui = service.createExtensionUIContext();

    const result = ui.select('危险命令', ['Yes', 'No'], {
      body: { kind: 'code', text: '/bin/rm -rf tmp' },
      timeout: 300000,
      variant: 'danger',
    });
    const request = publishEvent.mock.calls[0]?.[0];

    expect(service.getPendingExtensionUIRequests()).toEqual([
      expect.objectContaining({
        id: request.id,
        method: 'select',
        body: { kind: 'code', text: '/bin/rm -rf tmp' },
        variant: 'danger',
      }),
    ]);

    service.extensionUIResponse({
      type: 'extension_ui_response',
      id: request.id,
      action: 'cancel',
    });

    await expect(result).resolves.toBeUndefined();
    expect(service.getPendingExtensionUIRequests()).toEqual([]);
  });

  it('cancels pending extension UI requests', async () => {
    const publishEvent = vi.fn();
    const service = new UiProtocolService({
      getExtensionCommands: () => [],
      publishEvent,
    });
    const ui = service.createExtensionUIContext();

    const result = ui.select('Choose', ['Yes', 'No']);
    const request = publishEvent.mock.calls[0]?.[0];
    service.cancelExtensionUIRequests('session_replacement');

    await expect(result).resolves.toBeUndefined();
    expect(publishEvent).toHaveBeenLastCalledWith({
      type: 'extension_ui_request_closed',
      id: request.id,
      reason: 'session_replacement',
    });
  });

  it('ignores unknown extension UI responses', () => {
    const publishEvent = vi.fn();
    const service = new UiProtocolService({
      getExtensionCommands: () => [],
      publishEvent,
    });

    service.extensionUIResponse({
      type: 'extension_ui_response',
      id: 'missing',
      action: 'cancel',
    });

    expect(publishEvent).not.toHaveBeenCalled();
  });
});
