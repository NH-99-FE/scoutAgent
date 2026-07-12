// ============================================================
// Composer Reference Format — 输入区引用的统一文本格式
// ============================================================

import type { ComposerReference } from '@/store/composer-document';

export function formatComposerReference(reference: ComposerReference): string {
  switch (reference.kind) {
    case 'skill':
      return `/${reference.commandName}`;
    case 'file':
      return formatFileMention(reference.path);
  }
}

export function formatFileMention(path: string): string {
  return path.includes(' ') ? `@"${path}"` : `@${path}`;
}
