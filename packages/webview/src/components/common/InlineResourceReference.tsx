// ============================================================
// Inline Resource Reference — composer 与 user message 共用引用展示
// ============================================================

import { Box, File, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InlineResourceReferenceProps {
  ariaLabel: string;
  kind: 'directory' | 'file' | 'skill';
  label: string;
  onOpen?: () => void;
  preserveEditorSelection?: boolean;
}

export function InlineResourceReference({
  ariaLabel,
  kind,
  label,
  onOpen,
  preserveEditorSelection = false,
}: InlineResourceReferenceProps) {
  const Icon = kind === 'skill' ? Box : kind === 'directory' ? Folder : File;
  const content = (
    <>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="max-w-48 truncate">{label}</span>
    </>
  );
  const className = cn(
    'text-reference inline-flex max-w-full items-center gap-1 border-0 bg-transparent p-0 align-bottom text-sm leading-[inherit] font-medium',
    onOpen &&
      'cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-current/40',
  );

  if (!onOpen) {
    return (
      <span aria-label={ariaLabel} className={className}>
        {content}
      </span>
    );
  }

  return (
    <button
      aria-label={ariaLabel}
      className={className}
      type="button"
      onClick={onOpen}
      onMouseDown={preserveEditorSelection ? (event) => event.preventDefault() : undefined}
    >
      {content}
    </button>
  );
}
