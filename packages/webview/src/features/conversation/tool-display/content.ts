// ============================================================
// Tool Display Content — 工具内容与行处理
// ============================================================

import type { ScoutContent, ScoutToolExecutionResult } from '@scout-agent/shared';
import { formatComposerDocumentText } from '@/lib/composer-document-text';

export function contentToText(content: string | ScoutContent[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((item) => {
      if (item.type === 'text') return item.text;
      if (item.type === 'thinking') return item.redacted ? '思考内容已隐藏' : item.thinking;
      if (item.type === 'toolCall') return item.name;
      if (item.type === 'skillInvocation') return item.userMessage || `/skill:${item.name}`;
      if (item.type === 'composerDocument') return formatComposerDocumentText(item.document);
      return '[image]';
    })
    .filter(Boolean)
    .join('\n');
}

export function resultToText(result: ScoutToolExecutionResult): string {
  return contentToText(result.content);
}

export function splitContentLines(content: string): string[] {
  if (!content) return [];
  const normalized = normalizeLineEndings(content);
  const lines = normalized.split('\n');
  if (normalized.endsWith('\n')) lines.pop();
  return lines;
}

export function countContentLines(content: string): number {
  return splitContentLines(content).length;
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
