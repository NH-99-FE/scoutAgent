// ============================================================
// Prompt Settings State — 全局 Prompts 资源状态
// ============================================================

import { useCallback, useState } from 'react';
import type { ScoutPromptsSettings } from '@scout-agent/shared';
import { protocolClient } from '@/bridge/protocol-client';
import { useLazySettingsLoad, useSettingsRequestLifecycle } from './use-settings-request-lifecycle';

const EMPTY_PROMPTS_SETTINGS: ScoutPromptsSettings = {
  globalDir: '',
  diagnostics: [],
  prompts: [],
};

export interface PromptSettingsController {
  settings: ScoutPromptsSettings;
  isLoading: boolean;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  error: string;
  load: () => void;
  discard: () => void;
  openPromptFile: (path: string) => void;
  createPrompt: (name: string) => void;
  openPromptsDirectory: () => void;
}

export function usePromptSettingsController(enabled = true): PromptSettingsController {
  const [settings, setSettings] = useState<ScoutPromptsSettings>(EMPTY_PROMPTS_SETTINGS);
  const {
    isLoading,
    isSaving,
    error,
    beginRequest,
    isCurrentRequest,
    isMounted,
    beginLoad,
    finishLoad,
    beginSave,
    finishSave,
    reportError,
  } = useSettingsRequestLifecycle<'prompts'>();

  const requestSettings = useCallback(
    (resultMessage = '', refresh = false) => {
      const requestId = beginRequest('load');
      const request = refresh ? protocolClient.refreshPrompts : protocolClient.requestPrompts;
      request(
        (result) => {
          if (!isCurrentRequest('load', requestId)) return;
          setSettings(result.settings);
          finishLoad(resultMessage);
        },
        (message) => {
          if (!isCurrentRequest('load', requestId)) return;
          finishLoad(message);
        },
      );
    },
    [beginRequest, finishLoad, isCurrentRequest],
  );

  useLazySettingsLoad(enabled, requestSettings);

  const load = useCallback(() => {
    beginLoad();
    requestSettings('', true);
  }, [beginLoad, requestSettings]);

  const openPromptFile = useCallback(
    (filePath: string) => {
      protocolClient.openPromptFile(filePath, (result) => {
        if (!isMounted() || result.success) return;
        reportError(result.error ?? '打开 Prompt 失败');
      });
    },
    [isMounted, reportError],
  );

  const createPrompt = useCallback(
    (name: string) => {
      const requestId = beginRequest('create');
      beginSave('prompts');
      protocolClient.createPromptTemplate(
        name,
        (result) => {
          if (!isCurrentRequest('create', requestId)) return;
          if (!result.success) {
            finishSave('prompts', { error: result.error ?? '创建 Prompt 失败' });
            return;
          }
          finishSave('prompts', { saved: true });
          requestSettings(result.reloadError ?? '');
        },
        (message) => {
          if (!isCurrentRequest('create', requestId)) return;
          finishSave('prompts', { error: message });
        },
      );
    },
    [beginRequest, beginSave, finishSave, isCurrentRequest, requestSettings],
  );

  const openPromptsDirectory = useCallback(() => {
    protocolClient.openPromptsDirectory((result) => {
      if (!isMounted() || result.success) return;
      reportError(result.error ?? '打开 Prompts 目录失败');
    });
  }, [isMounted, reportError]);

  return {
    settings,
    isLoading,
    isSaving,
    hasUnsavedChanges: false,
    error,
    load,
    discard: load,
    openPromptFile,
    createPrompt,
    openPromptsDirectory,
  };
}
