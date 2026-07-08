// ============================================================
// Skill Settings Draft — Skills 设置表单数据
// ============================================================

import type { ScoutSkillsSettings, ScoutSkillScope } from '@scout-agent/shared';

export interface EditableSkillSettingsState {
  scope: ScoutSkillScope;
  settings: ScoutSkillsSettings;
  globalEntries: string[];
  projectEntries: string[];
}

export const EMPTY_SKILLS_SETTINGS: ScoutSkillsSettings = {
  projectDir: '',
  globalDir: '',
  agentsDirs: [],
  globalEntries: [],
  projectEntries: [],
  configuredPaths: [],
  diagnostics: [],
  skills: [],
};

export const EMPTY_SKILL_SETTINGS_STATE: EditableSkillSettingsState = {
  scope: 'project',
  settings: EMPTY_SKILLS_SETTINGS,
  globalEntries: [],
  projectEntries: [],
};

export function toEditableSkillSettingsState(
  settings: ScoutSkillsSettings,
  previous?: EditableSkillSettingsState,
): EditableSkillSettingsState {
  return {
    scope: previous?.scope ?? 'project',
    settings,
    globalEntries: [...settings.globalEntries],
    projectEntries: [...settings.projectEntries],
  };
}

export function normalizeSkillEntries(entries: string[]): string[] {
  return entries.map((entry) => entry.trim()).filter(Boolean);
}
