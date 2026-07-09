// ============================================================
// useComposerImageAttachments — 输入区图片附件生命周期
// ============================================================

import type { ClipboardEvent as ReactClipboardEvent } from 'react';
import { useCallback } from 'react';
import { registerComposerImageFile } from '@/store/composer-image-registry';
import { getComposerDraftSnapshot, useComposerActions } from '@/store/composer-store';
import { useUiActions } from '@/store/ui-store';
import { getClipboardImageFiles, selectComposerImageFiles } from '../model/composer-images';

interface ComposerImageAttachments {
  addImageFiles: (files: Iterable<File> | FileList | null) => Promise<void>;
  handlePaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
}

export function useComposerImageAttachments(sessionId: string): ComposerImageAttachments {
  const composerActions = useComposerActions();
  const uiActions = useUiActions();

  const addImageFiles = useCallback(
    async (files: Iterable<File> | FileList | null) => {
      if (!files) return;
      let selection;
      try {
        selection = await selectComposerImageFiles(
          Array.from(files),
          getComposerImageCount(sessionId),
        );
      } catch {
        uiActions.setNotification({
          type: 'notification',
          level: 'error',
          message: '图片读取失败，请重新选择',
        });
        return;
      }
      if (selection.warningMessages.length > 0) {
        uiActions.setNotification({
          type: 'notification',
          level: 'warning',
          message: selection.warningMessages.join('；'),
        });
      }
      if (selection.acceptedFiles.length === 0) return;
      composerActions.addImages(
        sessionId,
        selection.acceptedFiles.map(({ file, mimeType }) =>
          registerComposerImageFile(file, mimeType),
        ),
      );
    },
    [composerActions, sessionId, uiActions],
  );

  const handlePaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const imageFiles = getClipboardImageFiles(event.clipboardData);
      if (imageFiles.length === 0) return;
      event.preventDefault();
      void addImageFiles(imageFiles);
    },
    [addImageFiles],
  );

  return {
    addImageFiles,
    handlePaste,
  };
}

function getComposerImageCount(sessionId: string): number {
  return getComposerDraftSnapshot(sessionId).images?.length ?? 0;
}
