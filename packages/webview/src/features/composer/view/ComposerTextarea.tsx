// ============================================================
// Composer Textarea — 输入编辑区
// ============================================================

import type { ClipboardEvent, KeyboardEvent, RefObject } from 'react';
import { Textarea } from '@/components/ui/textarea';
import type { ComposerSubmitDelivery } from '../model/composer-submit';
export type { ComposerSubmitDelivery } from '../model/composer-submit';

interface ComposerTextareaProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (delivery?: ComposerSubmitDelivery) => void;
  onCancel?: () => void;
  onKeyDownCapture?: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onSelectionChange?: (selectionStart: number) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  readOnly?: boolean;
  isStreaming: boolean;
  canRequestAbort: boolean;
}

export function ComposerTextarea({
  placeholder,
  value,
  onChange,
  onSubmit,
  onCancel,
  onKeyDownCapture,
  onPaste,
  onSelectionChange,
  textareaRef,
  readOnly = false,
  isStreaming,
  canRequestAbort,
}: ComposerTextareaProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.key === 'Process') return;
    if (readOnly) return;
    if (onKeyDownCapture?.(event)) return;
    if (event.key === 'Escape' && canRequestAbort) {
      event.preventDefault();
      onCancel?.();
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    onSubmit(isStreaming && (event.ctrlKey || event.metaKey) ? 'steer' : undefined);
  };

  return (
    <Textarea
      aria-label={placeholder}
      className="scout-composer-textarea placeholder:text-muted-foreground/60 max-h-40 min-h-12 resize-none border-0 bg-transparent px-1 py-1 text-sm shadow-none"
      placeholder={placeholder}
      readOnly={readOnly}
      ref={textareaRef}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
        onSelectionChange?.(event.target.selectionStart);
      }}
      onKeyDown={handleKeyDown}
      onPaste={onPaste}
      onClick={(event) => onSelectionChange?.(event.currentTarget.selectionStart)}
      onKeyUp={(event) => onSelectionChange?.(event.currentTarget.selectionStart)}
      onSelect={(event) => onSelectionChange?.(event.currentTarget.selectionStart)}
    />
  );
}
