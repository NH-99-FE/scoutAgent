import { describe, expect, it } from 'vitest';
import type { ScoutSkillsSettings } from '@scout-agent/shared';
import {
  normalizeSkillEntries,
  toEditableSkillSettingsState,
} from '@/features/settings/model/skill-settings-draft';

describe('skill settings draft', () => {
  it('converts host skill settings into editable scope entries', () => {
    const settings: ScoutSkillsSettings = {
      projectDir: '/workspace/.scout/skills',
      globalDir: '/home/me/.scout/agent/skills',
      agentsDirs: [],
      globalEntries: ['../shared-skills'],
      projectEntries: ['./skills/project-skill'],
      configuredPaths: [],
      diagnostics: [],
      skills: [],
    };

    const editable = toEditableSkillSettingsState(settings, {
      ...toEditableSkillSettingsState(settings),
      scope: 'global',
    });

    expect(editable.scope).toBe('global');
    expect(editable.globalEntries).toEqual(['../shared-skills']);
    expect(editable.projectEntries).toEqual(['./skills/project-skill']);
  });

  it('normalizes empty skill path rows before saving', () => {
    expect(normalizeSkillEntries([' ./skills/review ', '', '  ../shared-skills  '])).toEqual([
      './skills/review',
      '../shared-skills',
    ]);
  });
});
