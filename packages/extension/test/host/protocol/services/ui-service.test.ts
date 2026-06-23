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
});
