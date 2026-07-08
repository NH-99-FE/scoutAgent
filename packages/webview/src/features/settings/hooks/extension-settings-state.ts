// ============================================================
// Extension Settings State — 扩展管理协议状态
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ScoutExtensionScope,
  ScoutExtensionsSettings,
  ScoutExtensionTemplateId,
} from '@scout-agent/shared';
import { protocolClient } from '@/bridge/protocol-client';

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
  saved: boolean;
  error: string;
  load: () => void;
  save: () => void;
  createExtensionFromTemplate: (
    templateId: ScoutExtensionTemplateId,
    scope: ScoutExtensionScope,
  ) => void;
  openExtensionFile: (path: string) => void;
}

export function useExtensionSettingsController(): ExtensionSettingsController {
  const [settings, setSettings] = useState<ScoutExtensionsSettings>(EMPTY_EXTENSIONS_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const mountedRef = useRef(true);
  const loadRequestRef = useRef(0);
  const saveRequestRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const requestSettings = useCallback(() => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;

    protocolClient.requestExtensions(
      (result) => {
        if (!mountedRef.current || requestId !== loadRequestRef.current) return;
        setSettings(result.settings);
        setError('');
        setSaved(false);
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
    setSaved(false);
    requestSettings();
  }, [requestSettings]);

  const createExtensionFromTemplate = useCallback(
    (templateId: ScoutExtensionTemplateId, scope: ScoutExtensionScope) => {
      const requestId = saveRequestRef.current + 1;
      saveRequestRef.current = requestId;
      setIsSaving(true);
      setError('');
      setSaved(false);

      protocolClient.createExtensionFromTemplate(
        templateId,
        scope,
        (result) => {
          if (!mountedRef.current || requestId !== saveRequestRef.current) return;
          setIsSaving(false);
          if (!result.success) {
            setError(result.error ?? '创建扩展失败');
            setSaved(false);
            return;
          }
          setSaved(true);
          requestSettings();
        },
        (message) => {
          if (!mountedRef.current || requestId !== saveRequestRef.current) return;
          setError(message);
          setIsSaving(false);
          setSaved(false);
        },
      );
    },
    [requestSettings],
  );

  const openExtensionFile = useCallback((filePath: string) => {
    protocolClient.openExtensionFile(filePath, (result) => {
      if (!mountedRef.current) return;
      if (!result.success) {
        setError(result.error ?? '打开扩展失败');
      }
    });
  }, []);

  return {
    settings,
    isLoading,
    isSaving,
    isDirty: false,
    saved,
    error,
    load,
    save: () => undefined,
    createExtensionFromTemplate,
    openExtensionFile,
  };
}
