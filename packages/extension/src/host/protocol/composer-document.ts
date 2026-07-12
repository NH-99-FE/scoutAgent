// ============================================================
// Composer Document — host 边界的持久展示元数据校验与复制
// ============================================================

import type { ScoutComposerDocument } from '@scout-agent/shared';

export function readScoutComposerDocument(value: unknown): ScoutComposerDocument | undefined {
  if (!isRecord(value) || !Array.isArray(value.segments)) return undefined;
  for (const segment of value.segments) {
    if (!isRecord(segment)) return undefined;
    if (segment.type === 'text') {
      if (typeof segment.text !== 'string') return undefined;
      continue;
    }
    if (segment.type !== 'reference' || !isRecord(segment.reference)) return undefined;
    const reference = segment.reference;
    if (typeof reference.id !== 'string' || typeof reference.path !== 'string') return undefined;
    if (reference.kind === 'skill') {
      if (typeof reference.commandName !== 'string') return undefined;
      continue;
    }
    if (
      reference.kind !== 'file' ||
      (reference.fileKind !== 'file' && reference.fileKind !== 'directory') ||
      typeof reference.label !== 'string'
    ) {
      return undefined;
    }
  }
  return cloneScoutComposerDocument(value as unknown as ScoutComposerDocument);
}

function cloneScoutComposerDocument(document: ScoutComposerDocument): ScoutComposerDocument {
  return {
    segments: document.segments.map((segment) =>
      segment.type === 'text'
        ? { type: 'text', text: segment.text }
        : { type: 'reference', reference: { ...segment.reference } },
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
