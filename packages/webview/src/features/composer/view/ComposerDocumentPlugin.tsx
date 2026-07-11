// ============================================================
// Composer Document Plugin — 文档同步与命令式编辑边界
// ============================================================

import type { ForwardedRef } from 'react';
import { useCallback, useEffect, useImperativeHandle } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import type { EditorState } from 'lexical';
import { markProgrammaticFocus } from '@/components/ui/focus';
import {
  areComposerDocumentsEqual,
  replaceComposerRange,
  type ComposerDocument,
  type ComposerReference,
  type ComposerTextRange,
} from '@/store/composer-document';
import {
  $getComposerSelectionOffset,
  $readComposerDocument,
  $selectComposerOffset,
  $writeComposerDocument,
} from '../model/composer-lexical-adapter';

export interface ComposerEditorHandle {
  focusAt: (offset: number) => void;
  replaceRange: (
    range: ComposerTextRange,
    replacementText: string,
    reference?: ComposerReference,
  ) => void;
}

interface ComposerDocumentPluginProps {
  document: ComposerDocument;
  editorRef: ForwardedRef<ComposerEditorHandle>;
  onChange: (document: ComposerDocument) => void;
  onSelectionChange?: (selectionStart: number) => void;
  readOnly: boolean;
}

export function ComposerDocumentPlugin({
  document,
  editorRef,
  onChange,
  onSelectionChange,
  readOnly,
}: ComposerDocumentPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => editor.setEditable(!readOnly), [editor, readOnly]);

  useEffect(() => {
    const currentDocument = editor.getEditorState().read($readComposerDocument);
    if (areComposerDocumentsEqual(currentDocument, document)) return;
    editor.update(() => $writeComposerDocument(document), { tag: 'composer-external-sync' });
  }, [document, editor]);

  useImperativeHandle(
    editorRef,
    () => ({
      focusAt: (offset) => {
        const rootElement = editor.getRootElement();
        markProgrammaticFocus(rootElement);
        editor.update(() => $selectComposerOffset(offset));
        rootElement?.focus();
        editor.focus();
      },
      replaceRange: (range, replacementText, reference) => {
        editor.update(() => {
          const nextDocument = replaceComposerRange(
            $readComposerDocument(),
            range,
            replacementText,
            reference,
          );
          $writeComposerDocument(nextDocument);
          $selectComposerOffset(
            range.start + replacementText.length + (reference === undefined ? 0 : 1),
          );
        });
        editor.focus();
      },
    }),
    [editor],
  );

  const handleChange = useCallback(
    (editorState: EditorState) => {
      editorState.read(() => {
        const nextDocument = $readComposerDocument();
        if (!areComposerDocumentsEqual(nextDocument, document)) onChange(nextDocument);
        const selectionOffset = $getComposerSelectionOffset();
        if (selectionOffset !== null) onSelectionChange?.(selectionOffset);
      });
    },
    [document, onChange, onSelectionChange],
  );

  return <OnChangePlugin ignoreHistoryMergeTagChange={false} onChange={handleChange} />;
}
