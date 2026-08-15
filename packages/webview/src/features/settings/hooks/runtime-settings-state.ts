// ============================================================
// Runtime Settings State — settings.json 设置状态与协议副作用
// ============================================================

import { useCallback, useMemo } from 'react';
import { SCOUT_RUNTIME_SETTINGS_PATHS } from '@scout-agent/shared';
import type { ScoutRuntimeSettingsPath, ScoutSettingsScope } from '@scout-agent/shared';
import { protocolClient } from '@/bridge/protocol-client';
import {
  EMPTY_RUNTIME_SETTINGS_STATE,
  isRuntimeSettingsPathEqual,
  toEditableRuntimeSettingsState,
  toRuntimeSettingsPatch,
  type EditableRuntimeSettings,
  type EditableRuntimeSettingsState,
} from '../model/runtime-settings-draft';
import { useSettingsDraftMachine, type SavedDraftMergeContext } from './use-settings-draft-machine';
import { useLazySettingsLoad, useSettingsRequestLifecycle } from './use-settings-request-lifecycle';

const RUNTIME_SETTINGS_SCOPES = ['global', 'project'] as const;

export interface RuntimeSettingsController {
  draft: EditableRuntimeSettingsState;
  currentSettings: EditableRuntimeSettings;
  isLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  hasUnsavedChanges: boolean;
  saved: boolean;
  error: string;
  load: () => void;
  discard: () => void;
  save: () => void;
  setScope: (scope: ScoutSettingsScope) => void;
  updateCurrentSettings: (
    patch: Partial<EditableRuntimeSettings>,
    dirtyPaths: ScoutRuntimeSettingsPath[],
  ) => void;
}

type DirtyPathsByScope = Record<ScoutSettingsScope, ReadonlySet<ScoutRuntimeSettingsPath>>;

export function useRuntimeSettingsController(enabled = true): RuntimeSettingsController {
  const draftMachine = useSettingsDraftMachine({
    initialDraft: EMPTY_RUNTIME_SETTINGS_STATE,
    scopes: RUNTIME_SETTINGS_SCOPES,
    isScopeDirty: isRuntimeScopeDirty,
  });
  const {
    baseline,
    draft,
    hasUnsavedChanges,
    hydrate,
    edit,
    replace,
    discard: discardDraft,
    commitSaved,
    getSnapshot,
    getScopeRevision,
  } = draftMachine;
  const dirtyPathsByScope: DirtyPathsByScope = useMemo(
    () => ({
      global: getRuntimeDirtyPaths(draft, baseline, 'global'),
      project: getRuntimeDirtyPaths(draft, baseline, 'project'),
    }),
    [baseline, draft],
  );
  const {
    isLoading,
    isSaving,
    error,
    savedScope,
    beginRequest,
    isCurrentRequest,
    beginLoad,
    finishLoad,
    beginSave,
    finishSave,
    clearFeedback,
    reportError,
  } = useSettingsRequestLifecycle<ScoutSettingsScope>();

  const requestSettings = useCallback(() => {
    const requestId = beginRequest('load');

    protocolClient.requestRuntimeSettings(
      (result) => {
        if (!isCurrentRequest('load', requestId)) return;
        const next = toEditableRuntimeSettingsState(result.settings, getSnapshot().draft);
        hydrate(next);
        finishLoad(result.settings.error ?? '');
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
    discardDraft((savedBaseline, current) => ({ ...savedBaseline, scope: current.scope }));
    clearFeedback();
  }, [clearFeedback, discardDraft]);

  const setScope = useCallback(
    (scope: ScoutSettingsScope) => {
      replace((current) => ({ ...current, scope }));
    },
    [replace],
  );

  const markChanged = useCallback(
    (scope: ScoutSettingsScope) => {
      clearFeedback(scope);
    },
    [clearFeedback],
  );

  const updateCurrentSettings = useCallback(
    (patch: Partial<EditableRuntimeSettings>, _dirtyPaths: ScoutRuntimeSettingsPath[]) => {
      const scope = getSnapshot().draft.scope;
      edit(scope, (current) => ({
        ...current,
        [scope]: { ...current[scope], ...patch },
      }));
      markChanged(scope);
    },
    [edit, getSnapshot, markChanged],
  );

  const save = useCallback(() => {
    const saveDraft = getSnapshot().draft;
    const currentSettings = saveDraft[saveDraft.scope];
    const next = toRuntimeSettingsPatch(currentSettings, dirtyPathsByScope[saveDraft.scope]);
    if (typeof next === 'string') {
      clearFeedback(saveDraft.scope);
      reportError(next);
      return;
    }

    const requestId = beginRequest('save');
    const saveScope = saveDraft.scope;
    const submittedScopeRevision = getScopeRevision(saveScope);
    beginSave(saveScope);

    protocolClient.saveRuntimeSettings(
      saveScope,
      next,
      (result) => {
        if (!isCurrentRequest('save', requestId)) return;
        if (!result.success) {
          finishSave(saveScope, { error: result.error ?? '保存运行设置失败' });
          return;
        }
        const scopeUnchanged = submittedScopeRevision === getScopeRevision(saveScope);
        if (result.settings) {
          const nextBaseline = toEditableRuntimeSettingsState(
            result.settings,
            getSnapshot().baseline,
          );
          commitSaved({
            scope: saveScope,
            submittedScopeRevision,
            baseline: nextBaseline,
            merge: mergeSavedRuntimeDraft,
          });
        }
        if (scopeUnchanged) {
          finishSave(saveScope, {
            error: result.error ?? result.settings?.error ?? '',
            saved: true,
          });
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
    clearFeedback,
    commitSaved,
    dirtyPathsByScope,
    finishSave,
    getScopeRevision,
    getSnapshot,
    isCurrentRequest,
    reportError,
  ]);

  return {
    draft,
    currentSettings: draft[draft.scope],
    isLoading,
    isSaving,
    isDirty: dirtyPathsByScope[draft.scope].size > 0,
    hasUnsavedChanges,
    saved: savedScope === draft.scope,
    error,
    load,
    discard,
    save,
    setScope,
    updateCurrentSettings,
  };
}

function getRuntimeDirtyPaths(
  draft: EditableRuntimeSettingsState,
  baseline: EditableRuntimeSettingsState,
  scope: ScoutSettingsScope,
): ReadonlySet<ScoutRuntimeSettingsPath> {
  return new Set(
    SCOUT_RUNTIME_SETTINGS_PATHS.filter(
      (path) => !isRuntimeSettingsPathEqual(draft[scope], baseline[scope], path),
    ),
  );
}

function isRuntimeScopeDirty(
  draft: EditableRuntimeSettingsState,
  baseline: EditableRuntimeSettingsState,
  scope: ScoutSettingsScope,
): boolean {
  return getRuntimeDirtyPaths(draft, baseline, scope).size > 0;
}

function mergeSavedRuntimeDraft({
  draft,
  nextBaseline,
  saveScope,
  scopeUnchanged,
  dirtyScopesBeforeSave,
}: SavedDraftMergeContext<
  EditableRuntimeSettingsState,
  ScoutSettingsScope
>): EditableRuntimeSettingsState {
  const next = { ...nextBaseline, scope: draft.scope };
  for (const scope of RUNTIME_SETTINGS_SCOPES) {
    const preserve = scope === saveScope ? !scopeUnchanged : dirtyScopesBeforeSave[scope];
    if (preserve) next[scope] = draft[scope];
  }
  return next;
}
