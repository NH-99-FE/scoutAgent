// ============================================================
// File Mention Trigger — Composer @ 文件触发识别
// ============================================================

import type { ComposerTextRange } from '@/store/composer-document';

export interface FileMentionTrigger {
  query: string;
  range: ComposerTextRange;
}

export function getFileMentionTrigger(
  text: string,
  selectionStart: number,
): FileMentionTrigger | null {
  if (selectionStart < 1 || selectionStart > text.length) return null;

  const prefix = text.slice(0, selectionStart);
  const quotedMatch = /(?:^|\s)@"([^"\r\n]*)$/u.exec(prefix);
  if (quotedMatch) {
    const queryPrefix = quotedMatch[1] ?? '';
    const querySuffix = /^[^"\r\n]*/u.exec(text.slice(selectionStart))?.[0] ?? '';
    const triggerIndex = selectionStart - queryPrefix.length - 2;
    const closingQuoteLength = text[selectionStart + querySuffix.length] === '"' ? 1 : 0;
    return {
      query: `${queryPrefix}${querySuffix}`,
      range: {
        start: triggerIndex,
        end: selectionStart + querySuffix.length + closingQuoteLength,
      },
    };
  }

  const match = /(?:^|\s)@([^\s@]*)$/u.exec(prefix);
  if (!match) return null;

  const queryPrefix = match[1] ?? '';
  const querySuffix = /^[^\s@]*/u.exec(text.slice(selectionStart))?.[0] ?? '';
  const query = `${queryPrefix}${querySuffix}`;
  const triggerIndex = selectionStart - queryPrefix.length - 1;
  return {
    query,
    range: { start: triggerIndex, end: selectionStart + querySuffix.length },
  };
}
