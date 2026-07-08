// ============================================================
// Skill Settings State — Skills 管理协议状态
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
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

export interface SkillSettingsController {
  draft: EditableSkillSettingsState;
  currentEntries: string[];
  isLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  saved: boolean;
  error: string;
  load: () => void;
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

export function useSkillSettingsController(): SkillSettingsController {
  const [draft, setDraft] = useState<EditableSkillSettingsState>(EMPTY_SKILL_SETTINGS_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [dirtyScopes, setDirtyScopes] = useState<DirtyScopes>({ global: false, project: false });
  const [toggleIntentsByScope, setToggleIntentsByScope] = useState<SkillToggleIntentsByScope>(
    createEmptySkillToggleIntentsByScope,
  );
  const [error, setError] = useState('');
  const [savedScope, setSavedScope] = useState<ScoutSkillScope | null>(null);
  const mountedRef = useRef(true);
  const loadRequestRef = useRef(0);
  const saveRequestRef = useRef(0);
  const draftVersionRef = useRef(0);
  const draftVersionByScopeRef = useRef<Record<ScoutSkillScope, number>>({
    global: 0,
    project: 0,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const requestSettings = useCallback(() => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;

    protocolClient.requestSkills(
      (result) => {
        if (!mountedRef.current || requestId !== loadRequestRef.current) return;
        setDraft((current) => toEditableSkillSettingsState(result.settings, current));
        draftVersionRef.current += 1;
        draftVersionByScopeRef.current.global += 1;
        draftVersionByScopeRef.current.project += 1;
        setDirtyScopes({ global: false, project: false });
        setToggleIntentsByScope(createEmptySkillToggleIntentsByScope());
        setSavedScope(null);
        setError('');
        setIsLoading(false);
      },
      (message) => {
        if (!mountedRef.current || requestId !== loadRequestRef.current) return;
        setError(message);
        setSavedScope(null);
        setIsLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    requestSettings();
  }, [requestSettings]);

  const load = useCallback(() => {
    setIsLoading(true);
    setError('');
    setSavedScope(null);
    requestSettings();
  }, [requestSettings]);

  const setScope = useCallback((scope: ScoutSkillScope) => {
    setDraft((current) => ({ ...current, scope }));
  }, []);

  const markChanged = useCallback((scope: ScoutSkillScope) => {
    draftVersionRef.current += 1;
    draftVersionByScopeRef.current[scope] += 1;
    setDirtyScopes((current) => ({ ...current, [scope]: true }));
    setSavedScope((current) => (current === scope ? null : current));
    setError('');
  }, []);

  const updateEntriesForScope = useCallback(
    (
      scope: ScoutSkillScope,
      updater: (entries: string[]) => string[],
      options: { selectScope?: boolean } = {},
    ) => {
      const key = scope === 'global' ? 'globalEntries' : 'projectEntries';
      setDraft((current) => ({
        ...current,
        scope: options.selectScope ? scope : current.scope,
        [key]: updater(current[key]),
      }));
      markChanged(scope);
    },
    [markChanged],
  );

  const updateEntries = useCallback(
    (updater: (entries: string[]) => string[]) => {
      updateEntriesForScope(draft.scope, updater);
    },
    [draft.scope, updateEntriesForScope],
  );

  const addEntry = useCallback(() => {
    updateEntries(appendEditableSkillPathEntry);
  }, [updateEntries]);

  const updateEntry = useCallback(
    (index: number, value: string) => {
      updateEntries((entries) => updateEditableSkillPathEntry(entries, index, value));
    },
    [updateEntries],
  );

  const removeEntry = useCallback(
    (index: number) => {
      updateEntries((entries) => removeEditableSkillPathEntry(entries, index));
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
      if (!scope || scope !== draft.scope) return;

      setToggleIntentsByScope((current) => ({
        ...current,
        [scope]: upsertSkillToggleIntent(
          current[scope],
          skill.path,
          enabled,
          skill.status !== 'disabled',
        ),
      }));
      markChanged(scope);
      setError('');
    },
    [draft.scope, markChanged],
  );

  const save = useCallback(() => {
    const saveScope = draft.scope;
    const entries =
      saveScope === 'global'
        ? normalizeSkillEntries(draft.globalEntries)
        : normalizeSkillEntries(draft.projectEntries);
    const requestId = saveRequestRef.current + 1;
    const saveDraftVersion = draftVersionRef.current;
    const saveScopeVersion = draftVersionByScopeRef.current[saveScope];
    saveRequestRef.current = requestId;
    setIsSaving(true);
    setError('');
    setSavedScope((current) => (current === saveScope ? null : current));

    protocolClient.saveSkillsSettings(
      saveScope,
      entries,
      toggleIntentsByScope[saveScope],
      (result) => {
        if (!mountedRef.current || requestId !== saveRequestRef.current) return;
        setIsSaving(false);
        if (!result.success) {
          setError(result.error ?? '保存 Skills 设置失败');
          setSavedScope((current) => (current === saveScope ? null : current));
          return;
        }
        if (saveScopeVersion === draftVersionByScopeRef.current[saveScope]) {
          if (result.settings) {
            const hasNewerDraftEdits = saveDraftVersion !== draftVersionRef.current;
            setDraft((current) =>
              mergeSavedSkillSettings(current, result.settings!, saveScope, hasNewerDraftEdits),
            );
            draftVersionRef.current += 1;
            draftVersionByScopeRef.current[saveScope] += 1;
          }
          setDirtyScopes((current) => ({ ...current, [saveScope]: false }));
          setToggleIntentsByScope((current) => clearSkillToggleIntentsForScope(current, saveScope));
          setSavedScope(saveScope);
          setError(result.error ?? '');
        } else {
          setSavedScope((current) => (current === saveScope ? null : current));
        }
      },
      (message) => {
        if (!mountedRef.current || requestId !== saveRequestRef.current) return;
        setError(message);
        setIsSaving(false);
        setSavedScope((current) => (current === saveScope ? null : current));
      },
    );
  }, [draft, toggleIntentsByScope]);

  const openSkillFile = useCallback((filePath: string) => {
    protocolClient.openSkillFile(filePath, (result) => {
      if (!mountedRef.current) return;
      if (!result.success) {
        setError(result.error ?? '打开 Skill 失败');
      }
    });
  }, []);

  return {
    draft,
    currentEntries: getEditableSkillPathEntries(
      draft.scope === 'global' ? draft.globalEntries : draft.projectEntries,
    ),
    isLoading,
    isSaving,
    isDirty: dirtyScopes[draft.scope],
    saved: savedScope === draft.scope,
    error,
    load,
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

function clearSkillToggleIntentsForScope(
  current: SkillToggleIntentsByScope,
  scope: ScoutSkillScope,
): SkillToggleIntentsByScope {
  return {
    ...current,
    [scope]: [],
  };
}

function mergeSavedSkillSettings(
  current: EditableSkillSettingsState,
  settings: Parameters<typeof toEditableSkillSettingsState>[0],
  saveScope: ScoutSkillScope,
  preserveOtherScope: boolean,
): EditableSkillSettingsState {
  const next = toEditableSkillSettingsState(settings, current);
  if (!preserveOtherScope) return next;
  const otherScope: ScoutSkillScope = saveScope === 'global' ? 'project' : 'global';
  const otherKey = otherScope === 'global' ? 'globalEntries' : 'projectEntries';
  return {
    ...next,
    scope: current.scope,
    [otherKey]: current[otherKey],
  };
}

function getEditableSkillPathEntries(entries: string[]): string[] {
  return entries.filter((entry) => !isResourceOverrideEntry(entry));
}

function appendEditableSkillPathEntry(entries: string[]): string[] {
  const firstOverrideIndex = entries.findIndex(isResourceOverrideEntry);
  if (firstOverrideIndex < 0) return [...entries, ''];
  return [...entries.slice(0, firstOverrideIndex), '', ...entries.slice(firstOverrideIndex)];
}

function updateEditableSkillPathEntry(entries: string[], index: number, value: string): string[] {
  let editableIndex = 0;
  let updated = false;
  const nextEntries = entries.map((entry) => {
    if (isResourceOverrideEntry(entry)) return entry;
    if (editableIndex === index) {
      updated = true;
      editableIndex += 1;
      return value;
    }
    editableIndex += 1;
    return entry;
  });
  return updated ? nextEntries : entries;
}

function removeEditableSkillPathEntry(entries: string[], index: number): string[] {
  let editableIndex = 0;
  return entries.filter((entry) => {
    if (isResourceOverrideEntry(entry)) return true;
    const shouldRemove = editableIndex === index;
    editableIndex += 1;
    return !shouldRemove;
  });
}

function isResourceOverrideEntry(entry: string): boolean {
  const trimmed = entry.trim();
  return trimmed.startsWith('!') || trimmed.startsWith('+') || trimmed.startsWith('-');
}
