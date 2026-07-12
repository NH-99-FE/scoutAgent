// ============================================================
// Composer Inline Reference — 编辑器内原子引用展示
// ============================================================

import type { ComposerReference } from '@/store/composer-document';
import { protocolClient } from '@/bridge/protocol-client';
import { InlineResourceReference } from '@/components/common/InlineResourceReference';

interface ComposerInlineReferenceProps {
  reference: ComposerReference;
}

export function ComposerInlineReference({ reference }: ComposerInlineReferenceProps) {
  const label =
    reference.kind === 'skill' ? reference.commandName.replace(/^skill:/, '') : reference.label;
  const ariaLabel =
    reference.kind === 'skill'
      ? `已选择技能：${label}`
      : reference.fileKind === 'directory'
        ? `已选择文件夹：${reference.path}`
        : `已选择文件：${reference.path}`;

  return (
    <span data-composer-reference-id={reference.id}>
      <InlineResourceReference
        ariaLabel={ariaLabel}
        kind={reference.kind === 'skill' ? 'skill' : reference.fileKind}
        label={label}
        preserveEditorSelection
        onOpen={
          reference.kind === 'skill'
            ? () => protocolClient.openSkillFile(reference.path)
            : reference.fileKind === 'file'
              ? () => protocolClient.openMentionedFile(reference.path)
              : undefined
        }
      />
    </span>
  );
}
