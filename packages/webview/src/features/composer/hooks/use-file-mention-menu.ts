// ============================================================
// File Mention Menu Hook — @ 文件候选的触发、选择与键盘状态
// ============================================================

import type { KeyboardEvent } from 'react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ScoutFileMentionItem } from '@scout-agent/shared';
import { protocolClient } from '@/bridge/protocol-client';
import type { ComposerReference, ComposerTextRange } from '@/store/composer-document';
import { useUiActions } from '@/store/ui-store';
import { createComposerImageFile } from '../model/composer-images';
import { getFileMentionTrigger } from '../model/file-mention-trigger';
import { useFileMentionSearch } from './use-file-mention-search';

// ---------- 类型 ----------

interface UseFileMentionMenuOptions {
  addImageFiles: (files: Iterable<File>) => Promise<number>;
  insertReferencesAt: (offset: number, references: ComposerReference[]) => void;
  linearText: string;
  replaceRange: (
    range: ComposerTextRange,
    replacementText: string,
    reference?: ComposerReference,
  ) => void;
  replaceRangeWithReferences: (range: ComposerTextRange, references: ComposerReference[]) => void;
  selectionStart: number | null;
}

interface MentionSelectionState {
  index: number;
  key: string | null;
}

interface ManualAddInvocation {
  anchor: number;
  documentText: string;
}

type ComposerContentSelectionKind = 'file' | 'directory';

// ---------- Hook ----------

export function useFileMentionMenu({
  addImageFiles,
  insertReferencesAt,
  linearText,
  replaceRange,
  replaceRangeWithReferences,
  selectionStart,
}: UseFileMentionMenuOptions) {
  const uiActions = useUiActions();
  const [manualInvocation, setManualInvocation] = useState<ManualAddInvocation | null>(null);
  const [dismissedTriggerKey, setDismissedTriggerKey] = useState<string | null>(null);
  const [selection, setSelection] = useState<MentionSelectionState>({ index: 0, key: null });
  const latestEditorState = useRef({ linearText, selectionStart });
  useLayoutEffect(() => {
    latestEditorState.current = { linearText, selectionStart };
  }, [linearText, selectionStart]);
  const trigger = useMemo(
    () => (selectionStart === null ? null : getFileMentionTrigger(linearText, selectionStart)),
    [linearText, selectionStart],
  );
  const triggerKey = getMentionTriggerKey(trigger);
  const triggerOpen = trigger !== null && dismissedTriggerKey !== triggerKey;
  const manualOpen = manualInvocation?.documentText === linearText;
  const open = manualOpen || triggerOpen;
  const kind = !open ? null : manualOpen || trigger?.query.length === 0 ? 'add' : 'search';
  const menuKey = manualOpen ? `button:${manualInvocation.anchor}` : triggerKey;
  const search = useFileMentionSearch(kind === 'search' ? (trigger?.query ?? null) : null);
  const activeIndex = selection.key === menuKey ? selection.index : 0;
  const itemCount = kind === 'add' ? 2 : search.items.length;
  const boundedActiveIndex = itemCount === 0 ? 0 : Math.min(activeIndex, itemCount - 1);

  const dismiss = useCallback(() => {
    if (manualOpen) {
      setManualInvocation(null);
      return;
    }
    setDismissedTriggerKey(triggerKey);
  }, [manualOpen, triggerKey]);

  const openAddMenu = useCallback(() => {
    setManualInvocation({
      anchor: selectionStart ?? linearText.length,
      documentText: linearText,
    });
  }, [linearText, selectionStart]);

  const selectFile = useCallback(
    (item: ScoutFileMentionItem) => {
      if (!trigger) return;
      replaceRange(trigger.range, ' ', toComposerFileReference(item));
    },
    [replaceRange, trigger],
  );

  const selectComposerContent = useCallback(
    (selectionKind: ComposerContentSelectionKind) => {
      const invocation =
        manualOpen && manualInvocation
          ? {
              source: 'button' as const,
              anchor: manualInvocation.anchor,
              documentText: manualInvocation.documentText,
            }
          : trigger
            ? {
                source: 'mention' as const,
                documentText: linearText,
                range: trigger.range,
              }
            : null;
      if (!invocation) return;
      dismiss();
      protocolClient.pickComposerContent(selectionKind, (result) => {
        if (result.error) {
          uiActions.setNotification({
            type: 'notification',
            level: 'error',
            message: result.error,
          });
          return;
        }
        if (result.warnings && result.warnings.length > 0) {
          uiActions.setNotification({
            type: 'notification',
            level: 'warning',
            message: result.warnings.join('；'),
          });
        }
        const references: ComposerReference[] = [];
        const imageFiles: File[] = [];
        for (const selected of result.selections) {
          if (selected.type === 'reference') {
            references.push(toComposerFileReference(selected.item));
            continue;
          }
          try {
            imageFiles.push(createComposerImageFile(selected.image, selected.fileName));
          } catch {
            uiActions.setNotification({
              type: 'notification',
              level: 'error',
              message: '图片读取失败，请重新选择',
            });
          }
        }
        const currentEditorState = latestEditorState.current;
        const documentUnchanged = currentEditorState.linearText === invocation.documentText;
        if (references.length > 0) {
          if (documentUnchanged) {
            if (invocation.source === 'button') {
              insertReferencesAt(invocation.anchor, references);
            } else {
              replaceRangeWithReferences(invocation.range, references);
            }
          } else {
            // 选择器打开期间文档已变化时，不再使用旧 range；引用落到最新光标位置。
            insertReferencesAt(
              currentEditorState.selectionStart ?? currentEditorState.linearText.length,
              references,
            );
          }
        }
        const applyAcceptedImages = async () => {
          const acceptedImageCount = imageFiles.length > 0 ? await addImageFiles(imageFiles) : 0;
          if (acceptedImageCount === 0 || references.length > 0) return;
          if (
            invocation.source === 'mention' &&
            latestEditorState.current.linearText === invocation.documentText
          ) {
            replaceRange(invocation.range, '');
          }
        };
        void applyAcceptedImages();
      });
    },
    [
      addImageFiles,
      dismiss,
      insertReferencesAt,
      linearText,
      manualInvocation,
      manualOpen,
      replaceRange,
      replaceRangeWithReferences,
      trigger,
      uiActions,
    ],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): boolean => {
      if (!open) return false;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (itemCount > 0) {
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          setSelection({
            key: menuKey,
            index: (boundedActiveIndex + delta + itemCount) % itemCount,
          });
        }
        return true;
      }
      if (event.key !== 'Enter') return false;
      if (kind === 'search' && search.items.length === 0) return false;
      event.preventDefault();
      if (kind === 'add') {
        selectComposerContent(boundedActiveIndex === 1 ? 'directory' : 'file');
      } else {
        const item = search.items[boundedActiveIndex];
        if (item) selectFile(item);
      }
      return true;
    },
    [
      boundedActiveIndex,
      itemCount,
      kind,
      open,
      search.items,
      selectComposerContent,
      selectFile,
      menuKey,
    ],
  );

  const handleDocumentChange = useCallback(() => {
    setManualInvocation(null);
    setDismissedTriggerKey(null);
    setSelection((current) =>
      current.key === null && current.index === 0 ? current : { index: 0, key: null },
    );
  }, []);

  return useMemo(
    () => ({
      activeIndex: boundedActiveIndex,
      dismiss,
      handleKeyDown,
      handleDocumentChange,
      error: search.error,
      items: search.items,
      kind,
      loading: search.loading,
      onHover: (index: number) => setSelection({ index, key: menuKey }),
      open,
      openAddMenu,
      selectFile,
      selectComposerContent,
    }),
    [
      boundedActiveIndex,
      dismiss,
      handleDocumentChange,
      handleKeyDown,
      kind,
      open,
      openAddMenu,
      search.error,
      search.items,
      search.loading,
      selectFile,
      selectComposerContent,
      menuKey,
    ],
  );
}

function getMentionTriggerKey(trigger: ReturnType<typeof getFileMentionTrigger>): string | null {
  return trigger ? `${trigger.range.start}:${trigger.range.end}:${trigger.query}` : null;
}

function toComposerFileReference(item: ScoutFileMentionItem): ComposerReference {
  return {
    fileKind: item.kind,
    id: item.id,
    kind: 'file',
    label: item.label,
    path: item.path,
  };
}
