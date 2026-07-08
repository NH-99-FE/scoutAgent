import { describe, expect, it } from 'vitest';
import type { ScoutRuntimeSettingsState } from '@scout-agent/shared';
import {
  toEditableRuntimeSettingsState,
  toRuntimeSettingsPatch,
} from '@/features/settings/model/runtime-settings-draft';

describe('runtime settings draft', () => {
  it('converts skills paths between settings state and patch operations', () => {
    const state: ScoutRuntimeSettingsState = {
      globalSettingsPath: '/home/me/.scout/agent/settings.json',
      projectSettingsPath: '/workspace/.scout/settings.json',
      global: {},
      project: {
        skills: ['./skills/one', '../shared-skills'],
      },
      effective: {
        skills: ['./skills/one', '../shared-skills'],
      },
    };
    const editable = toEditableRuntimeSettingsState(state, {
      ...toEditableRuntimeSettingsState(state),
      scope: 'project',
    });

    expect(editable.project.skillsText).toBe('./skills/one\n../shared-skills');

    const patch = toRuntimeSettingsPatch(
      { ...editable.project, skillsText: './skills/two\n\n../shared-skills ' },
      new Set(['skills']),
    );

    expect(patch).toEqual({
      operations: [{ op: 'set', path: 'skills', value: ['./skills/two', '../shared-skills'] }],
    });
  });
});
