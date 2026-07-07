// ============================================================
// Custom Models State — models.json 设置状态与协议副作用
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
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
import type { ScoutModelProvider } from '@scout-agent/shared';

export interface CustomModelsController {
  draft: EditableCustomModels;
  isLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  saved: boolean;
  error: string;
  load: () => void;
  save: () => void;
  updateProvider: (provider: ScoutModelProvider, patch: Partial<EditableProvider>) => void;
  updateModel: (provider: ScoutModelProvider, index: number, patch: Partial<EditableModel>) => void;
  addModel: (provider: ScoutModelProvider) => string;
  removeModel: (provider: ScoutModelProvider, index: number) => void;
}

export function useCustomModelsController(): CustomModelsController {
  const [draft, setDraft] = useState<EditableCustomModels>(EMPTY_CUSTOM_MODELS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const mountedRef = useRef(true);
  const loadRequestRef = useRef(0);
  const saveRequestRef = useRef(0);
  const draftVersionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const requestSettings = useCallback(() => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;

    protocolClient.requestCustomModels(
      (result) => {
        if (!mountedRef.current || requestId !== loadRequestRef.current) return;
        setDraft((current) => toEditableCustomModels(result.settings, current));
        draftVersionRef.current += 1;
        setIsDirty(false);
        setSaved(false);
        setError(result.settings.error ?? '');
        setIsLoading(false);
      },
      (message) => {
        if (!mountedRef.current || requestId !== loadRequestRef.current) return;
        setError(message);
        setSaved(false);
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
    requestSettings();
  }, [requestSettings]);

  const markChanged = useCallback(() => {
    draftVersionRef.current += 1;
    setIsDirty(true);
    setSaved(false);
    setError('');
  }, []);

  const updateProvider = useCallback(
    (provider: ScoutModelProvider, patch: Partial<EditableProvider>) => {
      setDraft((current) => ({
        ...current,
        providers: {
          ...current.providers,
          [provider]: { ...current.providers[provider], ...patch },
        },
      }));
      markChanged();
    },
    [markChanged],
  );

  const updateModel = useCallback(
    (provider: ScoutModelProvider, index: number, patch: Partial<EditableModel>) => {
      setDraft((current) => {
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
      markChanged();
    },
    [markChanged],
  );

  const addModel = useCallback(
    (provider: ScoutModelProvider) => {
      const model = createEditableModel(provider);
      setDraft((current) => {
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
      markChanged();
      return model.clientId;
    },
    [markChanged],
  );

  const removeModel = useCallback(
    (provider: ScoutModelProvider, index: number) => {
      setDraft((current) => {
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
      markChanged();
    },
    [markChanged],
  );

  const save = useCallback(() => {
    const next = toCustomModelsSettings(draft);
    if (typeof next === 'string') {
      setError(next);
      setSaved(false);
      return;
    }

    const requestId = saveRequestRef.current + 1;
    const saveDraftVersion = draftVersionRef.current;
    saveRequestRef.current = requestId;
    setIsSaving(true);
    setError('');
    setSaved(false);

    protocolClient.saveCustomModels(
      next,
      (result) => {
        if (!mountedRef.current || requestId !== saveRequestRef.current) return;
        setIsSaving(false);
        if (!result.success) {
          setError(result.error ?? '保存模型配置失败');
          setSaved(false);
          return;
        }
        setError(result.error ?? '');
        if (saveDraftVersion === draftVersionRef.current) {
          if (result.settings) {
            setDraft((current) => toEditableCustomModels(result.settings!, current));
            draftVersionRef.current += 1;
          }
          setIsDirty(false);
          setSaved(true);
        } else {
          setIsDirty(true);
          setSaved(false);
        }
      },
      (message) => {
        if (!mountedRef.current || requestId !== saveRequestRef.current) return;
        setError(message);
        setIsSaving(false);
        setSaved(false);
        setIsDirty(true);
      },
    );
  }, [draft]);

  return {
    draft,
    isLoading,
    isSaving,
    isDirty,
    saved,
    error,
    load,
    save,
    updateProvider,
    updateModel,
    addModel,
    removeModel,
  };
}
