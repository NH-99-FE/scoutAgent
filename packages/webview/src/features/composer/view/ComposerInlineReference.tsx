// ============================================================
// Composer Inline Reference — 编辑器内原子引用展示
// ============================================================

import { Box, File, Folder } from 'lucide-react';
import type { ComposerReference } from '@/store/composer-document';

interface ComposerInlineReferenceProps {
  reference: ComposerReference;
}

export function ComposerInlineReference({ reference }: ComposerInlineReferenceProps) {
  const label =
    reference.kind === 'skill' ? reference.commandName.replace(/^skill:/, '') : reference.label;
  const Icon =
    reference.kind === 'skill' ? Box : reference.fileKind === 'directory' ? Folder : File;
  const ariaLabel =
    reference.kind === 'skill'
      ? `已选择技能：${label}`
      : reference.fileKind === 'directory'
        ? `已选择文件夹：${reference.path}`
        : `已选择文件：${reference.path}`;

  return (
    <span
      aria-label={ariaLabel}
      className="text-reference inline-flex items-center gap-1 align-bottom text-sm leading-[inherit] font-medium"
      data-composer-reference-id={reference.id}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="max-w-48 truncate">{label}</span>
    </span>
  );
}
