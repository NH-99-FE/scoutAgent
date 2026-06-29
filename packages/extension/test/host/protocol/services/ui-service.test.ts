import { describe, expect, it, vi } from 'vitest';
import { UiProtocolService } from '../../../../src/host/protocol/services/ui-service.ts';

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
