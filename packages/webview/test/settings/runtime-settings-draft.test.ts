import { describe, expect, it } from 'vitest';
import type { ScoutRuntimeSettingsState } from '@scout-agent/shared';
import {
  toEditableRuntimeSettingsState,
  toRuntimeSettingsPatch,
} from '@/features/settings/model/runtime-settings-draft';

describe('runtime settings draft', () => {
  it('converts extension paths between settings state and patch operations', () => {
    const state: ScoutRuntimeSettingsState = {
      globalSettingsPath: '/home/me/.scout/agent/settings.json',
      projectSettingsPath: '/workspace/.scout/settings.json',
      global: {},
      project: {
        extensions: ['./extensions/one', '../shared-extensions'],
      },
      effective: {
        extensions: ['./extensions/one', '../shared-extensions'],
      },
    };
    const editable = toEditableRuntimeSettingsState(state, {
      ...toEditableRuntimeSettingsState(state),
      scope: 'project',
    });

    expect(editable.project.extensionsText).toBe('./extensions/one\n../shared-extensions');

    const patch = toRuntimeSettingsPatch(
      { ...editable.project, extensionsText: './extensions/two\n\n../shared-extensions ' },
      new Set(['extensions']),
    );

    expect(patch).toEqual({
      operations: [
        { op: 'set', path: 'extensions', value: ['./extensions/two', '../shared-extensions'] },
      ],
    });
  });

  it('preserves tool profile settings in patch operations', () => {
    const state: ScoutRuntimeSettingsState = {
      globalSettingsPath: '/home/me/.scout/agent/settings.json',
      projectSettingsPath: '/workspace/.scout/settings.json',
      global: {
        defaultToolProfile: 'review',
        toolProfiles: [{ id: 'search-only', name: '只搜索', tools: ['read', 'grep'] }],
      },
      project: {},
      effective: {},
    };
    const editable = toEditableRuntimeSettingsState(state);
    const nextProfiles = [
      ...(editable.global.toolProfiles ?? []),
      { id: 'safe-edit', name: '安全编辑', tools: ['read', 'edit'] },
    ];

    const patch = toRuntimeSettingsPatch(
      {
        ...editable.global,
        defaultToolProfile: 'safe-edit',
        toolProfiles: nextProfiles,
      },
      new Set(['defaultToolProfile', 'toolProfiles']),
    );

    expect(patch).toEqual({
      operations: [
        { op: 'set', path: 'defaultToolProfile', value: 'safe-edit' },
        { op: 'set', path: 'toolProfiles', value: nextProfiles },
      ],
    });
  });

  it('preserves an unset project tool profile list for global inheritance', () => {
    const editable = toEditableRuntimeSettingsState({
      globalSettingsPath: '/home/me/.scout/agent/settings.json',
      projectSettingsPath: '/workspace/.scout/settings.json',
      global: {
        toolProfiles: [{ id: 'search-only', name: '只搜索', tools: ['read', 'grep'] }],
      },
      project: {},
      effective: {
        toolProfiles: [{ id: 'search-only', name: '只搜索', tools: ['read', 'grep'] }],
      },
    });

    expect(editable.project.toolProfiles).toBeUndefined();
    expect(editable.effective.toolProfiles).toEqual([
      { id: 'search-only', name: '只搜索', tools: ['read', 'grep'] },
    ]);
  });
});
