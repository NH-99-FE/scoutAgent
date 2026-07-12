// ============================================================
// Composer Reference Format — 输入区引用的统一文本格式
// ============================================================

import type { ComposerReference } from '@/store/composer-document';
import { formatComposerReferenceText } from '@/lib/composer-document-text';

export function formatComposerReference(reference: ComposerReference): string {
  return formatComposerReferenceText(reference);
}
