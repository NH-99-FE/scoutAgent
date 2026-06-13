// ============================================================
// Composer Textarea — 输入编辑区
// ============================================================

import type { KeyboardEvent } from 'react';
import { Textarea } from '@/components/ui/textarea';

export type ComposerSubmitDelivery = 'steer' | 'followUp';

interface ComposerTextareaProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (delivery?: ComposerSubmitDelivery) => void;
  onCancel?: () => void;
  isStreaming: boolean;
  canRequestAbort: boolean;
}

export function ComposerTextarea({
  placeholder,
  value,
  onChange,
  onSubmit,
  onCancel,
  isStreaming,
  canRequestAbort,
}: ComposerTextareaProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.key === 'Process') return;
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
      className="max-h-40 min-h-12 resize-none border-0 bg-transparent px-1 py-1 text-sm shadow-none dark:bg-transparent"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={handleKeyDown}
    />
  );
}
