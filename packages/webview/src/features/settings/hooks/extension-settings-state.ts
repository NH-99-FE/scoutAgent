// ============================================================
// Extension Settings State — 扩展管理协议状态
// ============================================================

import { useCallback, useState } from 'react';
import type {
  ScoutExtensionScope,
  ScoutExtensionsSettings,
  ScoutExtensionTemplateId,
} from '@scout-agent/shared';
import { protocolClient } from '@/bridge/protocol-client';
import { useLazySettingsLoad, useSettingsRequestLifecycle } from './use-settings-request-lifecycle';

const EMPTY_EXTENSIONS_SETTINGS: ScoutExtensionsSettings = {
  projectDir: '',
  globalDir: '',
  configuredPaths: [],
  templates: [],
  extensions: [],
};

export interface ExtensionSettingsController {
  settings: ScoutExtensionsSettings;
  isLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  hasUnsavedChanges: boolean;
  saved: boolean;
  error: string;
  load: () => void;
  discard: () => void;
  save: () => void;
  createExtensionFromTemplate: (
    templateId: ScoutExtensionTemplateId,
    scope: ScoutExtensionScope,
  ) => void;
  openExtensionFile: (path: string) => void;
}

export function useExtensionSettingsController(enabled = true): ExtensionSettingsController {
  const [settings, setSettings] = useState<ScoutExtensionsSettings>(EMPTY_EXTENSIONS_SETTINGS);
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
    reportError,
  } = useSettingsRequestLifecycle<'extensions'>();

  const requestSettings = useCallback(() => {
    const requestId = beginRequest('load');

    protocolClient.requestExtensions(
      (result) => {
        if (!isCurrentRequest('load', requestId)) return;
        setSettings(result.settings);
        finishLoad();
      },
      (message) => {
        if (!isCurrentRequest('load', requestId)) return;
        finishLoad(message);
      },
    );
  }, [beginRequest, finishLoad, isCurrentRequest]);

  const requestLoad = useLazySettingsLoad(enabled, requestSettings);

  const load = useCallback(() => {
    beginLoad();
    requestLoad();
  }, [beginLoad, requestLoad]);

  const createExtensionFromTemplate = useCallback(
    (templateId: ScoutExtensionTemplateId, scope: ScoutExtensionScope) => {
      const requestId = beginRequest('save');
      beginSave('extensions');

      protocolClient.createExtensionFromTemplate(
        templateId,
        scope,
        (result) => {
          if (!isCurrentRequest('save', requestId)) return;
          if (!result.success) {
            finishSave('extensions', { error: result.error ?? '创建扩展失败' });
            return;
          }
          finishSave('extensions', { saved: true });
          requestSettings();
        },
        (message) => {
          if (!isCurrentRequest('save', requestId)) return;
          finishSave('extensions', { error: message });
        },
      );
    },
    [beginRequest, beginSave, finishSave, isCurrentRequest, requestSettings],
  );

  const openExtensionFile = useCallback(
    (filePath: string) => {
      protocolClient.openExtensionFile(filePath, (result) => {
        if (!isMounted()) return;
        if (!result.success) {
          reportError(result.error ?? '打开扩展失败');
        }
      });
    },
    [isMounted, reportError],
  );

  return {
    settings,
    isLoading,
    isSaving,
    isDirty: false,
    hasUnsavedChanges: false,
    saved: savedScope === 'extensions',
    error,
    load,
    discard: load,
    save: () => undefined,
    createExtensionFromTemplate,
    openExtensionFile,
  };
}
