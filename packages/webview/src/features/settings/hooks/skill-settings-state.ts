// ============================================================
// Skill Settings State — Skills 管理协议状态
// ============================================================

import { useCallback } from 'react';
import type {
  ScoutSkillListItem,
  ScoutSkillResourceScope,
  ScoutSkillScope,
  ScoutSkillToggleIntent,
} from '@scout-agent/shared';
import { protocolClient } from '@/bridge/protocol-client';
import {
  EMPTY_SKILL_SETTINGS_STATE,
  normalizeSkillEntries,
  toEditableSkillSettingsState,
  type EditableSkillSettingsState,
} from '../model/skill-settings-draft';
import {
  appendEditableResourcePathEntry,
  getEditableResourcePathEntries,
  removeEditableResourcePathEntry,
  updateEditableResourcePathEntry,
} from '../model/resource-path-draft';
import { areSettingsDraftValuesEqual } from '../model/settings-draft-utils';
import { useSettingsDraftMachine, type SavedDraftMergeContext } from './use-settings-draft-machine';
import { useLazySettingsLoad, useSettingsRequestLifecycle } from './use-settings-request-lifecycle';

const SKILL_SETTINGS_SCOPES = ['global', 'project'] as const;

export interface SkillSettingsController {
  draft: EditableSkillSettingsState;
  currentEntries: string[];
  isLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  hasUnsavedChanges: boolean;
  saved: boolean;
  error: string;
  load: () => void;
  discard: () => void;
  save: () => void;
  setScope: (scope: ScoutSkillScope) => void;
  addEntry: () => void;
  updateEntry: (index: number, value: string) => void;
  removeEntry: (index: number) => void;
  getSkillEnabled: (skill: ScoutSkillListItem) => boolean;
  toggleSkillEnabled: (skill: ScoutSkillListItem, enabled: boolean) => void;
  openSkillFile: (path: string) => void;
}

type DirtyScopes = Record<ScoutSkillScope, boolean>;
type SkillToggleIntentsByScope = Record<ScoutSkillScope, ScoutSkillToggleIntent[]>;

interface SkillSettingsMachineDraft {
  value: EditableSkillSettingsState;
  toggles: SkillToggleIntentsByScope;
}

const EMPTY_SKILL_SETTINGS_MACHINE_DRAFT: SkillSettingsMachineDraft = {
  value: EMPTY_SKILL_SETTINGS_STATE,
  toggles: createEmptySkillToggleIntentsByScope(),
};

export function useSkillSettingsController(enabled = true): SkillSettingsController {
  const draftMachine = useSettingsDraftMachine({
    initialDraft: EMPTY_SKILL_SETTINGS_MACHINE_DRAFT,
    scopes: SKILL_SETTINGS_SCOPES,
    isScopeDirty: isSkillScopeDirty,
  });
  const {
    draft: machineDraft,
    dirtyScopes: machineDirtyScopes,
    hasUnsavedChanges,
    hydrate,
    edit,
    replace,
    discard: discardDraft,
    commitSaved,
    getSnapshot,
    getScopeRevision,
  } = draftMachine;
  const draft = machineDraft.value;
  const toggleIntentsByScope = machineDraft.toggles;
  const dirtyScopes: DirtyScopes = machineDirtyScopes;
  const {
    isLoading,
    isSaving,
    error,
    savedScope,
    beginRequest,
    isCurrentRequest,
    isMounted,
    beginLoad,
    finishLoad,
    beginSave,
    finishSave,
    clearFeedback,
    reportError,
  } = useSettingsRequestLifecycle<ScoutSkillScope>();

  const requestSettings = useCallback(() => {
    const requestId = beginRequest('load');

    protocolClient.requestSkills(
      (result) => {
        if (!isCurrentRequest('load', requestId)) return;
        const current = getSnapshot().draft.value;
        hydrate({
          value: toEditableSkillSettingsState(result.settings, current),
          toggles: createEmptySkillToggleIntentsByScope(),
        });
        finishLoad();
      },
      (message) => {
        if (!isCurrentRequest('load', requestId)) return;
        finishLoad(message);
      },
    );
  }, [beginRequest, finishLoad, getSnapshot, hydrate, isCurrentRequest]);

  const requestLoad = useLazySettingsLoad(enabled, requestSettings);

  const load = useCallback(() => {
    beginLoad();
    requestLoad();
  }, [beginLoad, requestLoad]);

  const discard = useCallback(() => {
    discardDraft((baseline, current) => ({
      ...baseline,
      value: { ...baseline.value, scope: current.value.scope },
    }));
    clearFeedback();
  }, [clearFeedback, discardDraft]);

  const setScope = useCallback(
    (scope: ScoutSkillScope) => {
      replace((current) => ({
        ...current,
        value: { ...current.value, scope },
      }));
    },
    [replace],
  );

  const markChanged = useCallback(
    (scope: ScoutSkillScope) => {
      clearFeedback(scope);
    },
    [clearFeedback],
  );

  const updateEntriesForScope = useCallback(
    (
      scope: ScoutSkillScope,
      updater: (entries: string[]) => string[],
      options: { selectScope?: boolean } = {},
    ) => {
      const key = scope === 'global' ? 'globalEntries' : 'projectEntries';
      edit(scope, (current) => ({
        ...current,
        value: {
          ...current.value,
          scope: options.selectScope ? scope : current.value.scope,
          [key]: updater(current.value[key]),
        },
      }));
      markChanged(scope);
    },
    [edit, markChanged],
  );

  const updateEntries = useCallback(
    (updater: (entries: string[]) => string[]) => {
      updateEntriesForScope(getSnapshot().draft.value.scope, updater);
    },
    [getSnapshot, updateEntriesForScope],
  );

  const addEntry = useCallback(() => {
    updateEntries(appendEditableResourcePathEntry);
  }, [updateEntries]);

  const updateEntry = useCallback(
    (index: number, value: string) => {
      updateEntries((entries) => updateEditableResourcePathEntry(entries, index, value));
    },
    [updateEntries],
  );

  const removeEntry = useCallback(
    (index: number) => {
      updateEntries((entries) => removeEditableResourcePathEntry(entries, index));
    },
    [updateEntries],
  );

  const getSkillEnabled = useCallback(
    (skill: ScoutSkillListItem): boolean => {
      const scope = toSkillToggleScope(skill.scope);
      const pending = scope
        ? findSkillToggleIntent(toggleIntentsByScope[scope], skill.path)
        : undefined;
      return pending?.enabled ?? skill.status !== 'disabled';
    },
    [toggleIntentsByScope],
  );

  const toggleSkillEnabled = useCallback(
    (skill: ScoutSkillListItem, enabled: boolean) => {
      if (!skill.canToggle) return;
      const scope = toSkillToggleScope(skill.scope);
      if (!scope || scope !== getSnapshot().draft.value.scope) return;

      edit(scope, (current) => ({
        ...current,
        toggles: {
          ...current.toggles,
          [scope]: upsertSkillToggleIntent(
            current.toggles[scope],
            skill.path,
            enabled,
            skill.status !== 'disabled',
          ),
        },
      }));
      markChanged(scope);
    },
    [edit, getSnapshot, markChanged],
  );

  const save = useCallback(() => {
    const saveDraft = getSnapshot().draft;
    const saveScope = saveDraft.value.scope;
    const entries =
      saveScope === 'global'
        ? normalizeSkillEntries(saveDraft.value.globalEntries)
        : normalizeSkillEntries(saveDraft.value.projectEntries);
    const requestId = beginRequest('save');
    const submittedScopeRevision = getScopeRevision(saveScope);
    beginSave(saveScope);

    protocolClient.saveSkillsSettings(
      saveScope,
      entries,
      saveDraft.toggles[saveScope],
      (result) => {
        if (!isCurrentRequest('save', requestId)) return;
        if (!result.success) {
          finishSave(saveScope, { error: result.error ?? '保存 Skills 设置失败' });
          return;
        }
        const scopeUnchanged = submittedScopeRevision === getScopeRevision(saveScope);
        if (result.settings) {
          const currentBaseline = getSnapshot().baseline.value;
          commitSaved({
            scope: saveScope,
            submittedScopeRevision,
            baseline: {
              value: toEditableSkillSettingsState(result.settings, currentBaseline),
              toggles: createEmptySkillToggleIntentsByScope(),
            },
            merge: mergeSavedSkillDraft,
          });
        }
        if (scopeUnchanged) {
          finishSave(saveScope, { error: result.error ?? '', saved: true });
        } else {
          finishSave(saveScope);
        }
      },
      (message) => {
        if (!isCurrentRequest('save', requestId)) return;
        finishSave(saveScope, { error: message });
      },
    );
  }, [
    beginSave,
    beginRequest,
    commitSaved,
    finishSave,
    getScopeRevision,
    getSnapshot,
    isCurrentRequest,
  ]);

  const openSkillFile = useCallback(
    (filePath: string) => {
      protocolClient.openSkillFile(filePath, (result) => {
        if (!isMounted()) return;
        if (!result.success) {
          reportError(result.error ?? '打开 Skill 失败');
        }
      });
    },
    [isMounted, reportError],
  );

  return {
    draft,
    currentEntries: getEditableResourcePathEntries(
      draft.scope === 'global' ? draft.globalEntries : draft.projectEntries,
    ),
    isLoading,
    isSaving,
    isDirty: dirtyScopes[draft.scope],
    hasUnsavedChanges,
    saved: savedScope === draft.scope,
    error,
    load,
    discard,
    save,
    setScope,
    addEntry,
    updateEntry,
    removeEntry,
    getSkillEnabled,
    toggleSkillEnabled,
    openSkillFile,
  };
}

function isSkillScopeDirty(
  draft: SkillSettingsMachineDraft,
  baseline: SkillSettingsMachineDraft,
  scope: ScoutSkillScope,
): boolean {
  const key = scope === 'global' ? 'globalEntries' : 'projectEntries';
  return (
    draft.toggles[scope].length > 0 ||
    !areSettingsDraftValuesEqual(draft.value[key], baseline.value[key])
  );
}

function createEmptySkillToggleIntentsByScope(): SkillToggleIntentsByScope {
  return {
    global: [],
    project: [],
  };
}

function toSkillToggleScope(scope: ScoutSkillResourceScope): ScoutSkillScope | undefined {
  return scope === 'global' || scope === 'project' ? scope : undefined;
}

function findSkillToggleIntent(
  intents: ScoutSkillToggleIntent[],
  skillPath: string,
): ScoutSkillToggleIntent | undefined {
  return intents.find((intent) => intent.path === skillPath);
}

function upsertSkillToggleIntent(
  intents: ScoutSkillToggleIntent[],
  skillPath: string,
  enabled: boolean,
  baselineEnabled: boolean,
): ScoutSkillToggleIntent[] {
  const next = intents.filter((intent) => intent.path !== skillPath);
  if (enabled === baselineEnabled) return next;
  return [...next, { path: skillPath, enabled }];
}

function mergeSavedSkillDraft({
  draft,
  nextBaseline,
  saveScope,
  scopeUnchanged,
  dirtyScopesBeforeSave,
}: SavedDraftMergeContext<SkillSettingsMachineDraft, ScoutSkillScope>): SkillSettingsMachineDraft {
  const next: SkillSettingsMachineDraft = {
    value: { ...nextBaseline.value, scope: draft.value.scope },
    toggles: { ...nextBaseline.toggles },
  };
  for (const scope of SKILL_SETTINGS_SCOPES) {
    const preserve = scope === saveScope ? !scopeUnchanged : dirtyScopesBeforeSave[scope];
    if (!preserve) continue;
    const key = scope === 'global' ? 'globalEntries' : 'projectEntries';
    next.value[key] = draft.value[key];
    next.toggles[scope] = draft.toggles[scope];
  }
  return next;
}
