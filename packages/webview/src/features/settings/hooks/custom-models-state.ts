// ============================================================
// Custom Models State — models.json 设置状态与协议副作用
// ============================================================

import { useCallback } from 'react';
import { protocolClient } from '@/bridge/protocol-client';
import {
  createEditableModel,
  EMPTY_CUSTOM_MODELS,
  toCustomModelsSettings,
  toEditableCustomModels,
  type EditableCustomModels,
  type EditableModel,
  type EditableProvider,
} from '../model/custom-models-draft';
import { areSettingsDraftValuesEqual } from '../model/settings-draft-utils';
import type { ScoutModelProvider } from '@scout-agent/shared';
import { useSettingsDraftMachine } from './use-settings-draft-machine';
import { useLazySettingsLoad, useSettingsRequestLifecycle } from './use-settings-request-lifecycle';

const CUSTOM_MODELS_DRAFT_SCOPES = ['models'] as const;

export interface CustomModelsController {
  draft: EditableCustomModels;
  isLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  hasUnsavedChanges: boolean;
  saved: boolean;
  error: string;
  load: () => void;
  discard: () => void;
  save: () => void;
  updateProvider: (provider: ScoutModelProvider, patch: Partial<EditableProvider>) => void;
  updateModel: (provider: ScoutModelProvider, index: number, patch: Partial<EditableModel>) => void;
  addModel: (provider: ScoutModelProvider) => string;
  removeModel: (provider: ScoutModelProvider, index: number) => void;
}

export function useCustomModelsController(enabled = true): CustomModelsController {
  const draftMachine = useSettingsDraftMachine({
    initialDraft: EMPTY_CUSTOM_MODELS,
    scopes: CUSTOM_MODELS_DRAFT_SCOPES,
    isScopeDirty: isCustomModelsDraftDirty,
  });
  const {
    draft,
    dirtyScopes,
    hasUnsavedChanges,
    hydrate,
    edit,
    discard: discardDraft,
    commitSaved,
    getSnapshot,
    getScopeRevision,
  } = draftMachine;
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
  } = useSettingsRequestLifecycle<'models'>();

  const requestSettings = useCallback(() => {
    const requestId = beginRequest('load');

    protocolClient.requestCustomModels(
      (result) => {
        if (!isCurrentRequest('load', requestId)) return;
        const next = toEditableCustomModels(result.settings, getSnapshot().draft);
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
    discardDraft((baseline) => baseline);
    clearFeedback();
  }, [clearFeedback, discardDraft]);

  const updateDraft = useCallback(
    (updater: (current: EditableCustomModels) => EditableCustomModels) => {
      edit('models', updater);
      clearFeedback();
    },
    [clearFeedback, edit],
  );

  const updateProvider = useCallback(
    (provider: ScoutModelProvider, patch: Partial<EditableProvider>) => {
      updateDraft((current) => ({
        ...current,
        providers: {
          ...current.providers,
          [provider]: { ...current.providers[provider], ...patch },
        },
      }));
    },
    [updateDraft],
  );

  const updateModel = useCallback(
    (provider: ScoutModelProvider, index: number, patch: Partial<EditableModel>) => {
      updateDraft((current) => {
        const currentProvider = current.providers[provider];
        return {
          ...current,
          providers: {
            ...current.providers,
            [provider]: {
              ...currentProvider,
              models: currentProvider.models.map((model, itemIndex) =>
                itemIndex === index ? { ...model, ...patch } : model,
              ),
            },
          },
        };
      });
    },
    [updateDraft],
  );

  const addModel = useCallback(
    (provider: ScoutModelProvider) => {
      const model = createEditableModel(provider);
      updateDraft((current) => {
        const currentProvider = current.providers[provider];
        return {
          ...current,
          providers: {
            ...current.providers,
            [provider]: {
              ...currentProvider,
              models: [...currentProvider.models, model],
            },
          },
        };
      });
      return model.clientId;
    },
    [updateDraft],
  );

  const removeModel = useCallback(
    (provider: ScoutModelProvider, index: number) => {
      updateDraft((current) => {
        const currentProvider = current.providers[provider];
        return {
          ...current,
          providers: {
            ...current.providers,
            [provider]: {
              ...currentProvider,
              models: currentProvider.models.filter((_model, itemIndex) => itemIndex !== index),
            },
          },
        };
      });
    },
    [updateDraft],
  );

  const save = useCallback(() => {
    const saveDraft = getSnapshot().draft;
    const next = toCustomModelsSettings(saveDraft);
    if (typeof next === 'string') {
      clearFeedback('models');
      reportError(next);
      return;
    }

    const requestId = beginRequest('save');
    const submittedScopeRevision = getScopeRevision('models');
    beginSave('models');

    protocolClient.saveCustomModels(
      next,
      (result) => {
        if (!isCurrentRequest('save', requestId)) return;
        if (!result.success) {
          finishSave('models', { error: result.error ?? '保存模型配置失败' });
          return;
        }
        const savedBaseline = result.settings
          ? toEditableCustomModels(result.settings, saveDraft)
          : saveDraft;
        const scopeUnchanged = submittedScopeRevision === getScopeRevision('models');
        commitSaved({
          scope: 'models',
          submittedScopeRevision,
          baseline: savedBaseline,
          merge: ({ draft: current, nextBaseline, scopeUnchanged: unchanged }) =>
            unchanged ? nextBaseline : current,
        });
        finishSave('models', { error: result.error ?? '', saved: scopeUnchanged });
      },
      (message) => {
        if (!isCurrentRequest('save', requestId)) return;
        finishSave('models', { error: message });
      },
    );
  }, [
    beginSave,
    beginRequest,
    clearFeedback,
    commitSaved,
    finishSave,
    getScopeRevision,
    getSnapshot,
    isCurrentRequest,
    reportError,
  ]);

  const isDirty = dirtyScopes.models;

  return {
    draft,
    isLoading,
    isSaving,
    isDirty,
    hasUnsavedChanges,
    saved: savedScope === 'models',
    error,
    load,
    discard,
    save,
    updateProvider,
    updateModel,
    addModel,
    removeModel,
  };
}

function isCustomModelsDraftDirty(
  draft: EditableCustomModels,
  baseline: EditableCustomModels,
): boolean {
  return !areSettingsDraftValuesEqual(draft.providers, baseline.providers);
}
