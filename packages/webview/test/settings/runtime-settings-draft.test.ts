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
});
