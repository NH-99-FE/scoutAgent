// ============================================================
// Composer Textarea — 基于 Lexical 的原子引用编辑区
// ============================================================

import type { ClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { forwardRef, useMemo } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { clearFocusOutlineSuppression, markPointerFocus } from '@/components/ui/focus';
import { getComposerLinearText, type ComposerDocument } from '@/store/composer-document';
import { $writeComposerDocument } from '../model/composer-lexical-adapter';
import { ComposerReferenceNode } from '../model/composer-reference-node';
import type { ComposerSubmitDelivery } from '../model/composer-submit';
import { ComposerAtomicReferenceDeletionPlugin } from './ComposerAtomicReferenceDeletionPlugin';
import { ComposerDocumentPlugin, type ComposerEditorHandle } from './ComposerDocumentPlugin';
export type { ComposerSubmitDelivery } from '../model/composer-submit';
export type { ComposerEditorHandle } from './ComposerDocumentPlugin';

interface ComposerTextareaProps {
  canRequestAbort: boolean;
  document: ComposerDocument;
  isStreaming: boolean;
  onCancel?: () => void;
  onChange: (document: ComposerDocument) => void;
  onKeyDownCapture?: (event: ReactKeyboardEvent<HTMLDivElement>) => boolean;
  onPaste?: (event: ClipboardEvent<HTMLDivElement>) => void;
  onSelectionChange?: (selectionStart: number | null) => void;
  onSubmit: (delivery?: ComposerSubmitDelivery) => void;
  placeholder: string;
  readOnly?: boolean;
}

export const ComposerTextarea = forwardRef<ComposerEditorHandle, ComposerTextareaProps>(
  function ComposerTextarea(
    {
      canRequestAbort,
      document,
      isStreaming,
      onCancel,
      onChange,
      onKeyDownCapture,
      onPaste,
      onSelectionChange,
      onSubmit,
      placeholder,
      readOnly = false,
    },
    ref,
  ) {
    const initialConfig = useMemo(
      () => ({
        editable: !readOnly,
        editorState: () => $writeComposerDocument(document),
        namespace: 'ScoutComposer',
        nodes: [ComposerReferenceNode],
        onError: (error: Error) => {
          throw error;
        },
      }),
      // LexicalComposer 仅在挂载时读取 initialConfig，后续文档由同步插件负责。
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.nativeEvent.isComposing || event.key === 'Process') return;
      if (readOnly) return;
      if (onKeyDownCapture?.(event)) {
        consumeKeyboardEvent(event);
        return;
      }
      if (event.key === 'Escape' && canRequestAbort) {
        consumeKeyboardEvent(event);
        onCancel?.();
        return;
      }
      if (event.key !== 'Enter' || event.shiftKey) return;
      consumeKeyboardEvent(event);
      onSubmit(isStreaming && (event.ctrlKey || event.metaKey) ? 'steer' : undefined);
    };

    return (
      <LexicalComposer initialConfig={initialConfig}>
        <div className="relative min-w-0">
          <PlainTextPlugin
            ErrorBoundary={LexicalErrorBoundary}
            contentEditable={
              <ContentEditable
                aria-label={placeholder}
                aria-multiline="true"
                aria-readonly={readOnly}
                className="scout-native-scrollbar max-h-40 min-h-12 w-full overflow-y-auto bg-transparent px-1 py-1 text-sm break-words whitespace-pre-wrap outline-none"
                role="textbox"
                onBlur={(event) => clearFocusOutlineSuppression(event.currentTarget)}
                onFocus={() => onSelectionChange?.(getComposerLinearText(document).length)}
                onKeyDownCapture={handleKeyDown}
                onPaste={onPaste}
                onPointerDown={markPointerFocus}
              />
            }
            placeholder={
              <div className="text-muted-foreground/60 pointer-events-none absolute top-1 left-1 text-sm">
                {placeholder}
              </div>
            }
          />
          <HistoryPlugin />
          <ComposerDocumentPlugin
            document={document}
            editorRef={ref}
            readOnly={readOnly}
            onChange={onChange}
            onSelectionChange={onSelectionChange}
          />
          <ComposerAtomicReferenceDeletionPlugin />
        </div>
      </LexicalComposer>
    );
  },
);

function consumeKeyboardEvent(event: ReactKeyboardEvent<HTMLDivElement>): void {
  event.preventDefault();
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation();
}
