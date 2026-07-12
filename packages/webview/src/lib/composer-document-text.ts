// ============================================================
// Composer Document Text — 结构化 composer 文档的稳定纯文本表示
// ============================================================

import type { ScoutComposerDocument, ScoutComposerReference } from '@scout-agent/shared';

export function formatComposerDocumentText(document: ScoutComposerDocument): string {
  return document.segments
    .map((segment) =>
      segment.type === 'text' ? segment.text : formatComposerReferenceText(segment.reference),
    )
    .join('');
}

export function formatComposerReferenceText(reference: ScoutComposerReference): string {
  if (reference.kind === 'skill') return `/${reference.commandName}`;
  return reference.path.includes(' ') ? `@"${reference.path}"` : `@${reference.path}`;
}
