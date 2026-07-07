// ============================================================
// Runtime Settings State — settings.json 设置状态与协议副作用
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScoutRuntimeSettingsPath, ScoutSettingsScope } from '@scout-agent/shared';
import { protocolClient } from '@/bridge/protocol-client';
import {
  EMPTY_RUNTIME_SETTINGS_STATE,
  toEditableRuntimeSettingsState,
  toRuntimeSettingsPatch,
  type EditableRuntimeSettings,
  type EditableRuntimeSettingsState,
} from '../model/runtime-settings-draft';

export interface RuntimeSettingsController {
  draft: EditableRuntimeSettingsState;
  currentSettings: EditableRuntimeSettings;
  isLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  saved: boolean;
  error: string;
  load: () => void;
  save: () => void;
  setScope: (scope: ScoutSettingsScope) => void;
  updateCurrentSettings: (
    patch: Partial<EditableRuntimeSettings>,
    dirtyPaths: ScoutRuntimeSettingsPath[],
  ) => void;
}

type DirtyPathsByScope = Record<ScoutSettingsScope, ReadonlySet<ScoutRuntimeSettingsPath>>;

export function useRuntimeSettingsController(): RuntimeSettingsController {
  const [draft, setDraft] = useState<EditableRuntimeSettingsState>(EMPTY_RUNTIME_SETTINGS_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [dirtyPathsByScope, setDirtyPathsByScope] = useState<DirtyPathsByScope>(
    createEmptyDirtyPathsByScope,
  );
  const [error, setError] = useState('');
  const [savedScope, setSavedScope] = useState<ScoutSettingsScope | null>(null);
  const mountedRef = useRef(true);
  const loadRequestRef = useRef(0);
  const saveRequestRef = useRef(0);
  const draftVersionRef = useRef(0);
  const draftVersionByScopeRef = useRef<Record<ScoutSettingsScope, number>>({
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

    protocolClient.requestRuntimeSettings(
      (result) => {
        if (!mountedRef.current || requestId !== loadRequestRef.current) return;
        setDraft((current) => toEditableRuntimeSettingsState(result.settings, current));
        draftVersionRef.current += 1;
        draftVersionByScopeRef.current.global += 1;
        draftVersionByScopeRef.current.project += 1;
        setDirtyPathsByScope(createEmptyDirtyPathsByScope());
        setSavedScope(null);
        setError(result.settings.error ?? '');
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

  const setScope = useCallback((scope: ScoutSettingsScope) => {
    setDraft((current) => ({ ...current, scope }));
  }, []);

  const markChanged = useCallback(
    (scope: ScoutSettingsScope, paths: ScoutRuntimeSettingsPath[]) => {
      draftVersionRef.current += 1;
      draftVersionByScopeRef.current[scope] += 1;
      setDirtyPathsByScope((current) => ({
        ...current,
        [scope]: new Set([...current[scope], ...paths]),
      }));
      setSavedScope((current) => (current === scope ? null : current));
      setError('');
    },
    [],
  );

  const updateCurrentSettings = useCallback(
    (patch: Partial<EditableRuntimeSettings>, dirtyPaths: ScoutRuntimeSettingsPath[]) => {
      const scope = draft.scope;
      setDraft((current) => ({
        ...current,
        [scope]: { ...current[scope], ...patch },
      }));
      markChanged(scope, dirtyPaths);
    },
    [draft.scope, markChanged],
  );

  const save = useCallback(() => {
    const currentSettings = draft[draft.scope];
    const next = toRuntimeSettingsPatch(currentSettings, dirtyPathsByScope[draft.scope]);
    if (typeof next === 'string') {
      setError(next);
      setSavedScope((current) => (current === draft.scope ? null : current));
      return;
    }

    const requestId = saveRequestRef.current + 1;
    const saveScope = draft.scope;
    const saveDraftVersion = draftVersionRef.current;
    const saveScopeVersion = draftVersionByScopeRef.current[saveScope];
    saveRequestRef.current = requestId;
    setIsSaving(true);
    setError('');
    setSavedScope((current) => (current === saveScope ? null : current));

    protocolClient.saveRuntimeSettings(
      saveScope,
      next,
      (result) => {
        if (!mountedRef.current || requestId !== saveRequestRef.current) return;
        setIsSaving(false);
        if (!result.success) {
          setError(result.error ?? '保存运行设置失败');
          setSavedScope((current) => (current === saveScope ? null : current));
          return;
        }
        if (saveScopeVersion === draftVersionByScopeRef.current[saveScope]) {
          if (result.settings) {
            const hasNewerDraftEdits = saveDraftVersion !== draftVersionRef.current;
            setDraft((current) =>
              mergeSavedRuntimeSettings(current, result.settings!, saveScope, hasNewerDraftEdits),
            );
            draftVersionRef.current += 1;
            draftVersionByScopeRef.current[saveScope] += 1;
          }
          setDirtyPathsByScope((current) => ({ ...current, [saveScope]: new Set() }));
          setSavedScope(saveScope);
          setError(result.error ?? result.settings?.error ?? '');
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
  }, [dirtyPathsByScope, draft]);

  return {
    draft,
    currentSettings: draft[draft.scope],
    isLoading,
    isSaving,
    isDirty: dirtyPathsByScope[draft.scope].size > 0,
    saved: savedScope === draft.scope,
    error,
    load,
    save,
    setScope,
    updateCurrentSettings,
  };
}

function createEmptyDirtyPathsByScope(): DirtyPathsByScope {
  return {
    global: new Set(),
    project: new Set(),
  };
}

function mergeSavedRuntimeSettings(
  current: EditableRuntimeSettingsState,
  settings: Parameters<typeof toEditableRuntimeSettingsState>[0],
  saveScope: ScoutSettingsScope,
  preserveOtherScope: boolean,
): EditableRuntimeSettingsState {
  const next = toEditableRuntimeSettingsState(settings, current);
  if (!preserveOtherScope) return next;
  const otherScope: ScoutSettingsScope = saveScope === 'global' ? 'project' : 'global';
  return {
    ...next,
    scope: current.scope,
    [otherScope]: current[otherScope],
  };
}
